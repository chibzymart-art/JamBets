"""
JamBets — Verified Source Registry Manager
Manages registered source adapters, priority routing, circuit breaking, and health metrics.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional
from python.src.sources.base import BaseSourceAdapter
from python.src.sources.fotmob import FotMobAdapter
from python.src.sources.espn import ESPNAdapter
from python.src.sources.livescore import LiveScoreAdapter
from python.src.sources.flashscore import FlashscoreAdapter
from python.src.sources.sportybet import SportyBetAdapter
from python.src.sources.google_news import GoogleNewsAdapter


class SourceRegistry:
    def __init__(self):
        self._adapters: Dict[str, BaseSourceAdapter] = {}
        self._health_stats: Dict[str, Dict] = {}

        # Register default approved providers with Phase 4.7 priority ordering
        self.register(FotMobAdapter(), priority=10)
        self.register(ESPNAdapter(), priority=20)
        self.register(LiveScoreAdapter(), priority=30)
        self.register(FlashscoreAdapter(), priority=40)
        self.register(SportyBetAdapter(), priority=50)
        self.register(GoogleNewsAdapter(), priority=60)

    def register(self, adapter: BaseSourceAdapter, priority: int = 100) -> None:
        self._adapters[adapter.slug] = adapter
        self._health_stats[adapter.slug] = {
            "priority": priority,
            "successes": 0,
            "failures": 0,
            "last_success": None,
            "last_failure": None,
            "consecutive_failures": 0,
            "is_enabled": True
        }

    def get_adapter(self, slug: str) -> Optional[BaseSourceAdapter]:
        stats = self._health_stats.get(slug, {})
        if stats.get("is_enabled", False):
            return self._adapters.get(slug)
        return None

    def get_all_active_adapters(self) -> List[BaseSourceAdapter]:
        # Return sorted by priority (lower number = higher priority)
        active_slugs = [
            slug for slug, stats in self._health_stats.items()
            if stats.get("is_enabled", False)
        ]
        active_slugs.sort(key=lambda s: self._health_stats[s]["priority"])
        return [self._adapters[s] for s in active_slugs]

    def record_success(self, slug: str) -> None:
        if slug in self._health_stats:
            stats = self._health_stats[slug]
            stats["successes"] += 1
            stats["consecutive_failures"] = 0
            stats["last_success"] = datetime.now(timezone.utc)

    def record_failure(self, slug: str, error_msg: str) -> None:
        if slug in self._health_stats:
            stats = self._health_stats[slug]
            stats["failures"] += 1
            stats["consecutive_failures"] += 1
            stats["last_failure"] = datetime.now(timezone.utc)
            # Circuit breaker: disable after 5 consecutive failures
            if stats["consecutive_failures"] >= 5:
                stats["is_enabled"] = False
