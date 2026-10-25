"""
Basketball stale-fixture reconciler (runs inside every settlement cycle).

Problem it fixes: a fixture could stay "scheduled" or "live" forever, so its prediction never settled.
Seen in production (25 Oct 2026, 190 fixtures, 139 pending picks):
- finished overtime games: LiveScore keeps the text "OT" after the final buzzer (fixed in the scraper
  too, by reading LiveScore's progress code);
- postponed games: LiveScore writes "Postp." with a dot, which the old mapping missed;
- rescheduled games: the canonical key holds the date, so a moved game arrives under a NEW key and
  the old row was never touched again;
- anything older than the 3-day score refresh was never looked at again.

What it does, for fixtures still scheduled/live more than 3 hours after tip-off, up to 21 days back:
1. Re-reads the results feeds for those fixtures' own dates (and the day after).
2. Matches by canonical key, then by the provider event id stored on the fixture.
3. Same game finished / cancelled / postponed in the feed: writes that result to the row.
4. Same event id now under a different key that has not finished (moved to another day): marks the
   old row postponed, with metadata.rescheduled_to, so its pick voids after the usual 48h.
5. Still no result 48h after tip-off: marks the row postponed with metadata.unresolved = true, so the
   pick voids instead of staying pending forever.
Only the stale rows are updated, and only their status/score fields and metadata.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from python.src.basketball.config import LEAGUE_REGISTRY

logger = logging.getLogger("basketball.reconcile")

MIN_AGE_HOURS = 3
MAX_AGE_DAYS = 21
GIVE_UP_DAYS = 2  # no result 48h after tip-off: the feed will not publish one (same window as postponed)
FINAL_STATES = ("finished", "cancelled", "postponed")


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(str(ts).replace("Z", "+00:00"))


def find_stale(db, now: datetime, max_age_days: int = MAX_AGE_DAYS) -> List[Dict[str, Any]]:
    resp = db.client.get("/basketball_fixtures", params={
        "select": "id,canonical_key,target_kickoff_at,status,metadata,league_id",
        "status": "in.(scheduled,live)",
        "target_kickoff_at": f"lt.{(now - timedelta(hours=MIN_AGE_HOURS)).isoformat()}",
        "and": f"(target_kickoff_at.gt.{(now - timedelta(days=max_age_days)).isoformat()})",
        "order": "target_kickoff_at.asc",
        "limit": "1000",
    })
    resp.raise_for_status()
    return resp.json() or []


def fetch_feed(pipeline, dates: List[str]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for d in dates:
        for code, cfg in LEAGUE_REGISTRY.items():
            if cfg.espn_slug:
                try:
                    items.extend(pipeline.espn.fetch_scoreboard(code, d))
                except Exception as e:
                    logger.warning("ESPN %s %s failed: %s", code, d, e)
        try:
            items.extend(pipeline.livescore.fetch_matches_by_date(d))
        except Exception as e:
            logger.warning("LiveScore %s failed: %s", d, e)
    return items


def decide(row: Dict[str, Any], by_key: Dict[str, Dict[str, Any]], by_eid: Dict[Tuple[str, str], Dict[str, Any]],
           now: datetime) -> Optional[Dict[str, Any]]:
    """Return the update for one stale row, or None to leave it for a later cycle."""
    meta = dict(row.get("metadata") or {})
    key = row.get("canonical_key")
    eid = str(meta.get("provider_event_id") or "")
    src = str(meta.get("source") or "")
    hit = by_key.get(key)
    moved = False
    if hit is None and eid:
        hit = by_eid.get((src, eid))
        moved = hit is not None and hit.get("canonical_key") != key

    if hit is not None and hit.get("status") in FINAL_STATES:
        upd = {"status": hit["status"]}
        if hit["status"] == "finished":
            upd.update({
                "home_score": int(hit.get("home_score") or 0),
                "away_score": int(hit.get("away_score") or 0),
                "period_scores": hit.get("period_scores") or {"home": [], "away": []},
                "current_period": hit.get("current_period") or "Final",
            })
        meta["reconciled_at"] = now.isoformat()
        if moved:
            meta["matched_event_key"] = hit.get("canonical_key")
        upd["metadata"] = meta
        return upd

    if hit is not None and moved:
        meta.update({"rescheduled_to": hit.get("canonical_key"), "reconciled_at": now.isoformat()})
        return {"status": "postponed", "metadata": meta}

    if now - _parse(row["target_kickoff_at"]) > timedelta(days=GIVE_UP_DAYS):
        meta.update({"unresolved": True, "reconciled_at": now.isoformat()})
        return {"status": "postponed", "metadata": meta}
    return None


def reconcile_stale_fixtures(db, pipeline, max_age_days: int = MAX_AGE_DAYS, dry_run: bool = False,
                             now: Optional[datetime] = None) -> Dict[str, Any]:
    now = now or datetime.now(timezone.utc)
    stale = find_stale(db, now, max_age_days)
    summary = {"stale": len(stale), "finished": 0, "cancelled": 0, "postponed": 0, "rescheduled": 0,
               "unresolved": 0, "left": 0, "dry_run": dry_run}
    if not stale:
        return summary

    dates = set()
    for r in stale:
        k = _parse(r["target_kickoff_at"]).astimezone(timezone.utc)
        dates.add(k.strftime("%Y%m%d"))
        dates.add((k + timedelta(days=1)).strftime("%Y%m%d"))
    dates = sorted(d for d in dates if d <= now.strftime("%Y%m%d"))
    feed = fetch_feed(pipeline, dates)
    by_key = {f["canonical_key"]: f for f in feed if f.get("canonical_key")}
    by_eid = {(str(f.get("source") or ""), str(f.get("provider_event_id"))): f for f in feed if f.get("provider_event_id")}

    for r in stale:
        upd = decide(r, by_key, by_eid, now)
        if upd is None:
            summary["left"] += 1
            continue
        meta = upd.get("metadata") or {}
        if meta.get("rescheduled_to"):
            summary["rescheduled"] += 1
        elif meta.get("unresolved"):
            summary["unresolved"] += 1
        else:
            summary[upd["status"]] += 1
        if dry_run:
            continue
        try:
            headers = dict(db.headers)
            headers["Prefer"] = "return=minimal"
            resp = db.client.patch("/basketball_fixtures", json=upd, headers=headers,
                                   params={"id": f"eq.{r['id']}", "status": "in.(scheduled,live)"})
            resp.raise_for_status()
        except Exception as e:
            logger.warning("Reconcile update failed for %s: %s", r.get("canonical_key"), e)
    logger.info("Stale fixture reconcile: %s (dates checked: %d)", summary, len(dates))
    return summary
