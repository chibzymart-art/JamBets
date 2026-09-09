"""
JamBets — Squad-Aware Google News RSS Scraper (Phase 4.7)
Performs entity-verified sentiment & absence analysis using team squad rosters.
Eliminates false positives by only flagging absences when a rostered player's name
co-occurs with explicit negative injury/suspension context.
Rate limit: 1.5s delay with 3-attempt exponential backoff.
"""

from datetime import datetime, timezone
import urllib.parse
import xml.etree.ElementTree as ET
from typing import List, Dict, Any, Optional, Set
from python.src.config import LeagueConfig
from python.src.football.models import RawFixturePayload
from python.src.sources.base import BaseSourceAdapter


class GoogleNewsAdapter(BaseSourceAdapter):
    """
    Squad-aware Google News RSS scraper.
    Eliminates fan noise by requiring entity match against verified squad roster.
    """

    NEGATIVE_CONTEXT_KEYWORDS = [
        "ruled out", "hamstring", "red card", "suspended", "suspension",
        "injury", "injured", "surgery", "torn", "tear", "fracture",
        "banned", "sidelined", "miss match", "misses", "knock", "groin",
        "knee", "ankle", "achilles", "concussion", "doubtful", "out for"
    ]

    def __init__(self):
        super().__init__(
            name="GoogleNews",
            slug="google_news",
            base_url="https://news.google.com/rss/search",
            rate_limit_delay_seconds=1.5,
            max_retries=3
        )
        self._news_cache: Dict[str, Dict[str, Any]] = {}

    def fetch_injury_news(
        self,
        team_name: str,
        squad_roster: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Fetches Google News RSS and cross-references against squad roster.
        Returns:
            {
                "team": str,
                "flagged_absences": List[Dict[str, str]],
                "modifier_debuff": float,  # e.g. 0.92 (-8%) or 1.0 (no effect)
                "headlines_checked": int
            }
        """
        cache_key = team_name.lower().strip()
        if cache_key in self._news_cache:
            return self._news_cache[cache_key]

        query = f"{team_name} injury OR suspended"
        encoded_query = urllib.parse.quote(query)
        url = f"{self.base_url}?q={encoded_query}&hl=en-US&gl=US&ceid=US:en"

        xml_text = self.get_text_with_retry(url)
        if not xml_text:
            result = {
                "team": team_name,
                "flagged_absences": [],
                "modifier_debuff": 1.0,
                "headlines_checked": 0
            }
            self._news_cache[cache_key] = result
            return result

        # Parse RSS XML
        flagged_players: Dict[str, str] = {}
        headlines_count = 0

        try:
            root = ET.fromstring(xml_text)
            channel = root.find("channel")
            items = channel.findall("item") if channel is not None else []
            headlines_count = len(items)

            # Build squad lookup set: both full names ("Bukayo Saka") and last names ("Saka")
            roster_names: Dict[str, str] = {}
            if squad_roster:
                for player in squad_roster:
                    p_clean = player.strip()
                    if len(p_clean) > 3:
                        roster_names[p_clean.lower()] = p_clean
                        parts = p_clean.split()
                        if len(parts) > 1 and len(parts[-1]) > 3:
                            roster_names[parts[-1].lower()] = p_clean

            for item in items[:15]:
                title = item.findtext("title", "").strip()
                title_lower = title.lower()

                # Check negative context
                has_negative_context = any(kw in title_lower for kw in self.NEGATIVE_CONTEXT_KEYWORDS)
                if not has_negative_context:
                    continue

                # If squad roster is available, entity match
                if roster_names:
                    for name_token, canonical_player in roster_names.items():
                        if name_token in title_lower:
                            if canonical_player not in flagged_players:
                                flagged_players[canonical_player] = title
                else:
                    # Generic absence fallback if squad roster not provided
                    pass

        except Exception as e:
            print(f"[GoogleNews] XML parsing error for {team_name}: {e}")

        # Determine attack modifier debuff
        # 1 key player out: 0.92 (-8% attack power)
        # 2+ key players out: 0.85 (-15% attack power)
        absence_count = len(flagged_players)
        if absence_count >= 2:
            modifier_debuff = 0.85
        elif absence_count == 1:
            modifier_debuff = 0.92
        else:
            modifier_debuff = 1.0

        result = {
            "team": team_name,
            "flagged_absences": [
                {"player": p, "headline": h}
                for p, h in flagged_players.items()
            ],
            "modifier_debuff": modifier_debuff,
            "headlines_checked": headlines_count
        }

        self._news_cache[cache_key] = result
        return result

    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        return []

    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        return []
