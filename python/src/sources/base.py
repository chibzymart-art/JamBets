"""
JamBets — Base Data Source Adapter
Defines standard interface, rate limiting, and provenance tracking for all adapters.
"""

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import List, Optional
import httpx
from python.src.config import LeagueConfig
from python.src.football.models import RawFixturePayload


class BaseSourceAdapter(ABC):
    def __init__(self, name: str, slug: str, base_url: str, rate_limit_rps: float = 2.0):
        self.name = name
        self.slug = slug
        self.base_url = base_url
        self.rate_limit_rps = rate_limit_rps
        self.client = httpx.Client(timeout=15.0, headers={"User-Agent": "JamBetsDataAcquisition/1.0"})

    @abstractmethod
    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        """Fetches upcoming fixtures within date range from this source."""
        pass

    @abstractmethod
    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        """Fetches active live fixtures from this source."""
        pass
