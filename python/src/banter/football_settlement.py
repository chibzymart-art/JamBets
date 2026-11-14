"""
Banter Hub: settle members' football picks from the results the main system already stored.

Read-only on every Predictions Hub table (football_fixtures, football_predictions).
Writes only to the Banter table football_user_picks, and only rows that are still 'pending'.

How a result is trusted (no verified data = no settlement):
  * The main system must already have settled its own prediction for the fixture
    (football_predictions.settlement_status in won/lost/void/voided). That only happens after its
    settlement engine has verified the match state.
  * The pick is then graded by the main system's own rules, SettlementEngine.evaluate (imported,
    not copied), against the stored fixture row: status, full-time score, kickoff.
  * Won/lost needs status 'finished' (or period 'FT') with both scores stored. Cancelled is void;
    postponed or unplayed more than 48 hours after kickoff is void, exactly as the engine rules say.
    Anything else stays pending and is looked at again on the next run.

Idempotent: only pending picks are read, and each update is filtered on status=pending, so a settled
pick is never re-scored and running twice changes nothing.

Usage (from the repo root):
  python -m python.src.banter.football_settlement            # dry run: logs what it would do
  python -m python.src.banter.football_settlement --live     # writes results
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from python.src.football.live_monitor import LiveMatchState
from python.src.football.models import FixtureStatus
from python.src.football.settlement_engine import SettlementEngine, SettlementStatus

SCORING_FILE = Path(__file__).resolve().parents[3] / "web" / "src" / "features" / "play" / "banter_scoring.json"

# Banter market id -> the main engine's market name.
ENGINE_MARKET = {"1X2": "1x2", "OU25": "over_under_2.5", "BTTS": "btts"}

MAIN_SETTLED = {"won", "lost", "void", "voided"}

KNOWN_STATUSES = {s.value for s in FixtureStatus}


def load_points() -> Dict[str, float]:
    """Points per outcome from the shared scoring file (single source with the website)."""
    data = json.loads(SCORING_FILE.read_text(encoding="utf-8"))
    return {"won": float(data["won"]), "lost": float(data["lost"]), "void": float(data["void"])}


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def build_match_state(fixture: Dict[str, Any]) -> Optional[LiveMatchState]:
    """The stored fixture row as the engine's match state, or None if it can't be read safely."""
    raw = str(fixture.get("status") or "").lower()
    period = fixture.get("period")
    if raw == "finished" or period == "FT":
        status = FixtureStatus.FINISHED
    elif raw in KNOWN_STATUSES:
        status = FixtureStatus(raw)
    else:
        return None  # e.g. data_unavailable: no verified state
    kickoff = _parse_ts(fixture.get("target_kickoff_at"))
    if kickoff is None:
        return None
    return LiveMatchState(
        fixture_id=str(fixture.get("id")),
        canonical_key=str(fixture.get("canonical_key") or ""),
        provider_event_id="stored",
        source_name="stored_fixture_row",
        status=status,
        raw_status=raw,
        scheduled_kickoff=kickoff,
        home_score=fixture.get("home_score"),
        away_score=fixture.get("away_score"),
        period=period,
        half_time_home_score=fixture.get("half_time_home_score"),
        half_time_away_score=fixture.get("half_time_away_score"),
        is_stale=False,
        is_verified=True,
    )


def grade_pick(
    pick: Dict[str, Any],
    fixture: Optional[Dict[str, Any]],
    main_settlement_status: Optional[str],
    points: Dict[str, float],
    now: Optional[datetime] = None,
) -> Optional[Tuple[str, float]]:
    """
    Returns (status, points) for a pick that can be settled now, or None to leave it pending.
    """
    if pick.get("status") != "pending":
        return None  # never re-score
    if fixture is None:
        return None
    if str(main_settlement_status or "").lower() not in MAIN_SETTLED:
        return None  # the main system hasn't settled this match yet
    market = ENGINE_MARKET.get(str(pick.get("market")))
    if not market:
        return None
    state = build_match_state(fixture)
    if state is None:
        return None
    if state.status == FixtureStatus.FINISHED and (state.home_score is None or state.away_score is None):
        return None  # finished without a stored score: not verified

    decision = SettlementEngine.evaluate(
        prediction={
            "id": pick.get("id"),
            "fixture_id": pick.get("fixture_id"),
            "market": market,
            "prediction": pick.get("selection"),
        },
        match_state=state,
        now_utc=now or datetime.now(timezone.utc),
    )

    if decision.status == SettlementStatus.WON:
        # Banter settles only on the full-time result, never early in play.
        if state.status != FixtureStatus.FINISHED:
            return None
        return "won", points["won"]
    if decision.status == SettlementStatus.LOST:
        if state.status != FixtureStatus.FINISHED:
            return None
        return "lost", points["lost"]
    if decision.status == SettlementStatus.VOID:
        return "void", points["void"]
    return None


def _chunks(items: List[str], size: int) -> Iterable[List[str]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def run(live: bool = False, db: Any = None, now: Optional[datetime] = None) -> Dict[str, int]:
    """One settle pass. Returns counts. Never raises for a single bad row."""
    now = now or datetime.now(timezone.utc)
    stats = {"pending_checked": 0, "won": 0, "lost": 0, "void": 0, "left_pending": 0, "written": 0, "errors": 0}
    points = load_points()

    if db is None:
        from python.src.db.supabase_client import SupabaseClient
        db = SupabaseClient()

    try:
        picks = db.get("football_user_picks", {
            "select": "id,fixture_id,market,selection,status,kickoff_at",
            "status": "eq.pending",
            "kickoff_at": f"lt.{now.isoformat()}",
            "order": "kickoff_at.asc",
            "limit": "5000",
        })
    except Exception as err:  # table not created yet, network, etc.
        print(f"[banter-settle] Could not read football_user_picks ({err}). Nothing to do.")
        return stats

    stats["pending_checked"] = len(picks)
    if not picks:
        print("[banter-settle] No pending picks past kickoff.")
        return stats

    fixture_ids = sorted({str(p["fixture_id"]) for p in picks})
    fixtures: Dict[str, Dict[str, Any]] = {}
    main_status: Dict[str, str] = {}
    for chunk in _chunks(fixture_ids, 100):
        id_list = ",".join(chunk)
        try:
            for f in db.get("football_fixtures", {
                "select": "id,canonical_key,status,period,target_kickoff_at,home_score,away_score,half_time_home_score,half_time_away_score",
                "id": f"in.({id_list})",
            }):
                fixtures[str(f["id"])] = f
            for p in db.get("football_predictions", {
                "select": "fixture_id,settlement_status",
                "fixture_id": f"in.({id_list})",
            }):
                main_status[str(p["fixture_id"])] = p.get("settlement_status") or ""
        except Exception as err:
            stats["errors"] += 1
            print(f"[banter-settle] Could not read results for a batch ({err}); those picks stay pending.")

    settled_at = now.isoformat()
    for pick in picks:
        fid = str(pick["fixture_id"])
        try:
            result = grade_pick(pick, fixtures.get(fid), main_status.get(fid), points, now)
        except Exception as err:
            stats["errors"] += 1
            print(f"[banter-settle] Skipped pick {pick.get('id')}: {err}")
            continue

        if result is None:
            stats["left_pending"] += 1
            continue

        status, pts = result
        stats[status] += 1
        label = f"pick {pick['id']} {pick['market']}={pick['selection']} -> {status} ({pts} pts)"
        if not live:
            print(f"[banter-settle] DRY RUN would set {label}")
            continue
        try:
            db.patch(
                "football_user_picks",
                {"status": status, "points": pts, "settled_at": settled_at, "updated_at": settled_at},
                {"id": f"eq.{pick['id']}", "status": "eq.pending"},
            )
            stats["written"] += 1
            print(f"[banter-settle] Set {label}")
        except Exception as err:
            stats["errors"] += 1
            print(f"[banter-settle] Could not write {label}: {err}")

    mode = "LIVE" if live else "DRY RUN"
    print(f"[banter-settle] {mode} summary: {json.dumps(stats)}")
    return stats


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Settle Banter Hub football picks from stored results.")
    parser.add_argument("--live", action="store_true", help="Write results (default is a dry run).")
    args = parser.parse_args(argv)
    try:
        run(live=args.live)
    except Exception as err:
        # Never fail the job: a missed run is simply picked up next time.
        print(f"[banter-settle] Run stopped early: {err}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
