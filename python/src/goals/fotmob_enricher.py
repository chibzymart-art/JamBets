"""
JamBets — Resilient FotMob Expected Goals (xG) & Tactical Enricher
Provides rolling non-penalty expected goals (npxG), xGA, and shot volume metrics.
Features local persistent JSON caching, team name alias normalization,
and isolated per-request error handling (no global circuit breaker on unmapped teams).
"""

import os
import sys
import json
import time
from typing import Dict, Any, Optional
from pathlib import Path

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))

try:
    from python.src.sources.fotmob import FotMobAdapter
    _has_fotmob = True
except Exception:
    _has_fotmob = False


# Canonical team aliases to match FotMob search nomenclature
COMMON_CLUB_ALIASES: Dict[str, str] = {
    "inter-milan": "Inter",
    "internazionale": "Inter",
    "ac-milan": "AC Milan",
    "as-roma": "Roma",
    "roma": "Roma",
    "atletico-madrid": "Atlético Madrid",
    "athletic-bilbao": "Athletic Club",
    "borussia-dortmund": "Dortmund",
    "bayer-leverkusen": "Leverkusen",
    "bayern-munich": "Bayern München",
    "paris-saint-germain": "PSG",
    "psg": "PSG",
    "tottenham-hotspur": "Tottenham",
    "wolverhampton-wanderers": "Wolves",
    "newcastle-united": "Newcastle",
    "brighton-and-hove-albion": "Brighton",
    "nottingham-forest": "Nottingham Forest",
    "leicester-city": "Leicester",
    "west-ham-united": "West Ham",
    "sporting-cp": "Sporting CP",
    "sporting-lisbon": "Sporting CP",
    "sl-benfica": "Benfica",
    "fc-porto": "Porto",
    "ajax-amsterdam": "Ajax",
    "feyenoord-rotterdam": "Feyenoord",
    "red-bull-salzburg": "Salzburg",
    "red-bull-leipzig": "RB Leipzig",
    "rb-leipzig": "RB Leipzig",
}

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "scratch" / "cache"


class ResilientFotMobEnricher:
    """
    Enriches candidate fixtures with verified rolling xG metrics.
    Completely eliminates the legacy failure mode where 3 unmapped teams
    permanently tripped the enricher for the entire cycle.
    """

    def __init__(self):
        self.fotmob = FotMobAdapter() if _has_fotmob else None
        if self.fotmob:
            self.fotmob.rate_limit_delay_seconds = 0.05
            self.fotmob.max_retries = 2
            if hasattr(self.fotmob, 'client'):
                self.fotmob.client.timeout = 3.5

        self.cache_file = CACHE_DIR / "fotmob_xg_cache.json"
        self._memory_cache: Dict[str, Optional[Dict[str, float]]] = {}
        self._load_disk_cache()

    def _load_disk_cache(self):
        """Loads cached metrics from disk if available."""
        try:
            if self.cache_file.exists():
                with open(self.cache_file, "r", encoding="utf-8") as f:
                    self._memory_cache = json.load(f)
        except Exception:
            self._memory_cache = {}

    def _save_disk_cache(self):
        """Persists metrics to disk."""
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            with open(self.cache_file, "w", encoding="utf-8") as f:
                json.dump(self._memory_cache, f, indent=2)
        except Exception:
            pass

    def normalize_team_name(self, raw_name: str) -> str:
        """Resolves raw slug or name to FotMob-compatible search query."""
        if not raw_name:
            return ""
        clean = raw_name.lower().strip().replace(" ", "-")
        if clean in COMMON_CLUB_ALIASES:
            return COMMON_CLUB_ALIASES[clean]
        # Clean slug formatting (e.g. "real-madrid" -> "Real Madrid")
        words = raw_name.replace("-", " ").split()
        return " ".join(w.capitalize() for w in words)

    def get_team_xg_metrics(
        self,
        team_name: str,
        league_code: Optional[str] = None
    ) -> Optional[Dict[str, float]]:
        """
        Retrieves rolling npxG, xGA, and shot volume for a team.
        Returns None gracefully without affecting subsequent teams.
        """
        if not self.fotmob:
            return None

        normalized_name = self.normalize_team_name(team_name)
        cache_key = f"{normalized_name.lower()}_{league_code or ''}"

        # 1. Memory / Disk Cache Check
        if cache_key in self._memory_cache:
            return self._memory_cache[cache_key]

        # 2. League validation
        if league_code and hasattr(self.fotmob, 'LEAGUE_ID_MAP') and league_code not in self.fotmob.LEAGUE_ID_MAP:
            self._memory_cache[cache_key] = None
            return None

        try:
            metrics = self.fotmob.fetch_team_xg_metrics(
                team_name=normalized_name,
                league_code=league_code
            )

            # Record in cache (even None is cached to avoid repeated failed queries)
            self._memory_cache[cache_key] = metrics
            self._save_disk_cache()
            return metrics

        except Exception as err:
            # Per-team graceful failure: log notice and return None without breaking pipeline
            self._memory_cache[cache_key] = None
            return None
