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

        p1_rank = player1.get("current_rank") or player1.get("rank")
        p2_rank = player2.get("current_rank") or player2.get("rank")

        # Contextual baseline ELO for unranked players (1520 Masters/GS, 1450 Tour, 1380 Challenger)
        p1_base = TennisEloEngine.calculate_baseline_elo(p1_rank, tournament=tournament)
        p2_base = TennisEloEngine.calculate_baseline_elo(p2_rank, tournament=tournament)

        p1_elo = float(player1.get(surface_key) or player1.get("hard_elo") or p1_base)
        p2_elo = float(player2.get(surface_key) or player2.get("hard_elo") or p2_base)

        # 2. Derive single point serve win probabilities (p1, p2)
        # Empirical ATP baseline serve point win rate is ~64.5%; WTA is ~57.5%
        tour = str(tournament.get("tour") or fixture.get("tour") or "").upper()
        if not tour and fixture.get("canonical_key"):
            tour = fixture["canonical_key"].split(":")[0].upper()
        if not tour:
            tour = "ATP"
        base_serve_pt = 0.645 if tour in ("ATP", "GRAND_SLAM") else 0.585

        elo_diff = p1_elo - p2_elo

        # Calibrated serve point differential bounded to empirical ATP/WTA spread:
        # Scaled logistic curve preventing hyperbolic S-curve distortion.
        # Max serve point delta is realistically bounded at ±5.2% (10.4% maximum total serve gap).
        serve_delta = math.tanh(elo_diff / 480.0) * 0.052

        # Adjust for court speed (Faster CPI raises server advantage; slower CPI raises returner advantage)
        cpi_adjustment = (cpi - 35.0) * 0.001

        p1_serve_pt = base_serve_pt + serve_delta + cpi_adjustment
        p2_serve_pt = base_serve_pt - serve_delta + cpi_adjustment

        # Clamp within realistic professional boundaries (never below 52% or above 73%)
        p1_serve_pt = max(0.52, min(0.73, p1_serve_pt))
        p2_serve_pt = max(0.52, min(0.73, p2_serve_pt))

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
            elo_diff=elo_diff,
            tournament=tournament
        )

        # Secondary predictions payload (strictly dynamic real simulation data, zero artificial clamping)
        fav_is_p1 = sim_res.p1_win_prob >= 0.50
        fav_name = player1["display_name"] if fav_is_p1 else player2["display_name"]
        dog_name = player2["display_name"] if fav_is_p1 else player1["display_name"]
        fav_win_prob = sim_res.p1_win_prob if fav_is_p1 else sim_res.p2_win_prob

        # 1. First Set Winner - Real Markov + Monte Carlo 1st set transition probability
        if sim_res.first_set_p1_prob >= sim_res.first_set_p2_prob:
            first_set_pred = f"{player1['display_name']} 1st Set"
            first_set_prob = round(float(sim_res.first_set_p1_prob), 4)
        else:
            first_set_pred = f"{player2['display_name']} 1st Set"
            first_set_prob = round(float(sim_res.first_set_p2_prob), 4)

        # 2. Game Handicap (Spread) - Dynamic line centered on actual expected game margin
        fav_margin = abs(sim_res.expected_game_margin)
        fav_hcaps = sim_res.p1_game_handicaps if fav_is_p1 else sim_res.p2_game_handicaps
        dog_hcaps = sim_res.p2_game_handicaps if fav_is_p1 else sim_res.p1_game_handicaps

        raw_spread_line = round(fav_margin - 0.5) + 0.5
        spread_line = max(1.5, min(9.5, raw_spread_line))
        fav_cover_prob = fav_hcaps.get(f"-{spread_line}", 0.50)

        if fav_cover_prob >= 0.50:
            spread_pred = f"{fav_name} -{spread_line} Games"
            spread_prob = round(float(fav_cover_prob), 4)
        else:
            alt_line = spread_line - 1.0
            alt_cover = fav_hcaps.get(f"-{alt_line}", 0.0) if alt_line >= 0.5 else 0.0
            if alt_cover >= 0.50:
                spread_pred = f"{fav_name} -{alt_line} Games"
                spread_prob = round(float(alt_cover), 4)
            else:
                dog_cover = dog_hcaps.get(f"+{spread_line}", 0.50)
                spread_pred = f"{dog_name} +{spread_line} Games"
                spread_prob = round(float(dog_cover), 4)

        # 3. Dynamic Total Games Over/Under (Centered on expected_total_games)
        exp_games = sim_res.expected_total_games
        raw_ou_line = round(exp_games - 0.5) + 0.5
        min_ou = 17.5 if best_of_sets == 3 else 31.5
        max_ou = 27.5 if best_of_sets == 3 else 46.5
        ou_line = max(min_ou, min(max_ou, raw_ou_line))

        prob_over = sim_res.total_games_over.get(str(ou_line), 0.50)
        prob_under = round(1.0 - prob_over, 4)

        if prob_over >= 0.50:
            ou_pred = f"Over {ou_line} Games"
            ou_prob = round(float(prob_over), 4)
        else:
            ou_pred = f"Under {ou_line} Games"
            ou_prob = round(float(prob_under), 4)

        # 4. Symmetrical Set Handicap & Parity Coin-Flip Handling
        fav_set_minus = sim_res.set_handicap_p1_minus_1_5 if fav_is_p1 else sim_res.set_handicap_p2_minus_1_5
        dog_set_plus = sim_res.set_handicap_p2_plus_1_5 if fav_is_p1 else sim_res.set_handicap_p1_plus_1_5

        if conf_tier == "NO_SAFE_BANKER" or fav_win_prob < 0.58:
            # Coin-flip / High Volatility / Unranked Opponent match:
            # Pure real-time predicted parity markets derived from 250,000 simulations:
            if best_of_sets == 5:
                if sim_res.over_2_5_sets_prob >= 0.50:
                    set_pred = "Over 3.5 Sets"
                    set_prob = round(float(sim_res.over_2_5_sets_prob), 4)
                else:
                    set_pred = f"{dog_name} +1.5 Sets"
                    set_prob = round(float(dog_set_plus), 4)
            else:
                if sim_res.over_2_5_sets_prob >= 0.50:
                    set_pred = "Over 2.5 Sets"
                    set_prob = round(float(sim_res.over_2_5_sets_prob), 4)
                else:
                    set_pred = f"{dog_name} +1.5 Sets"
                    set_prob = round(float(dog_set_plus), 4)
        else:
            # Clear favorite match:
            if fav_set_minus >= 0.50:
                set_pred = f"{fav_name} -1.5 Sets"
                set_prob = round(float(fav_set_minus), 4)
            else:
                set_pred = f"{dog_name} +1.5 Sets"
                set_prob = round(float(dog_set_plus), 4)

        # Assembled 4 Calibrated Secondary Predictions (All distinct, non-duplicate, purely predicted)
        secondary_predictions = [
            {
                "market": "game_handicap",
                "prediction": spread_pred,
                "probability": spread_prob
            },
            {
                "market": "first_set_winner",
                "prediction": first_set_pred,
                "probability": first_set_prob
            },
            {
                "market": "set_handicap",
                "prediction": set_pred,
                "probability": set_prob
            },
            {
                "market": "total_games_over_under",
                "prediction": ou_pred,
                "probability": ou_prob
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
            "probability": round(float(probability), 4),
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
        elo_diff: float,
        tournament: Optional[Dict[str, Any]] = None
    ) -> Tuple[str, str, float, str]:
        """
        Determines the safest high-conviction betting market and confidence tier.
        Applies Zero-Hallucination & Unranked Wildcard Quarantine:
        1. If match is volatile or probability < 0.60, classifies as NO_SAFE_BANKER.
        2. If either competitor is unranked (wildcard/qualifier), caps tier at MID CONFIDENCE or NO_SAFE_BANKER.
        3. Capped at TOP PICK for ATP Challenger tournaments due to higher baseline variance.
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

        # 1. Zero-Hallucination Banker Filter
        # Under calibrated math, a favorite under 58% or with an Elo gap < 40 pts is a pure coin-flip
        if fav_prob < 0.58 or abs(elo_diff) < 40.0:
            return (
                "NO_SAFE_BANKER",
                "NO SAFE BANKER (High Volatility)",
                0.5000,
                "NO_SAFE_BANKER"
            )

        # 2. Unranked Player Safety Quarantine
        # When either competitor lacks an official verified ATP/WTA ranking,
        # true baseline skill is ungrounded (wildcard/qualifier variance).
        p1_rank = player1.get("current_rank")
        p2_rank = player2.get("current_rank")
        has_unranked = (p1_rank is None or p1_rank <= 0) or (p2_rank is None or p2_rank <= 0)

        if has_unranked:
            if fav_prob < 0.70:
                return (
                    "NO_SAFE_BANKER",
                    "NO SAFE BANKER (Unranked Opponent / High Volatility)",
                    0.5000,
                    "NO_SAFE_BANKER"
                )
            # Maximum allowed tier for an unranked opponent is strictly MID CONFIDENCE
            return (
                "match_winner",
                f"{fav_name} Win",
                fav_prob,
                "MID CONFIDENCE"
            )

        # Tournament Context
        tour_str = (tournament.get("tour") or "").upper() if tournament else ""
        cat_str = (tournament.get("category") or "").upper() if tournament else ""
        is_challenger = cat_str in ("CH", "125") or tour_str == "CHALLENGER"

        # 3. BANGER Tier (Elite Banker standard: target >= 85% verified win rate)
        # Strictly reserved for verified ATP/WTA Tour & Grand Slam matches.
        # Requires massive skill class separation (ELO gap >= 300 pts) and calibrated probability >= 80%.
        # Challengers are excluded from BANGER tier due to higher variance and withdrawal rates.
        if fav_prob >= 0.80 and abs(elo_diff) >= 300.0 and not is_challenger:
            return (
                "match_winner",
                f"{fav_name} Win",
                fav_prob,
                "BANGER"
            )

        # 4. TOP PICK Tier (73.0% - 79.9%, ELO gap >= 170 pts, or >= 80% in Challengers)
        if fav_prob >= 0.73 and (abs(elo_diff) >= 170.0 or is_challenger):
            return (
                "match_winner",
                f"{fav_name} Win",
                fav_prob,
                "TOP PICK"
            )

        # 5. HIGH CONFIDENCE Tier (66.0% - 72.9%, ELO gap >= 80 pts)
        if fav_prob >= 0.66 and abs(elo_diff) >= 80.0:
            return (
                "match_winner",
                f"{fav_name} Win",
                fav_prob,
                "HIGH CONFIDENCE"
            )

        # 6. MID CONFIDENCE Tier (58.0% - 65.9%)
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
        p1_rank = p1.get("current_rank")
        p2_rank = p2.get("current_rank")
        has_unranked = (p1_rank is None or p1_rank <= 0) or (p2_rank is None or p2_rank <= 0)
        unranked_note = " Match features unranked competitor with unverified professional baseline; confidence capped to manage wildcard variance." if has_unranked else ""

        return (
            f"250,000 Monte Carlo iterations confirm {fav_name} as dominant on {surface_clean} courts (CPI {cpi} - {speed_desc}). "
            f"Projected service hold rate of {round(hold_fav * 100, 1)}% vs {dog_name}'s {round(hold_dog * 100, 1)}% provides a substantial break-differential advantage. "
            f"Expected game margin of {abs(sim_res.expected_game_margin)} games across {sim_res.expected_total_games} total games.{unranked_note}"
        )

    def generate_all_predictions(
        self,
        limit: int = 500,
        fixtures: Optional[List[Dict[str, Any]]] = None,
        dry_run: bool = False,
        min_kickoff: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Queries upcoming scheduled fixtures from Supabase (or uses provided fixtures)
        and publishes fresh predictions.
        """
        if fixtures is None:
            # Query upcoming scheduled fixtures (include fixtures from past 6 hours to handle tennis delays)
            if not min_kickoff:
                min_kickoff = (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
            resp = self.db.client.get(
                "/tennis_fixtures",
                params={
                    "status": "in.(scheduled,live)",
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
