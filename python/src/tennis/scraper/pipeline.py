"""
Oddsbanta — Autonomous Tennis Ingestion Pipeline
Phase 2: Independent Dynamic Live Tennis Scraper Daemon

Orchestrates:
1. Live Scoreboard ingestion (ATP & WTA)
2. Tournament Classification & Court Pace Index assignment
3. Surface-Specific Player ELO calculation & upsertion
4. Fixture Deduplication & Persistence
5. Real-time In-Play & Completed Result Updates

Invariant: Interacts exclusively with public.tennis_* via TennisDbClient. Zero football touchpoints.
"""

import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta

from ..db import TennisDbClient
from ..cpi_registry import CpiRegistry
from ..elo_engine import TennisEloEngine
from .espn_feed import EspnTennisFeedScraper

logger = logging.getLogger("tennis.pipeline")


class TennisIngestionPipeline:
    """
    End-to-end ingestion pipeline from live feeds to isolated Supabase database.
    """

    def __init__(self, db_client: Optional[TennisDbClient] = None, scraper: Optional[EspnTennisFeedScraper] = None):
        self.db = db_client or TennisDbClient()
        self.scraper = scraper or EspnTennisFeedScraper()

        # In-memory caches to minimize duplicate DB reads
        self._tournament_cache: Dict[str, str] = {}  # name -> id
        self._player_cache: Dict[str, str] = {}  # canonical_name -> id

    def sync_player_rankings(self, tours: List[str] = ["atp", "wta"]) -> int:
        """
        Fetches live rankings and populates tennis_players with surface-specific ELOs.
        """
        total_synced = 0
        for tour in tours:
            ranks = self.scraper.fetch_rankings(tour=tour)
            for p in ranks:
                canonical = p["canonical_name"]
                rank = p.get("current_rank")
                points = p.get("points")

                # Derive surface-specific ratings
                surface_elos = TennisEloEngine.get_surface_elos(canonical, rank, points)

                # Prepare player record
                player_record = {
                    "canonical_name": canonical,
                    "display_name": p["display_name"],
                    "country": p.get("country"),
                    "current_rank": rank,
                    "hard_elo": surface_elos["hard_elo"],
                    "clay_elo": surface_elos["clay_elo"],
                    "grass_elo": surface_elos["grass_elo"],
                    "indoor_elo": surface_elos["indoor_elo"],
                    "metadata": {
                        "age": p.get("age"),
                        "points": points,
                        "tour": tour.upper(),
                        "headshot_url": p.get("headshot_url"),
                        "last_ranked_at": datetime.now(timezone.utc).isoformat()
                    }
                }

                try:
                    res = self.db.upsert_player(player_record)
                    if res and "id" in res:
                        self._player_cache[canonical] = res["id"]
                        total_synced += 1
                except Exception as e:
                    logger.warning("Failed to upsert player %s: %s", canonical, e)

        logger.info("Successfully synchronized %d tennis players across ATP/WTA", total_synced)
        return total_synced

    def get_or_create_tournament(self, raw_name: str, tour: str = "ATP") -> str:
        """
        Resolves tournament profile via CpiRegistry and caches its UUID.
        """
        cache_key = f"{tour}:{raw_name.strip().lower()}"
        if cache_key in self._tournament_cache:
            return self._tournament_cache[cache_key]

        profile = CpiRegistry.resolve_tournament(raw_name, tour=tour)

        # Upsert tournament record
        record = {
            "name": profile.name,
            "tour": profile.tour,
            "category": profile.category,
            "surface": profile.surface,
            "court_pace_index": profile.court_pace_index,
            "city": profile.city,
            "country": profile.country,
            "is_active": True
        }

        try:
            # Query existing tournament by name
            existing = self.db.client.get("/tennis_tournaments", params={"name": f"eq.{profile.name}"}).json()
            if existing:
                t_id = existing[0]["id"]
            else:
                created = self.db.upsert_tournament(record)
                t_id = created["id"]

            self._tournament_cache[cache_key] = t_id
            return t_id
        except Exception as e:
            logger.error("Error creating tournament %s: %s", profile.name, e)
            raise

    def get_or_create_player(self, player_data: Dict[str, Any]) -> str:
        """
        Finds or registers a player, ensuring baseline surface ELOs.
        """
        canonical = player_data["canonical_name"]
        if canonical in self._player_cache:
            return self._player_cache[canonical]

        existing = self.db.get_player_by_canonical(canonical)
        if existing:
            self._player_cache[canonical] = existing["id"]
            return existing["id"]

        # If player does not exist yet, calculate default baseline ELO
        rank = player_data.get("rank")
        surface_elos = TennisEloEngine.get_surface_elos(canonical, rank)
        record = {
            "canonical_name": canonical,
            "display_name": player_data["display_name"],
            "country": player_data.get("country"),
            "current_rank": rank,
            "hard_elo": surface_elos["hard_elo"],
            "clay_elo": surface_elos["clay_elo"],
            "grass_elo": surface_elos["grass_elo"],
            "indoor_elo": surface_elos["indoor_elo"],
            "metadata": {
                "auto_discovered": True,
                "first_seen_at": datetime.now(timezone.utc).isoformat()
            }
        }

        try:
            res = self.db.upsert_player(record)
            p_id = res["id"]
            self._player_cache[canonical] = p_id
            return p_id
        except Exception as e:
            logger.error("Error creating player %s: %s", canonical, e)
            raise

    def sync_live_scoreboard(
        self,
        tours: List[str] = ["atp", "wta"],
        date_str: Optional[str] = None,
        days_ahead: int = 3,
        strict_upcoming_only: bool = True
    ) -> Dict[str, int]:
        """
        Pulls scoreboards strictly for current time to the next 3 days,
        extracts matches, registers players and tournaments, and upserts fixtures into Supabase.
        Past concluded fixtures are strictly discarded.
        """
        stats = {"fixtures_synced": 0, "completed_updated": 0, "tournaments_indexed": 0}

        now_utc = datetime.now(timezone.utc)
        min_kickoff = now_utc - timedelta(minutes=30) if strict_upcoming_only else None
        max_kickoff = now_utc + timedelta(days=days_ahead) if strict_upcoming_only else None

        if date_str:
            dates = [date_str]
        else:
            dates = [(now_utc + timedelta(days=i)).strftime("%Y%m%d") for i in range(days_ahead + 1)]

        for d in dates:
            for tour in tours:
                raw_data = self.scraper.fetch_scoreboard(tour=tour, date_str=d)
                if not raw_data:
                    continue

                fixtures = self.scraper.parse_fixtures_from_scoreboard(
                    raw_data,
                    tour=tour,
                    min_kickoff=min_kickoff,
                    max_kickoff=max_kickoff
                )
                for f in fixtures:
                    try:
                        # 1. Resolve Tournament
                        tournament_id = self.get_or_create_tournament(
                            raw_name=f["raw_tournament_name"],
                            tour=f["tour"]
                        )

                        # 2. Resolve Players
                        p1_id = self.get_or_create_player(f["player1"])
                        p2_id = self.get_or_create_player(f["player2"])

                        winner_id = None
                        if f.get("winner_canonical") == f["player1"]["canonical_name"]:
                            winner_id = p1_id
                        elif f.get("winner_canonical") == f["player2"]["canonical_name"]:
                            winner_id = p2_id

                        retired_player_id = None
                        if f.get("was_retired"):
                            # In retired matches, the loser is the retired player
                            if winner_id == p1_id:
                                retired_player_id = p2_id
                            elif winner_id == p2_id:
                                retired_player_id = p1_id

                        fixture_record = {
                            "canonical_key": f["canonical_key"],
                            "tournament_id": tournament_id,
                            "round": f["round"],
                            "player1_id": p1_id,
                            "player2_id": p2_id,
                            "best_of_sets": f["best_of_sets"],
                            "target_kickoff_at": f["target_kickoff_at"],
                            "status": f["status"],
                            "score_p1_sets": f["score_p1_sets"],
                            "score_p2_sets": f["score_p2_sets"],
                            "set_scores": f["set_scores"],
                            "winner_id": winner_id,
                            "retired_player_id": retired_player_id,
                            "metadata": {
                                "venue": f.get("venue_name"),
                                "espn_competition_id": f.get("espn_competition_id"),
                                "was_walkover": f.get("was_walkover"),
                                "was_retired": f.get("was_retired"),
                                "last_synced_at": datetime.now(timezone.utc).isoformat()
                            }
                        }

                        res = self.db.upsert_fixture(fixture_record)
                        stats["fixtures_synced"] += 1
                        if f["status"] in ("finished", "retired", "walkover"):
                            stats["completed_updated"] += 1

                    except Exception as e:
                        logger.error("Failed to sync fixture %s: %s", f.get("canonical_key"), e)

        logger.info("Pipeline sync complete: %s", stats)
        return stats

    def close(self):
        self.scraper.close()
        self.db.close()
