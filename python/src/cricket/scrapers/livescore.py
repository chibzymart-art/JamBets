"""
LiveScore public cricket scraper (main live source).

Same public app API family our tennis, basketball and football scrapers
use. Verified 21 Nov 2026 from a cloud server:

  /date/cricket/{YYYYMMDD}/0     fixtures and scores for a day
  /scoreboard/cricket/{Eid}      innings scores, toss, venue, result
  /lineups/cricket/{Eid}         both XIs with roles (published at the toss)
  /info/cricket/{Eid}            venue, umpires

Toss fields: TPa = team number that won the toss (1 or 2, 0 = not yet),
TCho = choice (1 bat, 2 field; checked against Cricsheet for Oman v
Netherlands, 2 Nov 2026: Netherlands won the toss and fielded -> TPa 2, TCho 2).

The scraper fails loudly (raises) on HTTP errors or a changed payload shape,
so a silent empty feed like the tennis key bug of 9 Nov cannot recur.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger("cricket.scraper.livescore")

BASE = "https://prod-public-api.livescore.com/v1/api/app"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json",
}

# LiveScore EtTx -> engine format (None = out of launch scope)
FORMAT_MAP = {
    "Twenty20": "T20", "Domestic Twenty20": "T20", "T20": "T20",
    "ODI": "ODI", "One Day International": "ODI",
}

# Launch-scope stages by name keyword (men's T20I, ODI and the major leagues)
LEAGUE_KEYWORDS = (
    "indian premier league", "big bash league", "pakistan super league",
    "caribbean premier league", "sa20", "the hundred", "t20 blast", "vitality blast",
    "bangladesh premier league", "international league t20", "major league cricket",
    "super smash", "lanka premier league",
)


class LiveScoreError(RuntimeError):
    pass


def status_of(eps: Optional[str], epr: Optional[int]) -> str:
    e = str(eps or "").upper()
    if e.startswith("CANC") or e.startswith("ABAN") or e in ("NR", "NO RESULT"):
        return "abandoned"
    if e.startswith("POSTP"):
        return "postponed"
    if epr == 2 or e in ("FT", "FIN"):
        return "finished"
    if epr == 1:
        return "live"
    return "scheduled"


def parse_start(esd) -> Optional[str]:
    try:
        return datetime.strptime(str(esd), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


@dataclass
class Fixture:
    event_id: str
    stage: str
    country: str
    fmt: str
    home: str
    away: str
    home_id: Optional[str]
    away_id: Optional[str]
    start_utc: Optional[str]
    status: str
    round_info: Optional[str]
    result_text: Optional[str]
    toss_winner: Optional[str] = None
    toss_decision: Optional[str] = None
    venue: Optional[str] = None
    city: Optional[str] = None
    neutral: Optional[bool] = None
    innings: List[Dict] = field(default_factory=list)
    lineups: Dict[str, List[Dict]] = field(default_factory=dict)


def in_scope(stage: str, country: str, fmt: Optional[str], home: str, away: str) -> bool:
    if fmt is None:
        return False
    s = f"{country} {stage}".lower()
    if " w " in f" {home.lower()} " or home.endswith(" W") or "women" in s:
        return False  # men's only at launch
    if fmt == "ODI":
        return "one day" in s or "odi" in s or "world cup" in s or "series" in s
    if any(k in s for k in LEAGUE_KEYWORDS):
        return True
    return "twenty20 international" in s or "t20 international" in s or "t20i" in s or "world cup" in s


class LiveScoreCricket:
    def __init__(self, client: Optional[httpx.Client] = None, timeout: float = 20.0):
        self.client = client or httpx.Client(timeout=timeout, headers=HEADERS)

    def _get(self, path: str) -> dict:
        r = self.client.get(f"{BASE}/{path}", params={"locale": "en"})
        if r.status_code != 200:
            raise LiveScoreError(f"{path}: HTTP {r.status_code}")
        try:
            return r.json()
        except ValueError as exc:
            raise LiveScoreError(f"{path}: not JSON") from exc

    def fixtures(self, day: str, scope_only: bool = True) -> List[Fixture]:
        """day = YYYYMMDD."""
        data = self._get(f"date/cricket/{day}/0")
        if "Stages" not in data:
            raise LiveScoreError("date payload has no Stages: format changed?")
        out = []
        for st in data["Stages"]:
            stage, country = st.get("Snm", ""), st.get("Cnm", "")
            for e in st.get("Events", []):
                fmt = FORMAT_MAP.get(e.get("EtTx"))
                home = (e.get("T1") or [{}])[0].get("Nm", "")
                away = (e.get("T2") or [{}])[0].get("Nm", "")
                if scope_only and not in_scope(stage, country, fmt, home, away):
                    continue
                out.append(Fixture(
                    event_id=str(e["Eid"]), stage=stage, country=country, fmt=fmt or "",
                    home=home, away=away,
                    home_id=(e.get("T1") or [{}])[0].get("ID"),
                    away_id=(e.get("T2") or [{}])[0].get("ID"),
                    start_utc=parse_start(e.get("Esd")),
                    status=status_of(e.get("Eps"), e.get("Epr")),
                    round_info=e.get("ErnInf"), result_text=e.get("ECo"),
                    toss_winner=self._toss_team(e, home, away),
                    toss_decision=self._toss_choice(e),
                ))
        return out

    @staticmethod
    def _toss_team(e: dict, home: str, away: str) -> Optional[str]:
        return {1: home, 2: away}.get(int(e.get("TPa") or 0))

    @staticmethod
    def _toss_choice(e: dict) -> Optional[str]:
        return {1: "bat", 2: "field"}.get(int(e.get("TCho") or 0))

    def enrich(self, fx: Fixture) -> Fixture:
        """Add toss, venue, innings scores and XIs (when announced)."""
        sb = self._get(f"scoreboard/cricket/{fx.event_id}")
        fx.toss_winner = self._toss_team(sb, fx.home, fx.away) or fx.toss_winner
        fx.toss_decision = self._toss_choice(sb) or fx.toss_decision
        v = sb.get("Venue") or {}
        fx.venue, fx.city = v.get("Vnm"), v.get("Vcy")
        fx.neutral = bool(v.get("Vneut")) if v else None
        fx.status = status_of(sb.get("Eps"), sb.get("Epr"))
        fx.result_text = sb.get("ECo") or fx.result_text
        fx.innings = []
        for n in (1, 2):
            for side, team in ((1, fx.home), (2, fx.away)):
                runs = sb.get(f"Tr{side}C{n}")
                if runs is None:
                    continue
                fx.innings.append({"team": team, "innings": n, "runs": runs,
                                   "wickets": sb.get(f"Tr{side}CW{n}"),
                                   "overs": sb.get(f"Tr{side}CO{n}")})
        lu = self._get(f"lineups/cricket/{fx.event_id}")
        fx.lineups = {}
        for t in lu.get("Lu") or []:
            team = fx.home if t.get("Tnb") == 1 else fx.away
            fx.lineups[team] = [{
                "provider_id": p.get("Pid"),
                "name": p.get("Snm"),
                "full_name": f"{p.get('Fn', '')} {p.get('Ln', '')}".strip(),
                "role_code": p.get("Pos"),
            } for p in t.get("Ps") or []]
        return fx
