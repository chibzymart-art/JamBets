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
    def calculate_tail_probabilities(
        cls,
        mu_total: float,
        intent: Optional[CornerIntentAssessment] = None,
        r: float = 7.5
    ) -> Dict[str, float]:
        """
        Computes tail probabilities for Over 7.5 and Over 8.5 corners.
        P(Over 7.5) = 1 - sum_{k=0}^7 P(X = k)
        P(Over 8.5) = 1 - sum_{k=0}^8 P(X = k)
        Scales base tail mass using Game-State Late Surge Volatility
        (deflection clusters under territorial siege states).
        """
        cdf = [cls.pmf(k, mu_total, r) for k in range(13)]

        prob_under_8 = sum(cdf[:8])    # 0 to 7 -> Over 7.5 requires >= 8
        prob_under_9 = sum(cdf[:9])    # 0 to 8 -> Over 8.5 requires >= 9
        prob_under_10 = sum(cdf[:10])  # 0 to 9 -> Over 9.5 requires >= 10
        prob_under_11 = sum(cdf[:11])  # 0 to 10 -> Over 10.5 requires >= 11

        p_base_75 = max(0.15, min(0.96, 1.0 - prob_under_8))
        p_base_85 = max(0.10, min(0.94, 1.0 - prob_under_9))
        p_base_95 = max(0.08, min(0.90, 1.0 - prob_under_10))
        p_base_105 = max(0.05, min(0.85, 1.0 - prob_under_11))        # Game-State Late-Surge Volatility Factor
        # Teams under heavy tactical pressure/siege trigger repeated deflected corners in minutes 70-95.
        # Additive tactical lift anchors realistic tail probabilities for 7.5 and 8.5 markets.
        if intent:
            siege_lift = max(0.0, intent.siege_index - 1.0) * 0.40
            wing_lift = max(0.0, intent.wing_pressure_index - 1.0) * 0.35
            mcii_lift = max(0.0, intent.mcii - 1.0) * 0.45
            margin_75 = max(0.0, (mu_total - 7.50)) * 0.16
            margin_85 = max(0.0, (mu_total - 8.50)) * 0.18
            tactical_lift_75 = siege_lift + wing_lift + mcii_lift + margin_75
            tactical_lift_85 = (siege_lift + wing_lift + mcii_lift) * 0.85 + margin_85
        else:
            margin_75 = max(0.0, (mu_total - 7.50)) * 0.16
            margin_85 = max(0.0, (mu_total - 8.50)) * 0.18
            tactical_lift_75 = margin_75
            tactical_lift_85 = margin_85

        p_over_75 = round(max(0.25, min(0.86, p_base_75 + tactical_lift_75)), 4)
        p_over_85 = round(max(0.20, min(0.82, p_base_85 + tactical_lift_85)), 4)
        p_over_95 = round(max(0.12, min(0.75, p_base_95 + tactical_lift_85 * 0.6)), 4)
        p_over_105 = round(max(0.08, min(0.65, p_base_105 + tactical_lift_85 * 0.4)), 4)

        return {
            "over_7_5_prob": p_over_75,
            "over_8_5_prob": p_over_85,
            "over_9_5_prob": p_over_95,
            "over_10_5_prob": p_over_105,
            "over_7_5_pct": int(round(p_over_75 * 100)),
            "over_8_5_pct": int(round(p_over_85 * 100)),
        }

    @classmethod
    def evaluate_matchup(
        cls,
        home_club: DynamicClubProfile,
        away_club: DynamicClubProfile,
        league: DynamicLeagueMetrics,
        intent: CornerIntentAssessment,
        r: float = 7.5
    ) -> Optional[Dict[str, Any]]:
        """
        Evaluates dynamic corner expectation and selects exclusively between
        Over 7.5 Corners and Over 8.5 Corners.
        Projects realistic modern football totals (7.8 - 8.8 corners) without
        misleading 11+ inflation.
        """
        # Modern empirical corner projection:
        # Base venue values anchored to modern reality (6.8 - 8.1 total)
        base_h = league.dynamic_corner_base_home
        base_a = league.dynamic_corner_base_away

        # Additive dampened adjustments preventing multiplicative explosion
        h_att_adj = (home_club.home_attack_intensity - 1.0) * 0.40
        a_def_adj = (away_club.away_defense_resilience - 1.0) * 0.30
        h_intent_adj = (intent.mcii_home - 1.0) * 0.70

        a_att_adj = (away_club.away_attack_intensity - 1.0) * 0.35
        h_def_adj = (home_club.home_defense_resilience - 1.0) * 0.25
        a_intent_adj = (intent.mcii_away - 1.0) * 0.70

        mu_home = base_h + h_att_adj + a_def_adj + h_intent_adj
        mu_away = base_a + a_att_adj + h_def_adj + a_intent_adj

        # Grounded clamps: home typically 3.4 - 5.1, away 2.6 - 3.9
        mu_home = max(3.30, min(5.20, mu_home))
        mu_away = max(2.50, min(4.00, mu_away))
        mu_total = round(min(9.10, max(6.50, mu_home + mu_away)), 2)

        probs = cls.calculate_tail_probabilities(mu_total, intent=intent, r=r)
        p_over75 = probs["over_7_5_prob"]
        p_over85 = probs["over_8_5_prob"]

        # Selection logic strictly restricted to Over 7.5 and Over 8.5 ONLY
        # Over 8.5 requires high projected expectation (>= 8.35 corners) and >= 68% probability
        if p_over85 >= 0.68 and mu_total >= 8.35:
            market = "over_8.5_corners"
            prediction = "Over 8.5 Corners"
            primary_prob = p_over85
            if primary_prob >= 0.74:
                confidence_category = "BANGER"
            else:
                confidence_category = "TOP PICK"
        # Over 7.5 requires >= 7.65 corners and >= 68% probability
        elif p_over75 >= 0.68 and mu_total >= 7.65:
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
            "over_7_5_pct": probs["over_7_5_pct"],
            "over_8_5_pct": probs["over_8_5_pct"],
            "tactical_rationale": intent.tactical_description,
            "mcii": intent.mcii,
            "siege_index": intent.siege_index,
            "wing_pressure_index": intent.wing_pressure_index
        }
