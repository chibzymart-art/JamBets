"""
Cricbuzz scraper (backup and cross-check source).

Verified 21 Nov 2026 from a cloud server:

  https://www.cricbuzz.com/cricket-match/live-scores     page listing match IDs
  https://www.cricbuzz.com/api/mcenter/scorecard/{id}    JSON: toss, venue with
      latitude/longitude (used for weather), state, result, scorecard, and a
      winProbability block that carries bookmaker-style decimal odds
      (odds.team1_point / team2_point) when available.

Cricbuzz player IDs map exactly to the Cricsheet register's key_cricbuzz.
Cricbuzz's terms do not allow scraping; we fetch only a few pages per match
and treat this as a cross-check, never the only source.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger("cricket.scraper.cricbuzz")

BASE = "https://www.cricbuzz.com"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
}
MATCH_LINK = re.compile(r"/live-cricket-scores/(\d+)/([a-z0-9-]+)|cricket-scores/(\d+)/([a-z0-9-]+)")


class CricbuzzError(RuntimeError):
    pass


@dataclass
class CricbuzzMatch:
    match_id: str
    fmt: Optional[str]
    description: Optional[str]
    series: Optional[str]
    team1: Optional[str]
    team2: Optional[str]
    start_utc: Optional[str]
    state: Optional[str]
    status: Optional[str]
    toss_winner: Optional[str]
    toss_decision: Optional[str]  # bat | field
    venue: Optional[str]
    city: Optional[str]
    country: Optional[str]
    latitude: Optional[float]
    longitude: Optional[float]
    winner: Optional[str]
    complete: bool
    odds: Dict[str, float] = field(default_factory=dict)          # team name -> decimal odds
    win_probability: Dict[str, float] = field(default_factory=dict)  # team name -> %
    innings: List[Dict] = field(default_factory=list)


def match_ids_from_html(html: str) -> List[str]:
    seen, out = set(), []
    for m in MATCH_LINK.finditer(html):
        mid = m.group(1) or m.group(3)
        if mid and mid not in seen:
            seen.add(mid)
            out.append(mid)
    return out


def _f(x) -> Optional[float]:
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse_mcenter(data: dict) -> CricbuzzMatch:
    h = data.get("matchHeader")
    if not isinstance(h, dict) or "matchId" not in h:
        raise CricbuzzError("mcenter payload has no matchHeader: format changed?")
    t1 = (h.get("team1") or {}).get("name")
    t2 = (h.get("team2") or {}).get("name")
    toss = h.get("tossResults") or {}
    dec = (toss.get("decision") or "").lower()
    decision = "bat" if dec.startswith("bat") else ("field" if dec.startswith(("bowl", "field")) else None)
    v = h.get("venue") or {}
    start = h.get("matchStartTimestamp")
    res = h.get("result") or {}
    wp = data.get("winProbability") or {}
    odds, prob = {}, {}
    for side, name in (("team1", t1), ("team2", t2)):
        blk = wp.get(side) or {}
        if name and blk.get("percent") is not None:
            prob[name] = float(blk["percent"])
        o = _f((wp.get("odds") or {}).get(f"{side}_point"))
        if name and o and o > 1.0:
            odds[name] = o
    innings = []
    for inn in data.get("scoreCard") or []:
        sd = inn.get("scoreDetails") or {}
        bt = inn.get("batTeamDetails") or {}
        innings.append({"team": bt.get("batTeamName"), "runs": sd.get("runs"),
                        "wickets": sd.get("wickets"), "overs": sd.get("overs")})
    return CricbuzzMatch(
        match_id=str(h["matchId"]), fmt=h.get("matchFormat"), description=h.get("matchDescription"),
        series=h.get("seriesName"), team1=t1, team2=t2,
        start_utc=datetime.fromtimestamp(start / 1000, timezone.utc).isoformat() if start else None,
        state=h.get("state"), status=h.get("status"),
        toss_winner=toss.get("tossWinnerName") or None, toss_decision=decision,
        venue=v.get("name"), city=v.get("city"), country=v.get("country"),
        latitude=_f(v.get("latitude")), longitude=_f(v.get("longitude")),
        winner=res.get("winningTeam") or None,
        complete=bool(h.get("complete") or data.get("isMatchComplete")),
        odds=odds, win_probability=prob, innings=innings,
    )


class CricbuzzCricket:
    def __init__(self, client: Optional[httpx.Client] = None, timeout: float = 20.0):
        self.client = client or httpx.Client(timeout=timeout, headers=HEADERS, follow_redirects=True)

    def live_match_ids(self) -> List[str]:
        r = self.client.get(f"{BASE}/cricket-match/live-scores")
        if r.status_code != 200:
            raise CricbuzzError(f"live-scores: HTTP {r.status_code}")
        ids = match_ids_from_html(r.text)
        if not ids:
            raise CricbuzzError("live-scores page had no match links: format changed?")
        return ids

    def match(self, match_id: str) -> CricbuzzMatch:
        r = self.client.get(f"{BASE}/api/mcenter/scorecard/{match_id}")
        if r.status_code != 200:
            raise CricbuzzError(f"mcenter {match_id}: HTTP {r.status_code}")
        try:
            data = r.json()
        except ValueError as exc:
            raise CricbuzzError(f"mcenter {match_id}: not JSON") from exc
        return parse_mcenter(data)
