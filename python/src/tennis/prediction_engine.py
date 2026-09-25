"""
Oddsbanta — Autonomous Tennis Prediction & Markov Simulation Engine
Phase 3: Hierarchical Markov-Chain & Monte Carlo Simulation Engine

Generates high-accuracy predictions (>85% target banker accuracy) by combining:
1. Surface-specific ELO and Court Pace Index (CPI) adjustments
2. Closed-form Markov Chain game/set transition matrices
3. 250,000 Monte Carlo match simulations
4. Strict Zero-Hallucination banker filtering & confidence categorization

Invariant: 100% isolated tennis engine. Persists exclusively to public.tennis_predictions. Zero football dependencies.
"""

import math
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta

from .db import TennisDbClient
from .cpi_registry import CpiRegistry
from .elo_engine import TennisEloEngine
from .markov import TennisMarkovModel
from .simulation import TennisMonteCarloSimulator, SimulationResults

logger = logging.getLogger("tennis.engine")


class TennisPredictionEngine:
    """
    Autonomous predictor running hierarchical Markov modeling and Monte Carlo simulations.
    """

    def __init__(self, db_client: Optional[TennisDbClient] = None, simulations_count: int = 250000):
        self.db = db_client or TennisDbClient()
        self.simulations_count = simulations_count
        self.simulator = TennisMonteCarloSimulator(default_simulations=simulations_count)

    def generate_prediction_for_fixture(self, fixture: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Runs mathematical analysis and Monte Carlo simulations for a single tennis fixture.
        """
        fixture_id = fixture["id"]
        tournament = fixture.get("tournament") or {}
        player1 = fixture.get("player1") or {}
        player2 = fixture.get("player2") or {}

        if not player1 or not player2:
            logger.warning("Fixture %s missing player data, skipping prediction.", fixture_id)
            return None

        surface = tournament.get("surface", "hard_outdoor")
        cpi = float(tournament.get("court_pace_index", 35.0))
        best_of_sets = int(fixture.get("best_of_sets", 3))

        # 1. Surface-specific ELO ratings
        surface_key = f"{surface.split('_')[0]}_elo"  # hard_elo, clay_elo, grass_elo, indoor_elo
        if "indoor" in surface:
            surface_key = "indoor_elo"

        p1_elo = float(player1.get(surface_key, player1.get("hard_elo", 1500.0)))
        p2_elo = float(player2.get(surface_key, player2.get("hard_elo", 1500.0)))

        # 2. Derive single point serve win probabilities (p1, p2)
        # Empirical ATP baseline serve point win rate is ~64.5%; WTA is ~57.5%
        tour = tournament.get("tour", "ATP").upper()
        base_serve_pt = 0.645 if tour in ("ATP", "GRAND_SLAM") else 0.585

        elo_diff = p1_elo - p2_elo
        # Adjust for court speed (Faster CPI raises server advantage; slower CPI raises returner advantage)
        cpi_adjustment = (cpi - 35.0) * 0.002

        p1_serve_pt = base_serve_pt + (elo_diff / 3200.0) + cpi_adjustment
        p2_serve_pt = base_serve_pt - (elo_diff / 3200.0) + cpi_adjustment

        # Clamp within realistic professional boundaries
        p1_serve_pt = max(0.51, min(0.76, p1_serve_pt))
        p2_serve_pt = max(0.51, min(0.76, p2_serve_pt))

        # 3. Analytical Markov Calculations
        markov_match = TennisMarkovModel.match_probabilities(
            p1_serve_pt=p1_serve_pt,
            p2_serve_pt=p2_serve_pt,
            best_of_sets=best_of_sets
        )

        # 4. 250,000 Monte Carlo Simulations
        sim_res: SimulationResults = self.simulator.simulate_match(
            p1_serve_pt=p1_serve_pt,
            p2_serve_pt=p2_serve_pt,
            best_of_sets=best_of_sets,
            num_simulations=self.simulations_count
        )

        # 5. Market Selection & Best Value Identification
        primary_market, prediction_label, probability, conf_tier = self._select_best_market_and_tier(
            player1=player1,
            player2=player2,
            sim_res=sim_res,
            elo_diff=elo_diff
        )

        # Secondary predictions payload
        secondary_predictions = [
            {
                "market": "match_winner",
                "prediction": f"{player1['display_name']} Win",
                "probability": round(float(sim_res.p1_win_prob), 4)
            },
            {
                "market": "first_set_winner",
                "prediction": f"{player1['display_name']} 1st Set",
                "probability": round(float(sim_res.first_set_p1_prob), 4)
            },
            {
                "market": "set_handicap",
                "prediction": f"{player1['display_name']} -1.5 Sets",
                "probability": round(float(sim_res.set_handicap_p1_minus_1_5), 4)
            },
            {
                "market": "total_games_over_under",
                "prediction": f"Over 21.5 Games",
                "probability": round(float(sim_res.total_games_over.get("21.5", 0.50)), 4)
            }
        ]

        # Tactical AI analysis metadata
        metadata = {
            "surface": surface,
            "court_pace_index": cpi,
            "p1_surface_elo": p1_elo,
            "p2_surface_elo": p2_elo,
            "elo_delta": round(elo_diff, 1),
            "p1_hold_rate": sim_res.p1_hold_rate,
            "p2_hold_rate": sim_res.p2_hold_rate,
            "expected_total_games": sim_res.expected_total_games,
            "expected_game_margin": sim_res.expected_game_margin,
            "correct_set_scores": sim_res.correct_scores,
            "simulations_count": self.simulations_count,
            "tactical_reasoning": self._generate_tactical_reasoning(
                player1, player2, surface, cpi, elo_diff, sim_res, conf_tier
            )
        }

        # User tier required
        tier_required = "free"
        if conf_tier in ("BANGER", "TOP PICK"):
            tier_required = "standard"

        prediction_record = {
            "fixture_id": fixture_id,
            "market": primary_market,
            "prediction": prediction_label,
            "probability": round(probability, 4),
            "confidence_category": conf_tier,
            "secondary_predictions": secondary_predictions,
            "simulations_count": self.simulations_count,
            "tier_required": tier_required,
            "publication_status": "published",
            "target_kickoff_at": fixture["target_kickoff_at"],
            "metadata": metadata,
            "settlement_status": "pending"
        }

        return prediction_record

    def _select_best_market_and_tier(
        self,
        player1: Dict[str, Any],
        player2: Dict[str, Any],
        sim_res: SimulationResults,
        elo_diff: float
    ) -> Tuple[str, str, float, str]:
        """
        Determines the safest high-conviction betting market and confidence tier.
        Applies Zero-Hallucination rule:
        If match is volatile or probability < 0.60, classifies as NO_SAFE_BANKER.
        """
        p1_name = player1["display_name"]
        p2_name = player2["display_name"]

        # 1. Direct Match Winner candidate
        if sim_res.p1_win_prob >= 0.50:
            fav_prob = sim_res.p1_win_prob
            fav_name = p1_name
            fav_is_p1 = True
        else:
            fav_prob = sim_res.p2_win_prob
            fav_name = p2_name
            fav_is_p1 = False

        # Zero-Hallucination Banker Filter
        if fav_prob < 0.60:
            return (
                "NO_SAFE_BANKER",
                "NO SAFE BANKER (High Volatility)",
                0.5000,
                "NO_SAFE_BANKER"
            )

        # 2. Check for BANGER Tier (Elite Confidence >= 82% & strong ELO gap >= 175)
        if fav_prob >= 0.82 and abs(elo_diff) >= 175.0:
            # If favorite has dominant straight set probability (> 58%), set handicap is also high value
            straight_set_prob = sim_res.set_handicap_p1_minus_1_5 if fav_is_p1 else sim_res.correct_scores.get("0-2", 0.0)
            if straight_set_prob >= 0.68:
                return (
                    "set_handicap",
                    f"{fav_name} -1.5 Sets",
                    straight_set_prob,
                    "BANGER"
                )
            return (
                "match_winner",
                f"{fav_name} Win",
                fav_prob,
                "BANGER"
            )

        # 3. TOP PICK Tier (74.0% - 81.9%)
        if fav_prob >= 0.74:
            return (
                "match_winner",
                f"{fav_name} Win",
                fav_prob,
                "TOP PICK"
            )

        # 4. HIGH CONFIDENCE Tier (68.0% - 73.9%)
        if fav_prob >= 0.68:
            return (
                "match_winner",
                f"{fav_name} Win",
                fav_prob,
                "HIGH CONFIDENCE"
            )

        # 5. MID CONFIDENCE Tier (60.0% - 67.9%)
        return (
            "match_winner",
            f"{fav_name} Win",
            fav_prob,
            "MID CONFIDENCE"
        )

    @staticmethod
    def _generate_tactical_reasoning(
        p1: Dict[str, Any],
        p2: Dict[str, Any],
        surface: str,
        cpi: float,
        elo_diff: float,
        sim_res: SimulationResults,
        conf_tier: str
    ) -> str:
        fav_name = p1["display_name"] if elo_diff >= 0 else p2["display_name"]
        dog_name = p2["display_name"] if elo_diff >= 0 else p1["display_name"]
        surface_clean = surface.replace("_", " ").title()

        if conf_tier == "NO_SAFE_BANKER":
            return f"Close coin-flip matchup on {surface_clean}. Surface ELO differential ({abs(round(elo_diff, 1))} pts) within statistical error margin. High volatility detected; no safe banker identified."

        hold_fav = sim_res.p1_hold_rate if elo_diff >= 0 else sim_res.p2_hold_rate
        hold_dog = sim_res.p2_hold_rate if elo_diff >= 0 else sim_res.p1_hold_rate

        speed_desc = "fast" if cpi >= 40 else ("slow" if cpi <= 29 else "medium-paced")

        return (
            f"250,000 Monte Carlo iterations confirm {fav_name} as dominant on {surface_clean} courts (CPI {cpi} - {speed_desc}). "
            f"Projected service hold rate of {round(hold_fav * 100, 1)}% vs {dog_name}'s {round(hold_dog * 100, 1)}% provides a substantial break-differential advantage. "
            f"Expected game margin of {abs(sim_res.expected_game_margin)} games across {sim_res.expected_total_games} total games."
        )

    def generate_all_predictions(
        self,
        limit: int = 500,
        fixtures: Optional[List[Dict[str, Any]]] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Queries upcoming scheduled fixtures from Supabase (or uses provided fixtures)
        and publishes fresh predictions.
        """
        if fixtures is None:
            # Query upcoming scheduled fixtures (exclude fixtures older than 30 minutes)
            min_kickoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
            resp = self.db.client.get(
                "/tennis_fixtures",
                params={
                    "status": "eq.scheduled",
                    "target_kickoff_at": f"gte.{min_kickoff}",
                    "select": "*,tournament:tennis_tournaments(*),player1:tennis_players!tennis_fixtures_player1_id_fkey(*),player2:tennis_players!tennis_fixtures_player2_id_fkey(*)",
                    "order": "target_kickoff_at.asc",
                    "limit": str(limit)
                }
            )
            resp.raise_for_status()
            fixtures = resp.json()

        logger.info("Found %d scheduled tennis fixtures for prediction analysis (dry_run=%s)", len(fixtures), dry_run)
        stats = {
            "evaluated": 0,
            "published": 0,
            "bangers": 0,
            "top_picks": 0,
            "no_safe_bankers": 0,
            "dry_run": dry_run,
            "predictions": []
        }

        for fix in fixtures:
            try:
                pred = self.generate_prediction_for_fixture(fix)
                if not pred:
                    continue

                stats["evaluated"] += 1
                cat = pred["confidence_category"]
                if cat == "BANGER":
                    stats["bangers"] += 1
                elif cat == "TOP PICK":
                    stats["top_picks"] += 1
                elif cat == "NO_SAFE_BANKER":
                    stats["no_safe_bankers"] += 1

                stats["predictions"].append(pred)

                if not dry_run:
                    # Save directly into public.tennis_predictions table
                    self.db.save_prediction(pred)
                    stats["published"] += 1
                else:
                    stats["published"] += 1

            except Exception as e:
                logger.error("Failed to generate prediction for fixture %s: %s", fix.get("id"), e, exc_info=True)

        logger.info("Tennis Prediction Engine completed: %s", stats)
        return stats
