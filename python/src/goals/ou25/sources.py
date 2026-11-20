"""
Over/Under 2.5 engine: external history and odds.

Results history and pre-match Over/Under 2.5 prices come from football-data.co.uk
(free CSV files). One run downloads at most ~45 small files, caches them on disk
for 12 hours, and touches Supabase zero times for history. This replaces the old
engine's 3,000-row fixture pull from Supabase plus an 18-day LiveScore scrape.
"""

from __future__ import annotations

import csv
import io
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import httpx
import numpy as np

CACHE_DIR = Path(__file__).resolve().parents[3] / "scratch" / "cache" / "ou25"
CACHE_TTL_SECONDS = 12 * 3600
BASE = "https://www.football-data.co.uk"

# Our league code -> ("main", division code) for the season files, or ("extra", country file).
LEAGUE_SOURCES: Dict[str, Tuple[str, str]] = {
    "ENG_PL": ("main", "E0"), "ENG_CH": ("main", "E1"), "ENG_L1": ("main", "E2"),
    "ENG_L2": ("main", "E3"), "ENG_NL": ("main", "EC"),
    "GER_BL": ("main", "D1"), "GER_2BL": ("main", "D2"),
    "ITA_SA": ("main", "I1"), "ITA_SB": ("main", "I2"),
    "ESP_LL": ("main", "SP1"), "ESP_LL2": ("main", "SP2"),
    "FRA_L1": ("main", "F1"), "FRA_L2": ("main", "F2"),
    "NED_ED": ("main", "N1"), "POR_PL": ("main", "P1"), "BEL_PL": ("main", "B1"),
    "TUR_SL": ("main", "T1"), "GRE_SL": ("main", "G1"),
    "SCO_PL": ("main", "SC0"), "SCO_CH": ("main", "SC1"),
    "AUT_BL": ("extra", "AUT"), "SUI_SL": ("extra", "SWZ"), "NOR_EL": ("extra", "NOR"),
    "SWE_AL": ("extra", "SWE"), "DEN_SL": ("extra", "DNK"), "USA_MLS": ("extra", "USA"),
    "BRA_SA": ("extra", "BRA"), "ARG_PD": ("extra", "ARG"), "MEX_LMX": ("extra", "MEX"),
    "JPN_J1": ("extra", "JPN"),
}
DIV_TO_LEAGUE = {div: code for code, (kind, div) in LEAGUE_SOURCES.items() if kind == "main"}


@dataclass
class LeagueHistory:
    """Finished league matches as parallel numpy arrays (one row per match)."""
    league: str
    days: np.ndarray          # float days since epoch (UTC date)
    home: List[str]
    away: List[str]
    hg: np.ndarray
    ag: np.ndarray


@dataclass
class UpcomingOdds:
    league: str
    date: str                 # YYYY-MM-DD
    home: str
    away: str
    over: float
    under: float


def _season_codes(now: datetime) -> List[str]:
    """football-data season folders for the current and previous season, e.g. 2627 and 2526."""
    start = now.year if now.month >= 7 else now.year - 1
    cur = f"{start % 100:02d}{(start + 1) % 100:02d}"
    prev = f"{(start - 1) % 100:02d}{start % 100:02d}"
    return [cur, prev]


def _fetch(url: str, client: httpx.Client) -> Optional[str]:
    """Download with a 12-hour disk cache; a stale cache copy is used if the site is down."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / url.replace(BASE, "").strip("/").replace("/", "_")
    if path.exists() and time.time() - path.stat().st_mtime < CACHE_TTL_SECONDS:
        return path.read_text(encoding="utf-8", errors="ignore")
    try:
        r = client.get(url, follow_redirects=True)
        if r.status_code == 200 and r.text.strip():
            path.write_text(r.text, encoding="utf-8")
            return r.text
    except Exception as e:  # network failure: fall back to whatever is cached
        print(f"⚠️ [OU25 sources] {url}: {e}")
    if path.exists():
        return path.read_text(encoding="utf-8", errors="ignore")
    return None


def _parse_date(s: str) -> Optional[datetime]:
    s = (s or "").strip()
    for fmt in ("%d/%m/%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _num(x) -> Optional[float]:
    try:
        v = float(x)
        return v if v > 1.0 else None
    except (TypeError, ValueError):
        return None


def _rows(text: str) -> List[Dict[str, str]]:
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))


def parse_history(league: str, rows: List[Dict[str, str]], kind: str, min_day: float) -> List[Tuple[float, str, str, int, int]]:
    out = []
    for r in rows:
        if kind == "main":
            h, a, hg, ag = r.get("HomeTeam"), r.get("AwayTeam"), r.get("FTHG"), r.get("FTAG")
        else:
            h, a, hg, ag = r.get("Home"), r.get("Away"), r.get("HG"), r.get("AG")
        d = _parse_date(r.get("Date", ""))
        if not (h and a and d) or hg in (None, "") or ag in (None, ""):
            continue
        day = d.timestamp() / 86400.0
        if day < min_day:
            continue
        try:
            out.append((day, h.strip(), a.strip(), int(float(hg)), int(float(ag))))
        except ValueError:
            continue
    return out


def load_histories(leagues: List[str], now: Optional[datetime] = None, lookback_days: int = 540) -> Dict[str, LeagueHistory]:
    """Downloads (or reads from cache) results for the requested leagues only."""
    now = now or datetime.now(timezone.utc)
    min_day = now.timestamp() / 86400.0 - lookback_days
    seasons = _season_codes(now)
    out: Dict[str, LeagueHistory] = {}
    with httpx.Client(timeout=30.0, headers={"User-Agent": "oddsbanta-ou25/1.0"}) as client:
        for lg in sorted(set(leagues)):
            src = LEAGUE_SOURCES.get(lg)
            if not src:
                continue
            kind, code = src
            urls = [f"{BASE}/mmz4281/{s}/{code}.csv" for s in seasons] if kind == "main" else [f"{BASE}/new/{code}.csv"]
            recs: List[Tuple[float, str, str, int, int]] = []
            for u in urls:
                txt = _fetch(u, client)
                if txt:
                    recs.extend(parse_history(lg, _rows(txt), kind, min_day))
            if not recs:
                continue
            recs = sorted(set(recs))
            arr = list(zip(*recs))
            out[lg] = LeagueHistory(
                league=lg,
                days=np.asarray(arr[0], dtype=float),
                home=list(arr[1]),
                away=list(arr[2]),
                hg=np.asarray(arr[3], dtype=float),
                ag=np.asarray(arr[4], dtype=float),
            )
    return out


def load_upcoming_odds() -> List[UpcomingOdds]:
    """Pre-match Over/Under 2.5 prices for the coming fixtures in the main leagues (one request)."""
    out: List[UpcomingOdds] = []
    with httpx.Client(timeout=30.0, headers={"User-Agent": "oddsbanta-ou25/1.0"}) as client:
        txt = _fetch(f"{BASE}/fixtures.csv", client)
    if not txt:
        return out
    for r in _rows(txt):
        lg = DIV_TO_LEAGUE.get((r.get("Div") or "").strip())
        d = _parse_date(r.get("Date", ""))
        if not lg or not d:
            continue
        o = _num(r.get("Avg>2.5")) or _num(r.get("B365>2.5")) or _num(r.get("Max>2.5"))
        u = _num(r.get("Avg<2.5")) or _num(r.get("B365<2.5")) or _num(r.get("Max<2.5"))
        if not o or not u:
            continue
        out.append(UpcomingOdds(lg, d.strftime("%Y-%m-%d"), r["HomeTeam"].strip(), r["AwayTeam"].strip(), o, u))
    return out


def devig(over: float, under: float) -> float:
    """Bookmaker Over 2.5 probability with the margin removed proportionally."""
    io_, iu = 1.0 / over, 1.0 / under
    return io_ / (io_ + iu)
