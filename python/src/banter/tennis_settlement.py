"""
Banter Hub: settle members' tennis picks (match winner) from results the main system already stored.

Read-only on every Predictions Hub table (tennis_fixtures, tennis_players, tennis_predictions).
Writes only to the Banter table tennis_user_picks, and only rows that are still 'pending'.

How a result is trusted (no verified data = no settlement):
  * The main system must already have settled a prediction for the match
    (tennis_predictions.settlement_status in won/lost/void/half_won/half_lost).
  * The pick is graded by the main system's own rules, TennisSettlementEngine.evaluate_prediction
    (imported, not copied), for the match_winner market: walkover = void, retirement uses the
    one-set rule, finished = the stored winner.
  * Safety net: a won/lost result must agree with the stored winner_id; if it doesn't (or there is
    no winner), the pick stays pending. Anything else stays pending and is looked at next run.

Idempotent: only pending picks are read and each update is filtered on status=pending.

Usage (from the repo root):
  python -m python.src.banter.tennis_settlement            # dry run
  python -m python.src.banter.tennis_settlement --live     # writes results
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from python.src.banter.football_settlement import load_points
from python.src.tennis.settlement import TennisSettlementEngine

MAIN_SETTLED = {"won", "lost", "void", "half_won", "half_lost"}
FINAL_STATUSES = {"finished", "retired", "walkover"}


def grade_pick(
    pick: Dict[str, Any],
    fixture: Optional[Dict[str, Any]],
    main_settlement_status: Optional[str],
    points: Dict[str, float],
) -> Optional[Tuple[str, float]]:
    """(status, points) for a pick that can be settled now, or None to leave it pending."""
    if pick.get("status") != "pending" or fixture is None:
        return None
    if str(main_settlement_status or "").lower() not in MAIN_SETTLED:
        return None
    selection = pick.get("selection")
    if selection not in ("p1", "p2"):
        return None
    status = str(fixture.get("status") or "")
    if status in ("cancelled", "postponed"):
        # The main system voids unplayed / cancelled matches in its run loop (not in the grader).
        # Follow it: void only once its own prediction on this match was settled as void.
        return ("void", points["void"]) if str(main_settlement_status).lower() == "void" else None
    if status not in FINAL_STATUSES:
        return None

    p1 = fixture.get("player1") or {}
    p2 = fixture.get("player2") or {}
    chosen = p1 if selection == "p1" else p2
    side = "player 1" if selection == "p1" else "player 2"
    prediction_text = f"{chosen.get('display_name') or side} ({side})"

    result, _notes, _actual = TennisSettlementEngine.evaluate_prediction("match_winner", prediction_text, fixture)

    if result == "void":
        return "void", points["void"]
    if result in ("won", "lost"):
        winner_id = fixture.get("winner_id")
        if not winner_id:
            return None
        chosen_id = fixture.get("player1_id") if selection == "p1" else fixture.get("player2_id")
        expected = "won" if winner_id == chosen_id else "lost"
        if result != expected:
            return None  # disagreement with the stored winner: leave pending
        return result, points[result]
    return None


def _chunks(items: List[str], size: int) -> Iterable[List[str]]:
    for i in range(0, len(items), size):
        yield items[i:i + size]


def run(live: bool = False, db: Any = None, now: Optional[datetime] = None) -> Dict[str, int]:
    now = now or datetime.now(timezone.utc)
    stats = {"pending_checked": 0, "won": 0, "lost": 0, "void": 0, "left_pending": 0, "written": 0, "errors": 0}
    points = load_points()

    if db is None:
        from python.src.db.supabase_client import SupabaseClient
        db = SupabaseClient()

    try:
        picks = db.get("tennis_user_picks", {
            "select": "id,fixture_id,market,selection,status,kickoff_at",
            "status": "eq.pending",
            "kickoff_at": f"lt.{now.isoformat()}",
            "order": "kickoff_at.asc",
            "limit": "5000",
        })
    except Exception as err:
        print(f"[banter-tennis] Could not read tennis_user_picks ({err}). Nothing to do.")
        return stats

    stats["pending_checked"] = len(picks)
    if not picks:
        print("[banter-tennis] No pending tennis picks past start time.")
        return stats

    fixture_ids = sorted({str(p["fixture_id"]) for p in picks})
    fixtures: Dict[str, Dict[str, Any]] = {}
    main_status: Dict[str, str] = {}
    for chunk in _chunks(fixture_ids, 100):
        id_list = ",".join(chunk)
        try:
            for f in db.get("tennis_fixtures", {
                "select": "id,status,player1_id,player2_id,winner_id,retired_player_id,score_p1_sets,score_p2_sets,set_scores,target_kickoff_at,player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name),player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name)",
                "id": f"in.({id_list})",
            }):
                fixtures[str(f["id"])] = f
            for p in db.get("tennis_predictions", {
                "select": "fixture_id,settlement_status",
                "fixture_id": f"in.({id_list})",
            }):
                prev = main_status.get(str(p["fixture_id"]))
                cur = str(p.get("settlement_status") or "")
                # Any settled prediction on the match means the main system has a verified result.
                if prev not in MAIN_SETTLED:
                    main_status[str(p["fixture_id"])] = cur
        except Exception as err:
            stats["errors"] += 1
            print(f"[banter-tennis] Could not read results for a batch ({err}); those picks stay pending.")

    settled_at = now.isoformat()
    for pick in picks:
        fid = str(pick["fixture_id"])
        try:
            result = grade_pick(pick, fixtures.get(fid), main_status.get(fid), points)
        except Exception as err:
            stats["errors"] += 1
            print(f"[banter-tennis] Skipped pick {pick.get('id')}: {err}")
            continue
        if result is None:
            stats["left_pending"] += 1
            continue
        status, pts = result
        stats[status] += 1
        label = f"pick {pick['id']} MW={pick['selection']} -> {status} ({pts} pts)"
        if not live:
            print(f"[banter-tennis] DRY RUN would set {label}")
            continue
        try:
            db.patch(
                "tennis_user_picks",
                {"status": status, "points": pts, "settled_at": settled_at, "updated_at": settled_at},
                {"id": f"eq.{pick['id']}", "status": "eq.pending"},
            )
            stats["written"] += 1
            print(f"[banter-tennis] Set {label}")
        except Exception as err:
            stats["errors"] += 1
            print(f"[banter-tennis] Could not write {label}: {err}")

    print(f"[banter-tennis] {'LIVE' if live else 'DRY RUN'} summary: {json.dumps(stats)}")
    return stats


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Settle Banter Hub tennis picks from stored results.")
    parser.add_argument("--live", action="store_true", help="Write results (default is a dry run).")
    args = parser.parse_args(argv)
    try:
        run(live=args.live)
    except Exception as err:
        print(f"[banter-tennis] Run stopped early: {err}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
