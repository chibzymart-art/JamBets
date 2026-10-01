"""
Oddsbanta — Autonomous Tennis Ingestion Pipeline
Phase 1: Multi-Source Tennis Ingestion for Premier Tours, Challengers & Cups

Orchestrates:
1. Multi-source Live Scoreboard ingestion (ESPN & LiveScore)
2. Ingests ATP 250/500/1000, Grand Slams, ATP Challenger Tour, WTA 125, and Team Cups
3. Surface-Specific Court Pace Index assignment via CpiRegistry
4. Surface-Specific Player ELO calculation & upsertion
5. Match Fingerprint Deduplication & Persistence
6. Real-time In-Play & Completed Result Updates

Invariant: Interacts exclusively with public.tennis_* via TennisDbClient. Zero football touchpoints.
"""

import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta

from ..db import TennisDbClient
from ..cpi_registry import CpiRegistry
from ..elo_engine import TennisEloEngine
from .espn_feed import EspnTennisFeedScraper
from .livescore_tennis import LiveScoreTennisScraper

logger = logging.getLogger("tennis.pipeline")


class TennisIngestionPipeline:
    """
    End-to-end multi-source ingestion pipeline from live feeds to isolated Supabase database.
    """

    def __init__(
        self,
        db_client: Optional[TennisDbClient] = None,
        scraper: Optional[EspnTennisFeedScraper] = None,
        livescore_scraper: Optional[LiveScoreTennisScraper] = None
    ):
        self.db = db_client or TennisDbClient()
        self.scraper = scraper or EspnTennisFeedScraper()
        self.livescore_scraper = livescore_scraper or LiveScoreTennisScraper()

        # In-memory caches to minimize duplicate DB reads
        self._tournament_cache: Dict[str, str] = {}  # name -> id
        self._player_cache: Dict[str, str] = {}  # canonical_name -> id

    def sync_player_rankings(self, tours: List[str] = ["atp", "wta"], dry_run: bool = False) -> int:
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

                if not dry_run:
                    try:
                        res = self.db.upsert_player(player_record)
                        if res and "id" in res:
                            self._player_cache[canonical] = res["id"]
                            total_synced += 1
                    except Exception as e:
                        logger.warning("Failed to upsert player %s: %s", canonical, e)
                else:
                    self._player_cache[canonical] = f"mock_{canonical}"
                    total_synced += 1

        logger.info("Successfully synchronized %d tennis players across ATP/WTA (dry_run=%s)", total_synced, dry_run)
        return total_synced

    def get_or_create_tournament(self, raw_name: str, tour: str = "ATP", category: Optional[str] = None) -> str:
        """
        Resolves tournament profile via CpiRegistry and caches its UUID.
        """
        cache_key = f"{tour}:{raw_name.strip().lower()}"
        if cache_key in self._tournament_cache:
            return self._tournament_cache[cache_key]

        profile = CpiRegistry.resolve_tournament(raw_name, tour=tour, category=category)

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
            # Query existing tournament by name AND tour
            existing = self.db.client.get(
                "/tennis_tournaments",
                params={"name": f"eq.{profile.name}", "tour": f"eq.{profile.tour}"}
            ).json()
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

    @staticmethod
    def _match_fingerprint(fixture: Dict[str, Any]) -> str:
        """
        Produces an order-independent canonical match fingerprint:
        TOUR:P1-P2(sorted):DATE
        """
        p1 = fixture["player1"]["canonical_name"]
        p2 = fixture["player2"]["canonical_name"]
        players = "-".join(sorted([p1, p2]))
        date_str = fixture["target_kickoff_at"][:10].replace("-", "")
        tour = fixture.get("tour", "ATP").upper()
        return f"{tour}:{players}:{date_str}"

    def sync_live_scoreboard(
        self,
        tours: List[str] = ["atp", "wta"],
        date_str: Optional[str] = None,
        days_ahead: int = 4,
        strict_upcoming_only: bool = True,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Pulls scoreboards from both ESPN and LiveScore across the rolling horizon (default: 4 days),
        deduplicates matches, registers players and tournaments, and upserts fixtures into Supabase.
        Past concluded fixtures are strictly discarded.
        """
        stats = {
            "fixtures_synced": 0,
            "completed_updated": 0,
            "tournaments_indexed": 0,
            "dry_run": dry_run,
            "fixtures": []
        }

        now_utc = datetime.now(timezone.utc)
        min_kickoff = now_utc - timedelta(minutes=30) if strict_upcoming_only else None
        max_kickoff = now_utc + timedelta(days=days_ahead) if strict_upcoming_only else None

        if date_str:
            dates = [date_str]
        else:
            dates = [(now_utc + timedelta(days=i)).strftime("%Y%m%d") for i in range(days_ahead + 1)]

        # Collect raw parsed fixtures across all dates from both feeds
        collected_fixtures: List[Dict[str, Any]] = []
        seen_fingerprints: Dict[str, int] = {}  # fingerprint -> index in collected_fixtures

        for d in dates:
            # 1. Primary Source: ESPN Scoreboards
            for tour in tours:
                raw_espn = self.scraper.fetch_scoreboard(tour=tour, date_str=d)
                if raw_espn:
                    espn_fixtures = self.scraper.parse_fixtures_from_scoreboard(
                        raw_espn,
                        tour=tour,
                        min_kickoff=min_kickoff,
                        max_kickoff=max_kickoff
                    )
                    for ef in espn_fixtures:
                        fp = self._match_fingerprint(ef)
                        if fp not in seen_fingerprints:
                            seen_fingerprints[fp] = len(collected_fixtures)
                            collected_fixtures.append(ef)

            # 2. Secondary Source: LiveScore Scoreboards (Challengers, Cups, WTA 125, knockout additions)
            raw_ls = self.livescore_scraper.fetch_scoreboard(tour="all", date_str=d)
            if raw_ls:
                ls_fixtures = self.livescore_scraper.parse_fixtures_from_scoreboard(
                    raw_ls,
                    tour="all",
                    min_kickoff=min_kickoff,
                    max_kickoff=max_kickoff
                )
                for lf in ls_fixtures:
                    fp = self._match_fingerprint(lf)
                    if fp not in seen_fingerprints:
                        seen_fingerprints[fp] = len(collected_fixtures)
                        collected_fixtures.append(lf)
                    else:
                        # Existing fixture from ESPN: update live score or status if LiveScore is newer
                        idx = seen_fingerprints[fp]
                        existing = collected_fixtures[idx]
                        if lf.get("status") in ("live", "finished", "retired", "walkover") and existing.get("status") == "scheduled":
                            existing["status"] = lf["status"]
                            existing["score_p1_sets"] = lf.get("score_p1_sets", existing.get("score_p1_sets", 0))
                            existing["score_p2_sets"] = lf.get("score_p2_sets", existing.get("score_p2_sets", 0))
                            existing["set_scores"] = lf.get("set_scores", existing.get("set_scores", []))
                            if lf.get("winner_canonical"):
                                existing["winner_canonical"] = lf["winner_canonical"]

        # Persist and index collected fixtures
        for f in collected_fixtures:
            try:
                # 1. Resolve Tournament
                profile = CpiRegistry.resolve_tournament(
                    f["raw_tournament_name"],
                    tour=f["tour"],
                    category=f.get("category")
                )
                tournament_record = {
                    "name": profile.name,
                    "tour": profile.tour,
                    "category": profile.category,
                    "surface": profile.surface,
                    "court_pace_index": profile.court_pace_index,
                    "city": profile.city,
                    "country": profile.country,
                }
                if not dry_run:
                    tournament_id = self.get_or_create_tournament(
                        raw_name=f["raw_tournament_name"],
                        tour=f["tour"],
                        category=f.get("category")
                    )
                else:
                    tournament_id = f"mock_{self.scraper.slugify(profile.name)}"

                # 2. Resolve Players
                p1_canonical = f["player1"]["canonical_name"]
                p2_canonical = f["player2"]["canonical_name"]
                p1_elos = TennisEloEngine.get_surface_elos(p1_canonical, f["player1"].get("rank"))
                p2_elos = TennisEloEngine.get_surface_elos(p2_canonical, f["player2"].get("rank"))

                player1_record = {
                    "canonical_name": p1_canonical,
                    "display_name": f["player1"]["display_name"],
                    "country": f["player1"].get("country"),
                    "hard_elo": p1_elos["hard_elo"],
                    "clay_elo": p1_elos["clay_elo"],
                    "grass_elo": p1_elos["grass_elo"],
                    "indoor_elo": p1_elos["indoor_elo"],
                }
                player2_record = {
                    "canonical_name": p2_canonical,
                    "display_name": f["player2"]["display_name"],
                    "country": f["player2"].get("country"),
                    "hard_elo": p2_elos["hard_elo"],
                    "clay_elo": p2_elos["clay_elo"],
                    "grass_elo": p2_elos["grass_elo"],
                    "indoor_elo": p2_elos["indoor_elo"],
                }

                if not dry_run:
                    p1_id = self.get_or_create_player(f["player1"])
                    p2_id = self.get_or_create_player(f["player2"])
                else:
                    p1_id = f"mock_{p1_canonical}"
                    p2_id = f"mock_{p2_canonical}"

                winner_id = None
                if f.get("winner_canonical") == f["player1"]["canonical_name"]:
                    winner_id = p1_id
                elif f.get("winner_canonical") == f["player2"]["canonical_name"]:
                    winner_id = p2_id

                retired_player_id = None
                if f.get("was_retired"):
                    if winner_id == p1_id:
                        retired_player_id = p2_id
                    elif winner_id == p2_id:
                        retired_player_id = p1_id

                fixture_record = {
                    "id": f.get("canonical_key"),
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
                    "tournament": tournament_record,
                    "player1": player1_record,
                    "player2": player2_record,
                    "metadata": {
                        "venue": f.get("venue_name"),
                        "source": f.get("source", "espn"),
                        "espn_competition_id": f.get("espn_competition_id"),
                        "was_walkover": f.get("was_walkover"),
                        "was_retired": f.get("was_retired"),
                        "last_synced_at": datetime.now(timezone.utc).isoformat()
                    }
                }

                db_payload = {
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
                    "metadata": fixture_record["metadata"]
                }

                if not dry_run:
                    # Check if a rescheduled match exists for this player pair & tournament within window
                    rescheduled = self.db.find_matching_rescheduled_fixture(
                        p1_id, p2_id, tournament_id, f["target_kickoff_at"]
                    )
                    if rescheduled and rescheduled.get("id") and rescheduled.get("canonical_key") != f["canonical_key"]:
                        logger.info(
                            "Detected rescheduled tennis fixture: %s vs %s (existing id=%s). Updating kickoff to %s",
                            p1_canonical, p2_canonical, rescheduled["id"], f["target_kickoff_at"]
                        )
                        self.db.update_fixture_score(rescheduled["id"], db_payload)
                        fixture_record["id"] = rescheduled["id"]
                    else:
                        res = self.db.upsert_fixture(db_payload)
                        if res and "id" in res:
                            fixture_record["id"] = res["id"]

                stats["fixtures"].append(fixture_record)
                stats["fixtures_synced"] += 1
                if f["status"] in ("finished", "retired", "walkover"):
                    stats["completed_updated"] += 1

            except Exception as e:
                logger.error("Failed to sync fixture %s: %s", f.get("canonical_key"), e)

        logger.info(
            "Multi-source pipeline sync complete: synced=%d, completed=%d (dry_run=%s)",
            stats["fixtures_synced"],
            stats["completed_updated"],
            dry_run
        )
        return stats

    def close(self):
        self.scraper.close()
        self.livescore_scraper.close()
        self.db.close()
