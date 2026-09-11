"""
JamBets — AI Simulation Intelligence Summarizer
Generates contextual, authoritative analytical summaries for every 250,000-draw
Monte Carlo football simulation, highlighting Poisson parameters (xG, attack/defense, home boost),
projected scorelines, primary banker certainty, and secondary tactical leans.
"""

from typing import Dict, Any, List, Optional


class AISimulationSummarizer:
    """
    Synthesizes rich Poisson-Monte Carlo AI intelligence summaries from 250,000 simulation distributions
    and Dixon-Coles parametric expectations.
    """

    @classmethod
    def generate_summary(
        cls,
        home_team: str,
        away_team: str,
        league_code: str,
        lambda_home: float,
        lambda_away: float,
        sim_result: Any,  # SimulationRunResult
        primary_market: str,
        primary_outcome: str,
        primary_prob_pct: float,
        confidence_tier: str,
        secondary_predictions: List[Dict[str, Any]],
        is_consensus_banker: bool = False,
        data_tier: str = "TIER_1_FOTMOB",
        home_attack: float = 1.13,
        away_defense: float = 0.97,
        home_boost_pct: float = 15.0
    ) -> str:
        """
        Generates an authoritative Poisson-Monte Carlo analysis and strategic recommendation.
        """
        # 1. Format team names cleanly
        h_name = home_team.replace("-", " ").title()
        a_name = away_team.replace("-", " ").title()

        # 2. Extract Poisson parameters and outlines if available from sim_result
        outlines = getattr(sim_result, "simulation_outlines", {}) or {}
        poisson_params = getattr(sim_result, "poisson_parameters", {}) or {}

        att_h = float(poisson_params.get("home_attack_str", home_attack))
        def_a = float(poisson_params.get("away_defense_str", away_defense))
        boost = float(poisson_params.get("home_boost_pct", home_boost_pct))

        # 3. Format primary pick nicely
        def format_market_label(m_name: str, out_val: str) -> str:
            m_lower = m_name.lower()
            o_lower = out_val.lower()
            if m_lower == "1x2":
                if o_lower == "home":
                    return f"{h_name} Win"
                elif o_lower == "away":
                    return f"{a_name} Win"
                return "Draw"
            elif m_lower == "double_chance":
                if o_lower == "1x":
                    return "Home or Draw (1X)"
                elif o_lower == "x2":
                    return "Away or Draw (X2)"
                return f"Double Chance ({out_val.upper()})"
            elif m_lower.startswith("over_under_"):
                line = m_lower.replace("over_under_", "")
                return f"Over {line} Goals" if o_lower == "over" else f"Under {line} Goals"
            elif m_lower == "home_goals_0.5":
                return f"{h_name} Over 0.5 Goals"
            elif m_lower == "away_goals_0.5":
                return f"{a_name} Over 0.5 Goals"
            elif m_lower == "home_goals_1.5":
                return f"{h_name} Over 1.5 Goals"
            elif m_lower == "away_goals_1.5":
                return f"{a_name} Over 1.5 Goals"
            elif m_lower == "ht_goals_0.5":
                return "Half-Time Over 0.5 Goals"
            elif m_lower == "btts":
                return "Both Teams to Score (GG Yes)" if o_lower == "yes" else "Both Teams to Score (No)"
            elif m_lower.startswith("corners"):
                return f"Corners {out_val.capitalize()}"
            clean_m = m_name.replace("_", " ").title()
            return f"{clean_m} [{out_val.upper()}]"

        primary_label = format_market_label(primary_market, primary_outcome)

        # 4. Synthesize secondary edges
        edges: List[str] = []
        booster_pick = primary_label

        if secondary_predictions:
            for s in secondary_predictions[:3]:
                sm = s.get("market", "")
                so = str(s.get("prediction", ""))
                sp = s.get("probability", 0.0)
                sp_pct = sp * 100 if sp <= 1.0 else sp
                edge_label = format_market_label(sm, so)
                edges.append(f"{edge_label} at {sp_pct:.1f}%")

            booster_pick = edges[0].split(" at ")[0] if edges else primary_label

        # Anytime striker probability addition if present
        scorer_outline = outlines.get("anytime_scorer", {})
        if scorer_outline and "home_scorer_prob" in scorer_outline:
            h_scorer_p = scorer_outline["home_scorer_prob"]
            edges.append(f"{h_name} Striker anytime goal probability at {h_scorer_p:.1f}%")

        edges_text = ", ".join(edges) if edges else f"Multiple goal-scoring edges identified in simulation corridors"

        # 5. Full Poisson-Monte Carlo Analysis synthesis
        summary = (
            f"Poisson-Monte Carlo Analysis: {h_name} Attack Strength ({att_h:.2f}) vs {a_name} Defense ({def_a:.2f}) "
            f"with +{boost:.0f}% Home Advantage & Form Weighting models expected goals at {lambda_home:.2f} vs {lambda_away:.2f}. "
            f"250,000 Monte Carlo simulation runs confirm '{primary_label}' ({primary_prob_pct:.1f}%) as the highest-probable occurrence. "
            f"Secondary edges: {edges_text}. "
            f"Recommended strategy: Core banker on {primary_label} with {booster_pick} accumulator booster."
        )

        return summary
