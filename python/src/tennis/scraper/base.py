"""
Oddsbanta — Autonomous Tennis Scraper Base Protocol
Phase 2: Independent Dynamic Live Tennis Scraper Daemon

Invariant: Abstract protocol for live tennis data ingestion. Zero football dependencies.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional


class BaseTennisScraper(ABC):
    """
    Abstract interface for tennis data acquisition sources.
    """

    @abstractmethod
    def fetch_rankings(self, tour: str = "atp") -> List[Dict[str, Any]]:
        """
        Fetches current live player rankings (ranks, points, country, age).
        """
        pass

    @abstractmethod
    def fetch_scoreboard(self, tour: str = "atp", date_str: Optional[str] = None) -> Dict[str, Any]:
        """
        Fetches live scoreboard containing active tournaments and match competitions.
        """
        pass

    @abstractmethod
    def parse_fixtures_from_scoreboard(self, raw_data: Dict[str, Any], tour: str = "atp") -> List[Dict[str, Any]]:
        """
        Normalizes raw feed data into canonical tennis fixtures with players and tournament context.
        """
        pass
