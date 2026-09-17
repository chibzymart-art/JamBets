"""
JamBets — Negative Binomial Set-Piece GLM Model
Mathematical engine for corner probability distributions under over-dispersion (r = 8.5).
Strictly evaluates Over 7.5 Corners and Over 8.5 Corners markets per user directive.
"""

import math
from typing import Dict, Any, Optional
from python.src.corners.corners_data_provider import DynamicClubProfile, DynamicLeagueMetrics
from python.src.corners.corner_intent_engine import CornerIntentAssessment


class NegativeBinomialCornersModel:
    """
    Evaluates expected corner kicks and tail probabilities using
    Negative Binomial GLM distribution.
    Variance = mu + (mu^2 / r), capturing real match over-dispersion.
    """

    @staticmethod
    def log_gamma(x: float) -> float:
        """Stirling approximation for log Gamma function."""
        return math.lgamma(x)

    @classmethod
    def pmf(cls, k: int, mu: float, r: float = 8.5) -> float:
        """
        Probability of exactly k corners under Negative Binomial distribution.
        Mean = mu, Over-dispersion parameter = r.
        """
        if mu <= 0 or k < 0:
            return 0.0
        p = mu / (mu + r)
        one_minus_p = r / (mu + r)

        log_comb = cls.log_gamma(k + r) - (cls.log_gamma(k + 1) + cls.log_gamma(r))
        log_prob = log_comb + (r * math.log(one_minus_p)) + (k * math.log(p))
        return math.exp(log_prob)

    @classmethod
    def calculate_tail_probabilities(cls, mu_total: float, r: float = 8.5) -> Dict[str, float]:
        """
        Computes tail probabilities for Over 7.5 and Over 8.5 corners.
        P(Over 7.5) = 1 - sum_{k=0}^7 P(X = k)
        P(Over 8.5) = 1 - sum_{k=0}^8 P(X = k)
        Also computes Over 9.5 and Over 10.5 for database telemetry.
        """
        cdf = [cls.pmf(k, mu_total, r) for k in range(13)]

        prob_under_8 = sum(cdf[:8])    # 0 to 7 -> Over 7.5 requires >= 8
        prob_under_9 = sum(cdf[:9])    # 0 to 8 -> Over 8.5 requires >= 9
        prob_under_10 = sum(cdf[:10])  # 0 to 9 -> Over 9.5 requires >= 10
        prob_under_11 = sum(cdf[:11])  # 0 to 10 -> Over 10.5 requires >= 11

        p_over_75 = round(max(0.15, min(0.96, 1.0 - prob_under_8)), 4)
        p_over_85 = round(max(0.10, min(0.94, 1.0 - prob_under_9)), 4)
        p_over_95 = round(max(0.08, min(0.90, 1.0 - prob_under_10)), 4)
        p_over_105 = round(max(0.05, min(0.85, 1.0 - prob_under_11)), 4)

        return {
            "over_7_5_prob": p_over_75,
            "over_8_5_prob": p_over_85,
            "over_9_5_prob": p_over_95,
            "over_10_5_prob": p_over_105
        }

    @classmethod
    def evaluate_matchup(
        cls,
        home_club: DynamicClubProfile,
        away_club: DynamicClubProfile,
        league: DynamicLeagueMetrics,
        intent: CornerIntentAssessment,
        r: float = 8.5
    ) -> Optional[Dict[str, Any]]:
        """
        Evaluates dynamic corner expectation and selects exclusively between
        Over 7.5 Corners and Over 8.5 Corners.
        """
        # Dynamic venue corner expectation
        # Combined attack intensity & opponent defense resilience scaled by Match Intent
        base_h = league.dynamic_corner_base_home
        base_a = league.dynamic_corner_base_away

        mu_home = base_h * (0.80 + (home_club.home_attack_intensity * 0.20)) * (0.85 + (away_club.away_defense_resilience * 0.15)) * intent.mcii_home
        mu_away = base_a * (0.80 + (away_club.away_attack_intensity * 0.20)) * (0.85 + (home_club.home_defense_resilience * 0.15)) * intent.mcii_away

        mu_home = max(3.5, min(7.8, mu_home))
        mu_away = max(2.8, min(6.8, mu_away))
        mu_total = round(mu_home + mu_away, 2)

        probs = cls.calculate_tail_probabilities(mu_total, r=r)
        p_over75 = probs["over_7_5_prob"]
        p_over85 = probs["over_8_5_prob"]

        # Selection logic strictly restricted to Over 7.5 and Over 8.5 ONLY
        if p_over85 >= 0.68 and mu_total >= 10.1:
            market = "over_8.5_corners"
            prediction = "Over 8.5 Corners"
            primary_prob = p_over85
            if primary_prob >= 0.74:
                confidence_category = "BANGER"
            else:
                confidence_category = "TOP PICK"
        elif p_over75 >= 0.70 and mu_total >= 9.4:
            market = "over_7.5_corners"
            prediction = "Over 7.5 Corners"
            primary_prob = p_over75
            if primary_prob >= 0.76:
                confidence_category = "TOP PICK"
            else:
                confidence_category = "MID_CONFIDENCE"
        else:
            # Insufficient mathematical edge to meet institutional quality gates
            return None

        return {
            "market": market,
            "prediction": prediction,
            "probability": primary_prob,
            "confidence_category": confidence_category,
            "corner_tier": intent.tactical_tag,
            "predicted_total_corners": mu_total,
            "home_corners_avg": round(mu_home, 1),
            "away_corners_avg": round(mu_away, 1),
            "over_7_5_prob": p_over75,
            "over_8_5_prob": p_over85,
            "over_9_5_prob": probs["over_9_5_prob"],
            "over_10_5_prob": probs["over_10_5_prob"],
            "tactical_rationale": intent.tactical_description,
            "mcii": intent.mcii,
            "siege_index": intent.siege_index,
            "wing_pressure_index": intent.wing_pressure_index
        }
