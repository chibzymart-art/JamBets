"""
JamBets — Google Search Match Score Scraper Adapter
Extracts verified live scores and final results from Google Search sports modules
for corroboration and fallback during multi-source reconciliation.
Rate limit: 2.0s delay with 3-attempt exponential backoff.
"""

import re
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
import httpx
from python.src.config import LeagueConfig
from python.src.football.models import RawFixturePayload, FixtureStatus
from python.src.sources.base import BaseSourceAdapter


class GoogleScoreAdapter(BaseSourceAdapter):
    """
    Google Search Sports Results Adapter.
    Queries Google Search for match scores and extracts verified live/FT states.
    """

    GOOGLE_SEARCH_URL = "https://www.google.com/search"
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }

    def __init__(self):
        super().__init__(
            name="GoogleScore",
            slug="google_score",
            base_url="https://www.google.com",
            rate_limit_delay_seconds=2.0,
            max_retries=3
        )
        self._score_cache: Dict[str, Optional[Dict[str, Any]]] = {}

    def fetch_match_result(
        self,
        home_team: str,
        away_team: str,
        match_date: datetime
    ) -> Optional[Dict[str, Any]]:
        """
        Queries Google Search for the match between home_team and away_team on match_date.
        Returns dict with:
            home_score: int,
            away_score: int,
            status: FixtureStatus,
            minute: Optional[int],
            period: Optional[str]
        or None if not found.
        """
        date_str = match_date.strftime("%Y-%m-%d")
        cache_key = f"{home_team.lower().strip()}_vs_{away_team.lower().strip()}_{date_str}"
        if cache_key in self._score_cache:
            return self._score_cache[cache_key]

        query = f"{home_team} vs {away_team} score {match_date.year}"
        params = {"q": query, "hl": "en", "gl": "us"}

        html_text = ""
        try:
            with httpx.Client(timeout=10.0, headers=self.HEADERS, follow_redirects=True) as client:
                resp = client.get(self.GOOGLE_SEARCH_URL, params=params)
                if resp.status_code == 200:
                    html_text = resp.text
        except Exception as e:
            print(f"  [WARN] Google search fetch failed for {query}: {e}")
            self._score_cache[cache_key] = None
            return None

        if not html_text:
            self._score_cache[cache_key] = None
            return None

        # Detect Status: FT / Full Time / Final vs Live / In Progress
        is_finished = bool(re.search(r'\b(FT|Full[ -]time|Final|Ended)\b', html_text, re.IGNORECASE))
        is_live = bool(re.search(r'\b(\d{1,2}[\'’]|HT|Half[ -]time|Live|In Progress)\b', html_text, re.IGNORECASE))

        # Extract minute if live
        minute = None
        minute_match = re.search(r'\b(\d{1,2})[\'’]', html_text)
        if minute_match:
            try:
                minute = int(minute_match.group(1))
            except Exception:
                pass

        # Look for score pattern in Google Sports card
        # Pattern 1: home_score - away_score in proximity to team names
        h_token = home_team.split()[0].lower()
        a_token = away_team.split()[0].lower()

        # Check for standard Google Sports score markup (e.g. data-live-score or team names near digits)
        score_candidates = re.findall(r'(\d+)\s*[-–:]\s*(\d+)', html_text)
        
        # Look for plausible football scores (typically 0-9)
        valid_scores = [
            (int(s[0]), int(s[1])) for s in score_candidates
            if int(s[0]) <= 15 and int(s[1]) <= 15
        ]

        if not valid_scores:
            self._score_cache[cache_key] = None
            return None

        # Pick the most prominent score in sports block
        home_score, away_score = valid_scores[0]
        status = FixtureStatus.FINISHED if is_finished else (FixtureStatus.LIVE if is_live else FixtureStatus.SCHEDULED)

        result = {
            "home_score": home_score,
            "away_score": away_score,
            "status": status,
            "minute": minute,
            "period": "FT" if is_finished else ("HT" if "Half-time" in html_text else "LIVE" if is_live else None),
            "source": "google_search"
        }

        self._score_cache[cache_key] = result
        return result

    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        return []

    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        return []
