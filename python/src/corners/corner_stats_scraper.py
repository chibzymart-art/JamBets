"""
JamBets — Dedicated Corner Statistics Scraper
Extracts official, authentic match corner kick counts (corners_home, corners_away)
for completed football fixtures from ESPN Boxscores and FotMob match details.
Strictly zero synthetic or fabricated corner counts.
"""

import sys
import os
import re
import unicodedata
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, Optional, Tuple, List
import httpx

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
from python.src.config import LEAGUE_REGISTRY, LeagueConfig
from python.src.sources.base import USER_AGENT_POOL
import random


class CornerStatsScraper:
    """
    Dedicated scraper for genuine match corner kick statistics.
    Primary Source: ESPN Match Summary Boxscore (wonCorners).
    Secondary Source: FotMob MatchDetails (Corner kicks).
    """

    ESPN_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer"
    FOTMOB_BASE_URL = "https://www.fotmob.com/api"

    def __init__(self, timeout: float = 12.0):
        self.timeout = timeout
        self.client = httpx.Client(timeout=timeout, follow_redirects=True)
        self._scoreboard_cache: Dict[str, List[Dict[str, Any]]] = {}

    @staticmethod
    def normalize_name(name: str) -> str:
        """Normalizes team name for resilient token matching."""
        if not name:
            return ""
        # Strip accents (e.g. Grêmio -> Gremio)
        nfkd = unicodedata.normalize('NFKD', name)
        ascii_str = "".join([c for c in nfkd if not unicodedata.combining(c)])
        # Lowercase, strip punctuation and club designations
        clean = ascii_str.lower().replace("-", " ")
        clean = re.sub(r"\b(fc|cf|sc|ac|cd|afc|fk|sk|bk|fr|ca|cr|rc|ud|us|as|vv|sv)\b", "", clean)
        clean = re.sub(r"[^\w\s]", "", clean)
        return " ".join(clean.split()).strip()

    def _get_headers(self) -> Optional[Dict[str, str]]:
        return None

    def fetch_match_corners(
        self,
        home_name: str,
        away_name: str,
        kickoff_time: datetime,
        league_code: Optional[str] = None
    ) -> Optional[Tuple[int, int]]:
        """
        Attempts to scrape official match corner statistics.
        Returns (corners_home, corners_away) or None if unverified/unavailable.
        """
        # 1. Primary: Try ESPN Official Boxscore
        corners = self._fetch_espn_corners(home_name, away_name, kickoff_time, league_code)
        if corners is not None:
            return corners

        # 2. Secondary: Try FotMob Match Details
        corners = self._fetch_fotmob_corners(home_name, away_name, kickoff_time, league_code)
        if corners is not None:
            return corners

        return None

    def _fetch_espn_corners(
        self,
        home_name: str,
        away_name: str,
        kickoff_time: datetime,
        league_code: Optional[str]
    ) -> Optional[Tuple[int, int]]:
        """Queries ESPN Scoreboard and Boxscore for genuine wonCorners."""
        if not league_code:
            return None

        league_cfg = LEAGUE_REGISTRY.get(league_code)
        espn_slug = league_cfg.espn_slug if league_cfg else None
        if not espn_slug:
            return None

        norm_h = self.normalize_name(home_name)
        norm_a = self.normalize_name(away_name)
        if not norm_h or not norm_a:
            return None

        # ESPN scoreboards can be offset around UTC midnight; check kickoff date and adjacent days
        date_candidates = [
            kickoff_time.strftime("%Y%m%d"),
            (kickoff_time - timedelta(hours=12)).strftime("%Y%m%d"),
            (kickoff_time + timedelta(hours=12)).strftime("%Y%m%d")
        ]
        # Deduplicate while preserving order
        date_candidates = list(dict.fromkeys(date_candidates))

        matched_event_id = None
        matched_home_first = True

        for d_str in date_candidates:
            cache_key = f"{espn_slug}:{d_str}"
            if cache_key in self._scoreboard_cache:
                events = self._scoreboard_cache[cache_key]
            else:
                url = f"{self.ESPN_BASE_URL}/{espn_slug}/scoreboard?dates={d_str}"
                try:
                    resp = self.client.get(url, headers=self._get_headers())
                    if resp.status_code == 200:
                        data = resp.json()
                        events = data.get("events", [])
                        self._scoreboard_cache[cache_key] = events
                    else:
                        events = []
                except Exception:
                    events = []

            for ev in events:
                ev_name = self.normalize_name(ev.get("name", ""))
                comp = (ev.get("competitions") or [{}])[0]
                competitors = comp.get("competitors", [])
                if len(competitors) < 2:
                    continue

                c_home = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0])
                c_away = next((c for c in competitors if c.get("homeAway") == "away"), competitors[1])

                ev_h = self.normalize_name(c_home.get("team", {}).get("displayName", ""))
                ev_a = self.normalize_name(c_away.get("team", {}).get("displayName", ""))

                # Match by token overlap (tokens >= 3 chars)
                h_tokens = [t for t in norm_h.split() if len(t) >= 3]
                a_tokens = [t for t in norm_a.split() if len(t) >= 3]
                h_match = any(t in ev_h or ev_h in t for t in h_tokens) if h_tokens else norm_h in ev_h
                a_match = any(t in ev_a or ev_a in t for t in a_tokens) if a_tokens else norm_a in ev_a

                if h_match and a_match:
                    matched_event_id = ev.get("id")
                    break

            if matched_event_id:
                break

        if not matched_event_id:
            return None

        # Fetch official match summary boxscore
        sum_url = f"{self.ESPN_BASE_URL}/{espn_slug}/summary?event={matched_event_id}"
        try:
            sum_resp = self.client.get(sum_url, headers=self._get_headers())
            if sum_resp.status_code != 200:
                return None
            s_data = sum_resp.json()
            box = s_data.get("boxscore", {})
            teams = box.get("teams", [])
            if len(teams) < 2:
                return None

            # Identify home vs away teams in boxscore
            t_home = next((t for t in teams if t.get("homeAway") == "home"), teams[0])
            t_away = next((t for t in teams if t.get("homeAway") == "away"), teams[1])

            ch_str = next((s.get("displayValue") for s in t_home.get("statistics", []) if s.get("name") == "wonCorners"), None)
            ca_str = next((s.get("displayValue") for s in t_away.get("statistics", []) if s.get("name") == "wonCorners"), None)

            if ch_str is not None and ca_str is not None:
                return int(ch_str), int(ca_str)
        except Exception:
            return None

        return None

    def _fetch_fotmob_corners(
        self,
        home_name: str,
        away_name: str,
        kickoff_time: datetime,
        league_code: Optional[str]
    ) -> Optional[Tuple[int, int]]:
        """Fallback: Queries FotMob match details for official corner kicks."""
        try:
            date_str = kickoff_time.strftime("%Y%m%d")
            url = f"{self.FOTMOB_BASE_URL}/matches?date={date_str}"
            resp = self.client.get(url, headers=self._get_headers())
            if resp.status_code != 200:
                return None
            data = resp.json()

            norm_h = self.normalize_name(home_name)
            norm_a = self.normalize_name(away_name)

            matched_match_id = None
            for lg in data.get("leagues", []):
                for m in lg.get("matches", []):
                    m_h = self.normalize_name(m.get("home", {}).get("name", ""))
                    m_a = self.normalize_name(m.get("away", {}).get("name", ""))

                    h_match = any(t in m_h for t in norm_h.split()) or any(t in norm_h for t in m_h.split())
                    a_match = any(t in m_a for t in norm_a.split()) or any(t in norm_a for t in m_a.split())

                    if h_match and a_match:
                        matched_match_id = m.get("id")
                        break
                if matched_match_id:
                    break

            if not matched_match_id:
                return None

            # Fetch FotMob match details
            det_url = f"{self.FOTMOB_BASE_URL}/matchDetails?matchId={matched_match_id}"
            det_resp = self.client.get(det_url, headers=self._get_headers())
            if det_resp.status_code != 200:
                return None
            det_data = det_resp.json()

            stats_periods = det_data.get("content", {}).get("stats", {}).get("Periods", {}).get("All", {}).get("stats", [])
            for grp in stats_periods:
                for s in grp.get("stats", []):
                    title = s.get("title", "").lower()
                    if "corner" in title:
                        vals = s.get("stats", [])
                        if len(vals) >= 2:
                            return int(vals[0]), int(vals[1])
        except Exception:
            return None

        return None

    def enrich_fixture_corners(
        self,
        fixture: Dict[str, Any],
        db: Any
    ) -> Optional[Tuple[int, int]]:
        """
        Enriches a completed fixture with official corner counts.
        Updates football_fixtures in Supabase if scraped.
        """
        # 1. If fixture already has verified corners, return directly
        ch = fixture.get("corners_home")
        ca = fixture.get("corners_away")
        if ch is not None and ca is not None:
            return int(ch), int(ca)

        fid = fixture["id"]
        lid = fixture.get("league_id")
        hid = fixture.get("home_team_id")
        aid = fixture.get("away_team_id")

        # Resolve team and league names
        h_record = db.get("football_teams", {"id": f"eq.{hid}", "select": "name"}) if hid else []
        a_record = db.get("football_teams", {"id": f"eq.{aid}", "select": "name"}) if aid else []
        l_record = db.get("football_leagues", {"id": f"eq.{lid}", "select": "code"}) if lid else []

        home_name = h_record[0]["name"] if h_record else ""
        away_name = a_record[0]["name"] if a_record else ""
        league_code = l_record[0]["code"] if l_record else None

        kickoff_str = fixture.get("target_kickoff_at")
        try:
            kickoff_dt = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00")) if kickoff_str else datetime.now(timezone.utc)
        except Exception:
            kickoff_dt = datetime.now(timezone.utc)

        corners = self.fetch_match_corners(
            home_name=home_name,
            away_name=away_name,
            kickoff_time=kickoff_dt,
            league_code=league_code
        )

        if corners:
            c_home, c_away = corners
            # Persist authentic corners to football_fixtures
            db.patch("football_fixtures", {
                "corners_home": c_home,
                "corners_away": c_away
            }, {"id": f"eq.{fid}"})
            print(f"  [CornerStatsScraper] Scraped verified corners for {home_name} vs {away_name}: {c_home} Home - {c_away} Away")
            return c_home, c_away

        return None
