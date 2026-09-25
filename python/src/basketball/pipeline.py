"""
Oddsbanta — Autonomous Basketball Ingestion Pipeline
Phase 2: Data Acquisition & Multi-Source Canonical Synchronization

Orchestrates:
1. Pre-seeding & syncing canonical basketball leagues (NBA, EuroLeague, NCAA, WNBA, ACB, NBL)
2. Team registry creation with Dean Oliver Four Factors & adjusted ratings
3. Multi-source fixture ingestion (ESPN + LiveScore)
4. Calendar rest days & Back-to-Back (B2B) schedule fatigue calculation
5. Cloud Supabase synchronization & deduplication

Invariant: Exclusively interacts with public.basketball_* tables. Zero touchpoints with football/tennis.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple

from python.src.basketball.config import LEAGUE_REGISTRY, ALTITUDE_VENUES
from python.src.basketball.identity import normalize_team_name, get_team_slug
from python.src.basketball.db import BasketballDbClient
from python.src.basketball.scrapers.espn_scraper import EspnBasketballScraper
from python.src.basketball.scrapers.livescore_scraper import LivescoreBasketballScraper

logger = logging.getLogger("basketball.pipeline")


class BasketballIngestionPipeline:
    """
    End-to-end ingestion pipeline from free public APIs into Cloud Supabase.
    """

    def __init__(
        self,
        db_client: Optional[BasketballDbClient] = None,
        espn_scraper: Optional[EspnBasketballScraper] = None,
        livescore_scraper: Optional[LivescoreBasketballScraper] = None,
    ):
        self.db = db_client or BasketballDbClient()
        self.espn = espn_scraper or EspnBasketballScraper()
        self.livescore = livescore_scraper or LivescoreBasketballScraper()

        # In-memory caches to minimize round-trips
        self._league_cache: Dict[str, str] = {}  # code -> UUID
        self._team_cache: Dict[str, str] = {}    # canonical_name -> UUID
        self._team_schedule: Dict[str, List[datetime]] = {} # canonical_name -> list of game datetimes

    def sync_leagues(self) -> int:
        """
        Ensures all registered basketball leagues exist in Cloud Supabase.
        """
        synced = 0
        for code, cfg in LEAGUE_REGISTRY.items():
            record = {
                "code": cfg.code,
                "name": cfg.name,
                "country": cfg.country,
                "quarter_minutes": cfg.quarter_minutes,
                "periods_count": cfg.periods_count,
                "default_pace": cfg.default_pace,
                "is_active": True,
            }
            try:
                res = self.db.upsert_league(record)
                if res and "id" in res:
                    self._league_cache[code] = res["id"]
                    synced += 1
            except Exception as e:
                logger.warning("Failed to upsert basketball league %s: %s", code, e)

        logger.info("Synchronized %d basketball leagues in Supabase", synced)
        return synced

    def get_or_create_team(
        self,
        canonical_name: str,
        league_id: str,
        short_name: Optional[str] = None,
        arena_name: Optional[str] = None,
        city: Optional[str] = None,
        state: Optional[str] = None,
    ) -> str:
        """
        Resolves team UUID from cache or Cloud Supabase, creating baseline record if missing.
        """
        if canonical_name in self._team_cache:
            return self._team_cache[canonical_name]

        # Check in DB
        existing = self.db.get_team_by_canonical(canonical_name)
        if existing and "id" in existing:
            self._team_cache[canonical_name] = existing["id"]
            return existing["id"]

        # Determine altitude bonus
        alt_bonus = ALTITUDE_VENUES.get(canonical_name.lower(), 0.0)
        altitude_ft = 5280 if alt_bonus >= 4.0 else (4226 if alt_bonus >= 3.8 else 0)

        slug = short_name or get_team_slug(canonical_name)

        record = {
            "canonical_name": canonical_name,
            "short_name": slug,
            "league_id": league_id,
            "arena_name": arena_name,
            "city": city,
            "state": state,
            "altitude_ft": altitude_ft,
            "offensive_rating": 112.0,
            "defensive_rating": 112.0,
            "net_rating": 0.0,
            "pace": 99.5,
            "four_factors": {
                "efg_pct": 0.535,
                "tov_pct": 0.125,
                "orb_pct": 0.250,
                "ftr": 0.220,
            },
            "metadata": {
                "altitude_bonus": alt_bonus,
            },
        }

        res = self.db.upsert_team(record)
        team_id = res.get("id") or ""
        if team_id:
            self._team_cache[canonical_name] = team_id
        return team_id

    def calculate_schedule_fatigue(
        self, team_name: str, target_kickoff_at: datetime
    ) -> Tuple[int, bool]:
        """
        Calculates rest days and detects Back-to-Back (B2B) schedule fatigue.
        """
        schedules = self._team_schedule.get(team_name, [])
        # Find previous game closest to this kickoff
        past_games = [g for g in schedules if g < target_kickoff_at]
        if not past_games:
            return 2, False  # Standard well-rested default

        last_game = max(past_games)
        delta_hours = (target_kickoff_at - last_game).total_seconds() / 3600.0

        if delta_hours <= 30.0:  # Played within 30 hours -> Back-to-Back
            return 0, True
        elif delta_hours <= 54.0:
            return 1, False
        else:
            days = min(int(delta_hours / 24.0), 5)
            return days, False

    def ingest_horizon(
        self,
        days_back: int = 1,
        days_forward: int = 3,
        target_leagues: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Ingests basketball fixtures across the temporal window.
        """
        # 1. Sync leagues first
        self.sync_leagues()

        leagues_to_scrape = target_leagues or list(LEAGUE_REGISTRY.keys())
        today = datetime.now(timezone.utc)

        raw_fixtures: Dict[str, Dict[str, Any]] = {}  # canonical_key -> fixture dict

        # 2. Iterate through each day in the horizon
        for day_offset in range(-days_back, days_forward + 1):
            current_date = today + timedelta(days=day_offset)
            date_str = current_date.strftime("%Y%m%d")

            # A. Fetch from ESPN
            for l_code in leagues_to_scrape:
                cfg = LEAGUE_REGISTRY.get(l_code)
                if cfg and cfg.espn_slug:
                    espn_fixtures = self.espn.fetch_scoreboard(l_code, date_str)
                    for fix in espn_fixtures:
                        raw_fixtures[fix["canonical_key"]] = fix

            # B. Fetch from LiveScore
            ls_fixtures = self.livescore.fetch_matches_by_date(date_str)
            for fix in ls_fixtures:
                if fix["league_code"] in leagues_to_scrape:
                    key = fix["canonical_key"]
                    if key not in raw_fixtures:
                        raw_fixtures[key] = fix
                    else:
                        # Cross-validation merge: if ESPN was missing odds or score, merge
                        existing = raw_fixtures[key]
                        if existing.get("status") == "scheduled" and fix.get("status") in ("live", "finished"):
                            existing["status"] = fix["status"]
                            existing["home_score"] = fix["home_score"]
                            existing["away_score"] = fix["away_score"]

        logger.info("Harvested %d unique basketball fixtures across horizon", len(raw_fixtures))

        # 3. Build team schedule history for fatigue calculation
        for fix in raw_fixtures.values():
            kickoff = datetime.fromisoformat(fix["target_kickoff_at"])
            self._team_schedule.setdefault(fix["home_team_name"], []).append(kickoff)
            self._team_schedule.setdefault(fix["away_team_name"], []).append(kickoff)

        # 4. Synchronize fixtures to Cloud Supabase
        synced_count = 0
        live_count = 0
        finished_count = 0

        for key, fix in raw_fixtures.items():
            home_raw = fix.get("home_team_name", "").strip().lower()
            away_raw = fix.get("away_team_name", "").strip().lower()
            if home_raw in ("tbd", "to be decided", "unknown team", "") or away_raw in ("tbd", "to be decided", "unknown team", ""):
                logger.debug("Skipping placeholder/TBD fixture: %s vs %s", fix.get("home_team_name"), fix.get("away_team_name"))
                continue

            l_code = fix["league_code"]
            league_id = self._league_cache.get(l_code)
            if not league_id:
                # Refresh cache
                self.sync_leagues()
                league_id = self._league_cache.get(l_code)
                if not league_id:
                    continue

            # Resolve team UUIDs
            home_id = self.get_or_create_team(
                fix["home_team_name"],
                league_id=league_id,
                arena_name=fix.get("arena_name"),
                city=fix.get("city"),
                state=fix.get("state"),
            )
            away_id = self.get_or_create_team(
                fix["away_team_name"],
                league_id=league_id,
            )

            if not home_id or not away_id:
                continue

            kickoff_dt = datetime.fromisoformat(fix["target_kickoff_at"])
            home_rest, home_b2b = self.calculate_schedule_fatigue(fix["home_team_name"], kickoff_dt)
            away_rest, away_b2b = self.calculate_schedule_fatigue(fix["away_team_name"], kickoff_dt)

            fixture_record = {
                "canonical_key": key,
                "league_id": league_id,
                "home_team_id": home_id,
                "away_team_id": away_id,
                "target_kickoff_at": fix["target_kickoff_at"],
                "status": fix["status"],
                "home_score": fix["home_score"],
                "away_score": fix["away_score"],
                "period_scores": fix.get("period_scores", {"home": [], "away": []}),
                "current_period": fix.get("current_period"),
                "time_remaining": fix.get("time_remaining"),
                "market_spread": fix.get("market_spread"),
                "market_total": fix.get("market_total"),
                "home_moneyline_odds": fix.get("home_moneyline_odds"),
                "away_moneyline_odds": fix.get("away_moneyline_odds"),
                "home_rest_days": home_rest,
                "away_rest_days": away_rest,
                "is_home_b2b": home_b2b,
                "is_away_b2b": away_b2b,
                "metadata": {
                    "source": fix.get("source"),
                    "provider_event_id": fix.get("provider_event_id"),
                    "arena_name": fix.get("arena_name"),
                    "altitude_bonus": fix.get("altitude_bonus", 0.0),
                },
            }

            try:
                res = self.db.upsert_fixture(fixture_record)
                if res and "id" in res:
                    synced_count += 1
                    if fix["status"] == "live":
                        live_count += 1
                    elif fix["status"] == "finished":
                        finished_count += 1
            except Exception as e:
                logger.error("Failed to sync basketball fixture %s: %s", key, e)

        summary = {
            "harvested_raw": len(raw_fixtures),
            "synced_fixtures": synced_count,
            "live_fixtures": live_count,
            "finished_fixtures": finished_count,
            "leagues_cached": len(self._league_cache),
            "teams_cached": len(self._team_cache),
        }
        logger.info("Basketball Ingestion Complete: %s", summary)
        return summary

    def close(self):
        self.espn.close()
        self.livescore.close()
        self.db.close()
