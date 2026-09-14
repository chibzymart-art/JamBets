"""
Addsbanta — Goals Scraper & Rolling Metrics Enricher
Connects the Goals Specialist Engine directly to FotMob and ESPN data source adapters
to extract verified rolling non-penalty expected goals (npxG), xGA, and squad injury signals.
"""

import sys
import os
from typing import Dict, Any, Optional

try:
    from python.src.sources.fotmob import FotMobAdapter
    _has_fotmob = True
except Exception:
    _has_fotmob = False


class GoalsScraperEnricher:
    """
    Enriches candidate fixtures with genuine rolling xG and tactical context
    from FotMob and live data source feeds.
    """

    def __init__(self):
        self.fotmob = FotMobAdapter() if _has_fotmob else None
        if self.fotmob:
            self.fotmob.rate_limit_delay_seconds = 0.05
            self.fotmob.max_retries = 1
            if hasattr(self.fotmob, 'client'):
                self.fotmob.client.timeout = 2.5
        self._cache: Dict[str, Optional[Dict[str, float]]] = {}
        self._circuit_broken = False
        self._fail_count = 0

    def get_team_xg_metrics(self, team_name: str, league_code: Optional[str] = None) -> Optional[Dict[str, float]]:
        """
        Retrieves rolling npxG (non-penalty expected goals) and xGA for a team.
        Cached in memory to prevent rate-limiting.
        """
        if not self.fotmob or self._circuit_broken:
            return None

        # Only attempt FotMob enrichment for recognized supported league codes
        if league_code and hasattr(self.fotmob, 'LEAGUE_ID_MAP') and league_code not in self.fotmob.LEAGUE_ID_MAP:
            return None

        cache_key = f"{team_name.lower().strip()}_{league_code or ''}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        try:
            metrics = self.fotmob.fetch_team_xg_metrics(team_name=team_name, league_code=league_code)
            self._cache[cache_key] = metrics
            if metrics is None:
                self._fail_count += 1
                if self._fail_count >= 3:
                    self._circuit_broken = True
                    print("⚡ [GoalsScraperEnricher] FotMob API search endpoint unavailable (Circuit Breaker Tripped). Proceeding with Empirical + AI scout.")
            else:
                self._fail_count = 0
            return metrics
        except Exception:
            self._cache[cache_key] = None
            self._fail_count += 1
            if self._fail_count >= 3:
                self._circuit_broken = True
                print("⚡ [GoalsScraperEnricher] FotMob API search endpoint unavailable (Circuit Breaker Tripped). Proceeding with Empirical + AI scout.")
            return None
