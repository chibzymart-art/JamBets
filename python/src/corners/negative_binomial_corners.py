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
            margin_95 = max(0.0, (mu_total - 9.50)) * 0.20
            tactical_lift_75 = siege_lift + wing_lift + mcii_lift + margin_75
            tactical_lift_85 = (siege_lift + wing_lift + mcii_lift) * 0.85 + margin_85
            tactical_lift_95 = (siege_lift + wing_lift + mcii_lift) * 0.70 + margin_95
        else:
            margin_75 = max(0.0, (mu_total - 7.50)) * 0.16
            margin_85 = max(0.0, (mu_total - 8.50)) * 0.18
            margin_95 = max(0.0, (mu_total - 9.50)) * 0.20
            tactical_lift_75 = margin_75
            tactical_lift_85 = margin_85
            tactical_lift_95 = margin_95

        p_over_75 = round(max(0.25, min(0.88, p_base_75 + tactical_lift_75)), 4)
        p_over_85 = round(max(0.20, min(0.84, p_base_85 + tactical_lift_85)), 4)
        p_over_95 = round(max(0.15, min(0.80, p_base_95 + tactical_lift_95)), 4)
        p_over_105 = round(max(0.08, min(0.65, p_base_105 + tactical_lift_85 * 0.4)), 4)

        return {
            "over_7_5_prob": p_over_75,
            "over_8_5_prob": p_over_85,
            "over_9_5_prob": p_over_95,
            "over_10_5_prob": p_over_105,
            "over_7_5_pct": int(round(p_over_75 * 100)),
            "over_8_5_pct": int(round(p_over_85 * 100)),
            "over_9_5_pct": int(round(p_over_95 * 100)),
        }

    @classmethod
    def evaluate_matchup(
        cls,
        home_club: DynamicClubProfile,
        away_club: DynamicClubProfile,
        league: DynamicLeagueMetrics,
        intent: CornerIntentAssessment,
        h2h: Optional[Any] = None,
        r: float = 7.5
    ) -> Optional[Dict[str, Any]]:
        """
        Evaluates dynamic corner expectation and selects across the 7.5 - 9.5 range:
        Over 7.5 Corners, Over 8.5 Corners, and Over 9.5 Corners.
        Projects realistic modern football totals grounded in historical data,
        team attacking & defensive strengths, xG, and territorial siege dynamics.
        """
        # Base venue values anchored to empirical league baselines
        base_h = league.dynamic_corner_base_home
        base_a = league.dynamic_corner_base_away

        # Attacking intensity drives territory and shot deflections; defensive vulnerability creates clearances
        h_att_adj = (home_club.home_attack_intensity - 1.0) * 0.55
        a_def_adj = (away_club.away_defense_resilience - 1.0) * 0.40
        h_intent_adj = (intent.mcii_home - 1.0) * 0.75

        a_att_adj = (away_club.away_attack_intensity - 1.0) * 0.45
        h_def_adj = (home_club.home_defense_resilience - 1.0) * 0.35
        a_intent_adj = (intent.mcii_away - 1.0) * 0.75

        # Direct H2H pace adjustment if verified encounters exist
        h2h_mult = 1.0
        if h2h and getattr(h2h, "has_sufficient_h2h", False) and getattr(h2h, "matches_count", 0) >= 2:
            h2h_mult = max(0.92, min(1.10, h2h.avg_total_goals / max(2.0, league.avg_total_goals)))

        mu_home = (base_h + h_att_adj + a_def_adj + h_intent_adj) * h2h_mult
        mu_away = (base_a + a_att_adj + h_def_adj + a_intent_adj) * h2h_mult

        # Grounded bounds reflecting real professional football distributions
        mu_home = max(3.40, min(7.50, mu_home))
        mu_away = max(2.60, min(5.80, mu_away))
        mu_total = round(min(12.50, max(6.80, mu_home + mu_away)), 2)

        probs = cls.calculate_tail_probabilities(mu_total, intent=intent, r=r)
        p_over75 = probs["over_7_5_prob"]
        p_over85 = probs["over_8_5_prob"]
        p_over95 = probs["over_9_5_prob"]

        # Tri-Line Expected Value (EV) & Institutional Quality Gates across 7.5 - 9.5
        # Standard Market Pricing Reference:
        # Over 9.5 Corners typical odds ~ 2.25 (implied prob ~ 44%)
        # Over 8.5 Corners typical odds ~ 1.85 (implied prob ~ 54%)
        # Over 7.5 Corners typical odds ~ 1.45 (implied prob ~ 69%)
        ev_95 = (p_over95 * 2.25) - 1.0
        ev_85 = (p_over85 * 1.85) - 1.0
        ev_75 = (p_over75 * 1.45) - 1.0

        # Gate for Over 9.5 Corners:
        # High pace / siege matches requiring mu_total >= 9.35, P(Over 9.5) >= 0.50, and EV >= +6%
        qualifies_95 = (p_over95 >= 0.50 and mu_total >= 9.35 and ev_95 >= 0.06)

        # Gate for Over 8.5 Corners:
        # Strong pace matches requiring mu_total >= 8.50, P(Over 8.5) >= 0.58, and EV >= +7%
        qualifies_85 = (p_over85 >= 0.58 and mu_total >= 8.50 and ev_85 >= 0.07)

        # Gate for Over 7.5 Corners:
        # Controlled matches requiring mu_total >= 7.80, P(Over 7.5) >= 0.68, and EV >= +5%
        qualifies_75 = (p_over75 >= 0.68 and mu_total >= 7.80 and ev_75 >= 0.05)

        # Select the optimal line between 7.5 and 9.5 prioritizing highest structural edge
        if qualifies_95 and (ev_95 >= max(ev_85, ev_75) or mu_total >= 9.80):
            market = "over_9.5_corners"
            prediction = "Over 9.5 Corners"
            primary_prob = p_over95
            if primary_prob >= 0.64:
                confidence_category = "BANGER"
            elif primary_prob >= 0.56:
                confidence_category = "TOP PICK"
            else:
                confidence_category = "MID_CONFIDENCE"
        elif qualifies_85 and (ev_85 >= ev_75 or mu_total >= 8.85):
            market = "over_8.5_corners"
            prediction = "Over 8.5 Corners"
            primary_prob = p_over85
            if primary_prob >= 0.68:
                confidence_category = "BANGER"
            elif primary_prob >= 0.62:
                confidence_category = "TOP PICK"
            else:
                confidence_category = "MID_CONFIDENCE"
        elif qualifies_75:
            market = "over_7.5_corners"
            prediction = "Over 7.5 Corners"
            primary_prob = p_over75
            if primary_prob >= 0.78:
                confidence_category = "BANGER"
            elif primary_prob >= 0.73:
                confidence_category = "TOP PICK"
            else:
                confidence_category = "MID_CONFIDENCE"
        elif qualifies_85:
            market = "over_8.5_corners"
            prediction = "Over 8.5 Corners"
            primary_prob = p_over85
            confidence_category = "MID_CONFIDENCE"
        elif qualifies_95:
            market = "over_9.5_corners"
            prediction = "Over 9.5 Corners"
            primary_prob = p_over95
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
            "over_9_5_prob": p_over95,
            "over_10_5_prob": probs["over_10_5_prob"],
            "over_7_5_pct": probs["over_7_5_pct"],
            "over_8_5_pct": probs["over_8_5_pct"],
            "over_9_5_pct": probs["over_9_5_pct"],
            "tactical_rationale": intent.tactical_description,
            "mcii": intent.mcii,
            "siege_index": intent.siege_index,
            "wing_pressure_index": intent.wing_pressure_index
        }
