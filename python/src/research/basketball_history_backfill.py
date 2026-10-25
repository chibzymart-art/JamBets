"""
One-off historical backfill of FINISHED basketball games (ratings history only).

Why: ratings v2 needs history. Today teams have a median of 4 finished games, so only a handful of
games each week can honestly be rated 85%+. Earlier finished games from the same two sources the
engine already reads daily (ESPN scoreboard, LiveScore by date) fix that.

Safety, by construction:
- Only dates BEFORE the earliest fixture already stored are fetched, so no existing row is in range.
- Inserts use on_conflict=canonical_key with resolution=ignore-duplicates: an existing row is never
  modified, even if one somehow matched.
- Only games with status "finished" and both scores are written. Nothing scheduled or live, so
  fixture counts, the prediction runner (upcoming games only) and settlement are unaffected.
- No predictions are created. Each row is tagged metadata.backfill = true so it can be identified.
- One date at a time with a pause between dates (default 3 s).

Run from the "Basketball History Backfill" workflow (manual only), or locally:
    python -m python.src.research.basketball_history_backfill --start 20260101 --dry-run
"""

import argparse
import logging
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from python.src.basketball.config import LEAGUE_REGISTRY
from python.src.basketball.db import BasketballDbClient
from python.src.basketball.pipeline import BasketballIngestionPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [BASKETBALL-BACKFILL] %(message)s",
                    handlers=[logging.StreamHandler(sys.stdout)])
logger = logging.getLogger("basketball.history_backfill")


def earliest_stored_kickoff(db: BasketballDbClient) -> Optional[datetime]:
    rows = db.client.get("/basketball_fixtures", params={
        "select": "target_kickoff_at", "order": "target_kickoff_at.asc", "limit": "1"}).json()
    if not rows:
        return None
    return datetime.fromisoformat(rows[0]["target_kickoff_at"].replace("Z", "+00:00"))


def fetch_finished_for_date(pipe: BasketballIngestionPipeline, date_str: str) -> Dict[str, Dict[str, Any]]:
    found: Dict[str, Dict[str, Any]] = {}
    for code, cfg in LEAGUE_REGISTRY.items():
        if cfg.espn_slug:
            try:
                for f in pipe.espn.fetch_scoreboard(code, date_str):
                    found[f["canonical_key"]] = f
            except Exception as e:
                logger.warning("ESPN %s %s failed: %s", code, date_str, e)
    try:
        for f in pipe.livescore.fetch_matches_by_date(date_str):
            found.setdefault(f["canonical_key"], f)
    except Exception as e:
        logger.warning("LiveScore %s failed: %s", date_str, e)
    return {k: f for k, f in found.items()
            if f.get("status") == "finished" and f.get("home_score") is not None and f.get("away_score") is not None}


def insert_ignore_existing(db: BasketballDbClient, rows: List[Dict[str, Any]]) -> int:
    if not rows:
        return 0
    headers = dict(db.headers)
    headers["Prefer"] = "return=minimal,resolution=ignore-duplicates"
    resp = db.client.post("/basketball_fixtures", json=rows, headers=headers, params={"on_conflict": "canonical_key"})
    if resp.status_code in (200, 201, 204):
        return len(rows)
    logger.warning("Batch insert failed (%s), retrying one by one: %s", resp.status_code, resp.text[:200])
    ok = 0
    for r in rows:
        one = db.client.post("/basketball_fixtures", json=r, headers=headers, params={"on_conflict": "canonical_key"})
        if one.status_code in (200, 201, 204):
            ok += 1
        else:
            logger.warning("Skipped %s: %s", r.get("canonical_key"), one.text[:200])
    return ok


def run(start: str, end: Optional[str], sleep_s: float, dry_run: bool) -> Dict[str, Any]:
    db = BasketballDbClient()
    pipe = BasketballIngestionPipeline(db_client=db)
    pipe.sync_leagues()

    earliest = earliest_stored_kickoff(db)
    if earliest is None:
        raise SystemExit("No stored fixtures found; refusing to backfill without a known boundary.")
    boundary = earliest.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start_dt = datetime.strptime(start, "%Y%m%d").replace(tzinfo=timezone.utc)
    end_dt = datetime.strptime(end, "%Y%m%d").replace(tzinfo=timezone.utc) if end else boundary - timedelta(days=1)
    end_dt = min(end_dt, boundary - timedelta(days=1))
    logger.info("Earliest stored fixture %s. Backfilling finished games %s to %s%s.", earliest.isoformat(),
                start_dt.date(), end_dt.date(), " (dry run)" if dry_run else "")

    per_league: Counter = Counter()
    inserted = 0
    day = start_dt
    while day <= end_dt:
        date_str = day.strftime("%Y%m%d")
        games = fetch_finished_for_date(pipe, date_str)
        rows = []
        for key, f in games.items():
            kickoff = datetime.fromisoformat(f["target_kickoff_at"].replace("Z", "+00:00"))
            if kickoff >= earliest:
                continue
            hn, an = (f.get("home_team_name") or "").strip(), (f.get("away_team_name") or "").strip()
            if hn.lower() in ("", "tbd", "to be decided", "unknown team") or an.lower() in ("", "tbd", "to be decided", "unknown team"):
                continue
            per_league[f["league_code"]] += 1
            if dry_run:
                continue
            league_id = pipe._league_cache.get(f["league_code"])
            if not league_id:
                continue
            home_id = pipe.get_or_create_team(hn, league_id=league_id)
            away_id = pipe.get_or_create_team(an, league_id=league_id)
            if not home_id or not away_id:
                continue
            rows.append({
                "canonical_key": key, "league_id": league_id, "home_team_id": home_id, "away_team_id": away_id,
                "target_kickoff_at": f["target_kickoff_at"], "status": "finished",
                "home_score": int(f["home_score"]), "away_score": int(f["away_score"]),
                "period_scores": f.get("period_scores", {"home": [], "away": []}),
                "home_rest_days": 1, "away_rest_days": 1, "is_home_b2b": False, "is_away_b2b": False,
                "metadata": {"source": f.get("source"), "provider_event_id": f.get("provider_event_id"), "backfill": True},
            })
        if not dry_run:
            inserted += insert_ignore_existing(db, rows)
        logger.info("%s: %d finished games found, %d written so far", date_str, len(games), inserted)
        day += timedelta(days=1)
        time.sleep(sleep_s)

    summary = {"from": str(start_dt.date()), "to": str(end_dt.date()), "games_found": sum(per_league.values()),
               "written": inserted, "dry_run": dry_run, "by_league": dict(per_league.most_common())}
    logger.info("Backfill summary: %s", summary)
    pipe.close()
    db.close()
    return summary


def main() -> None:
    ap = argparse.ArgumentParser(description="Backfill finished basketball games before the first stored fixture.")
    ap.add_argument("--start", required=True, help="YYYYMMDD")
    ap.add_argument("--end", default=None, help="YYYYMMDD (capped at the day before the first stored fixture)")
    ap.add_argument("--sleep", type=float, default=3.0)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    run(a.start, a.end, a.sleep, a.dry_run)


if __name__ == "__main__":
    main()
