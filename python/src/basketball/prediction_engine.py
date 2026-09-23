"""
Oddsbanta — Autonomous Basketball Prediction Engine
Phase 3: Quantitative Simulation Model & Market Classifier

Features:
1. Orchestrates Four Factors Model + 250,000 Monte Carlo Simulator
2. Evaluates Point Spread, Game Totals, and Moneylines
3. Identifies Primary Super Banker (+EV Edge) and Secondary Leans
4. Classifies Confidence Tiers (BANGER, TOP PICK, HIGH CONFIDENCE)
5. Generates AI Tactical Analysis and Four Factors differentials

Invariant: Isolated basketball prediction engine. Zero football cross-contamination.
"""

import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone

from python.src.basketball.models import (
    BasketballPredictionModel,
    BasketballMarket,
    BasketballConfidenceTier,
    BasketballFourFactors,
)
from python.src.basketball.four_factors import FourFactorsModel, MatchupExpectation
from python.src.basketball.monte_carlo import BasketballMonteCarloSimulator, BasketballSimDistribution

logger = logging.getLogger("basketball.prediction_engine")


class BasketballPredictionEngine:
    """
    Core quantitative prediction and market value classifier for basketball.
    """

    def __init__(self, simulator: Optional[BasketballMonteCarloSimulator] = None):
        self.simulator = simulator or BasketballMonteCarloSimulator(default_simulations=250000)

    def generate_prediction(
        self,
        fixture_id: str,
        league_code: str,
        home_team_name: str,
        away_team_name: str,
        home_pace: float,
        away_pace: float,
        home_ortg: float,
        home_drtg: float,
        away_ortg: float,
        away_drtg: float,
        home_ff: BasketballFourFactors,
        away_ff: BasketballFourFactors,
        home_rest_days: int = 1,
        away_rest_days: int = 1,
        is_home_b2b: bool = False,
        is_away_b2b: bool = False,
        market_spread: Optional[float] = None,
        market_total: Optional[float] = None,
        home_ml_odds: Optional[float] = None,
        away_ml_odds: Optional[float] = None,
        target_kickoff_at: Optional[datetime] = None,
        num_simulations: int = 250000
    ) -> BasketballPredictionModel:
        """
        Runs full 250,000 Monte Carlo simulation and classifies banker markets.
        """
        # 1. Evaluate baseline matchup with Four Factors & Schedule Rest
        expectation: MatchupExpectation = FourFactorsModel.evaluate_matchup(
            league_code=league_code,
            home_team_name=home_team_name,
            away_team_name=away_team_name,
            home_pace=home_pace,
            away_pace=away_pace,
            home_ortg=home_ortg,
            home_drtg=home_drtg,
            away_ortg=away_ortg,
            away_drtg=away_drtg,
            home_ff=home_ff,
            away_ff=away_ff,
            home_rest_days=home_rest_days,
            away_rest_days=away_rest_days,
            is_home_b2b=is_home_b2b,
            is_away_b2b=is_away_b2b,
        )

        # 2. Execute 250,000 Monte Carlo simulations
        sim_res: BasketballSimDistribution = self.simulator.simulate(
            home_mean=expectation.home_expected_score,
            away_mean=expectation.away_expected_score,
            pace=expectation.expected_pace,
            market_spread=market_spread,
            market_total=market_total,
            num_simulations=num_simulations
        )

        # 3. Market Option Evaluations
        candidates = []

        # A. Moneyline Market
        if sim_res.home_win_prob >= 0.50:
            odds = home_ml_odds or round(1.0 / max(0.01, sim_res.home_win_prob), 2)
            fair, edge = self.simulator.calculate_ev_edge(sim_res.home_win_prob, odds)
            candidates.append({
                "market": BasketballMarket.MONEYLINE,
                "prediction": f"{home_team_name} To Win",
                "probability": sim_res.home_win_prob,
                "fair_odds": fair,
                "market_odds": odds,
                "edge_pct": edge,
            })
        else:
            odds = away_ml_odds or round(1.0 / max(0.01, sim_res.away_win_prob), 2)
            fair, edge = self.simulator.calculate_ev_edge(sim_res.away_win_prob, odds)
            candidates.append({
                "market": BasketballMarket.MONEYLINE,
                "prediction": f"{away_team_name} To Win",
                "probability": sim_res.away_win_prob,
                "fair_odds": fair,
                "market_odds": odds,
                "edge_pct": edge,
            })

        # B. Point Spread Market
        # If market spread given, evaluate; else pick closest integer spread to median margin
        chosen_spread = market_spread if market_spread is not None else round(expectation.expected_margin)
        spread_key = str(float(chosen_spread))
        cover_prob = sim_res.spread_cover_probs.get(spread_key, 0.50)

        if cover_prob >= 0.50:
            pred_text = f"{home_team_name} {chosen_spread:+.1f} Points"
            prob = cover_prob
        else:
            opp_spread = -chosen_spread
            pred_text = f"{away_team_name} {opp_spread:+.1f} Points"
            prob = round(1.0 - cover_prob, 4)

        spread_odds = 1.90  # Standard consensus spread price (-110 American)
        fair_sp, edge_sp = self.simulator.calculate_ev_edge(prob, spread_odds)
        candidates.append({
            "market": BasketballMarket.POINT_SPREAD,
            "prediction": pred_text,
            "probability": prob,
            "fair_odds": fair_sp,
            "market_odds": spread_odds,
            "edge_pct": edge_sp,
        })

        # C. Game Totals Market (Over / Under)
        chosen_total = market_total if market_total is not None else round(expectation.expected_total)
        total_key = str(float(chosen_total))
        over_prob = sim_res.totals_over_probs.get(total_key, 0.50)

        if over_prob >= 0.50:
            pred_total_text = f"Over {chosen_total:.1f} Total Points"
            total_prob = over_prob
        else:
            pred_total_text = f"Under {chosen_total:.1f} Total Points"
            total_prob = round(1.0 - over_prob, 4)

        total_odds = 1.90
        fair_tot, edge_tot = self.simulator.calculate_ev_edge(total_prob, total_odds)
        candidates.append({
            "market": BasketballMarket.GAME_TOTAL_OVER_UNDER,
            "prediction": pred_total_text,
            "probability": total_prob,
            "fair_odds": fair_tot,
            "market_odds": total_odds,
            "edge_pct": edge_tot,
        })

        # 4. Select Primary Super Banker (prioritizes highest Edge % and highest Probability)
        candidates.sort(key=lambda c: (c["edge_pct"] * 0.6) + (c["probability"] * 40.0), reverse=True)
        primary = candidates[0]
        secondary = candidates[1:]

        # 5. Determine Confidence Tier
        p = primary["probability"]
        edge = primary["edge_pct"]

        if p >= 0.72 or edge >= 7.5:
            tier = BasketballConfidenceTier.BANGER
        elif p >= 0.64 or edge >= 4.5:
            tier = BasketballConfidenceTier.TOP_PICK
        elif p >= 0.58 or edge >= 2.5:
            tier = BasketballConfidenceTier.HIGH_CONFIDENCE
        elif p >= 0.52:
            tier = BasketballConfidenceTier.MID_CONFIDENCE
        elif p >= 0.48:
            tier = BasketballConfidenceTier.LOW_CONFIDENCE
        elif p >= 0.44:
            tier = BasketballConfidenceTier.RISKY
        else:
            tier = BasketballConfidenceTier.NO_SAFE_BANKER

        # Secondary predictions list
        secondary_list = [
            {
                "market": c["market"].value,
                "pick": c["prediction"],
                "probability": c["probability"],
                "tier": (
                    BasketballConfidenceTier.TOP_PICK.value if c["probability"] >= 0.64
                    else BasketballConfidenceTier.HIGH_CONFIDENCE.value if c["probability"] >= 0.58
                    else BasketballConfidenceTier.MID_CONFIDENCE.value
                ),
            }
            for c in secondary
        ]

        # 6. Compose AI Tactical Analysis Notes
        tactical_notes = self._generate_tactical_analysis(
            home_team_name, away_team_name, expectation, primary, tier
        )

        metadata = {
            "simulation": {
                "simulations_count": sim_res.simulations_count,
                "expected_pace": expectation.expected_pace,
                "home_adj_ortg": expectation.home_adj_ortg,
                "away_adj_ortg": expectation.away_adj_ortg,
                "simulated_home_score": sim_res.simulated_home_score,
                "simulated_away_score": sim_res.simulated_away_score,
                "first_half_score": f"{sim_res.first_half_home_score} - {sim_res.first_half_away_score}",
                "distribution_percentiles": sim_res.percentiles,
                "execution_ms": sim_res.execution_time_ms,
            },
            "four_factors_differential": expectation.four_factors_diff,
            "situational_factors": {
                "hca_points": expectation.hca_applied,
                "home_fatigue": expectation.fatigue_applied_home,
                "away_fatigue": expectation.fatigue_applied_away,
                "home_rest_days": home_rest_days,
                "away_rest_days": away_rest_days,
                "is_home_b2b": is_home_b2b,
                "is_away_b2b": is_away_b2b,
            },
            "ai_tactical_analysis": tactical_notes,
        }

        tier_required = "vip" if tier == BasketballConfidenceTier.BANGER else ("standard" if tier == BasketballConfidenceTier.TOP_PICK else "free")

        return BasketballPredictionModel(
            id=None,
            fixture_id=fixture_id,
            market=primary["market"],
            prediction=primary["prediction"],
            probability=primary["probability"],
            confidence_category=tier,
            secondary_predictions=secondary_list,
            simulations_count=sim_res.simulations_count,
            simulated_home_score=sim_res.simulated_home_score,
            simulated_away_score=sim_res.simulated_away_score,
            edge_percentage=primary["edge_pct"],
            fair_odds=primary["fair_odds"],
            market_odds=primary["market_odds"],
            tier_required=tier_required,
            publication_status="published",
            target_kickoff_at=target_kickoff_at or datetime.now(timezone.utc),
            metadata=metadata
        )

    def _generate_tactical_analysis(
        self,
        home: str,
        away: str,
        exp: MatchupExpectation,
        primary: Dict[str, Any],
        tier: BasketballConfidenceTier
    ) -> str:
        ff = exp.four_factors_diff
        efg = ff.get("efg_diff", 0.0)
        tov = ff.get("tov_diff", 0.0)
        orb = ff.get("orb_diff", 0.0)

        advantages = []
        if abs(efg) >= 0.03:
            adv_team = home if efg > 0 else away
            advantages.append(f"{adv_team} holds a +{abs(efg)*100:.1f}% eFG% shooting edge")
        if abs(orb) >= 0.04:
            adv_team = home if orb > 0 else away
            advantages.append(f"{adv_team} dominates second-chance boards (+{abs(orb)*100:.1f}% ORB)")
        if exp.hca_applied >= 3.8:
            advantages.append(f"Significant altitude/venue home court boost (+{exp.hca_applied:.1f} pts)")
        if exp.fatigue_applied_away < -2.0:
            advantages.append(f"{away} enters with schedule fatigue / back-to-back penalty")

        adv_summary = "; ".join(advantages) if advantages else "Balanced statistical matchup across the Four Factors."
        return (
            f"250k Monte Carlo models project {home} {exp.home_expected_score:.1f} - {away} {exp.away_expected_score:.1f} "
            f"across {exp.expected_pace:.1f} expected possessions. {adv_summary} "
            f"Key recommendation: {primary['prediction']} ({primary['probability']*100:.1f}% Prob, {tier.value})."
        )
