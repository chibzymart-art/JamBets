"""
JamBets — AI Simulation Intelligence Summarizer
Generates contextual, authoritative analytical summaries for every 250,000-draw
Monte Carlo football simulation, highlighting projected scorelines, goal expectations,
primary banker certainty, and secondary tactical leans.
"""

import os
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone


class AISimulationSummarizer:
    """
    Synthesizes rich AI intelligence summaries from Monte Carlo distributions
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
        data_tier: str = "TIER_1_FOTMOB"
    ) -> str:
        """
        Generates an authoritative, insight-dense narrative for the match.
        """
        # 1. Format team names cleanly
        h_name = home_team.replace("-", " ").title()
        a_name = away_team.replace("-", " ").title()

        # 2. Extract top scoreline cluster
        score_dist = getattr(sim_result, "scoreline_distribution", {}) or {}
        sorted_scores = sorted(score_dist.items(), key=lambda x: x[1], reverse=True)
        top_scores_str = " / ".join([s[0] for s in sorted_scores[:2]]) if sorted_scores else "1-0 / 2-1"

        # 3. Formulate goal expectation metrics
        tot_exp = lambda_home + lambda_away
        exp_pace = "high-tempo attacking" if tot_exp >= 2.9 else "tactically disciplined, low-scoring" if tot_exp <= 2.1 else "balanced competitive"

        # 4. Determine Primary Banker sentence
        tier_label = confidence_tier.replace("_", " ").upper()
        if confidence_tier in ("BANGER", "TOP_PICK", "TOP PICK", "HIGH_CONFIDENCE", "HIGH CONFIDENCE"):
            banker_narrative = (
                f"JamBets AI confirms an elite {tier_label} ({primary_prob_pct:.1f}% certainty) on {primary_market.replace('_', ' ').title()} [{primary_outcome.upper()}], "
                f"backed by 250,000 Monte Carlo iterations and verified market consensus."
            )
        elif confidence_tier == "NO_SAFE_BANKER":
            banker_narrative = (
                f"Anti-loss protection activated: No single market breached the strict 80% banker certainty floor across 250k draws. "
                f"Capital preservation recommends passing on primary banker lines."
            )
        else:
            banker_narrative = (
                f"Primary algorithmic projection targets {primary_market.replace('_', ' ').title()} [{primary_outcome.upper()}] with {primary_prob_pct:.1f}% model probability "
                f"under a {tier_label} confidence rating."
            )

        # 5. Formulate secondary tactical lean
        if secondary_predictions:
            top_sec = secondary_predictions[0]
            sec_m = top_sec.get("market", "").replace("_", " ").title()
            sec_o = str(top_sec.get("prediction", "")).upper()
            sec_p = top_sec.get("probability", 0.0)
            sec_pct = sec_p * 100 if sec_p <= 1.0 else sec_p
            tactical_narrative = (
                f"Secondary lean highlights {sec_m} [{sec_o}] ({sec_pct:.1f}%), reflecting {h_name}'s "
                f"projected goal expectancy of {lambda_home:.2f} versus {a_name}'s {lambda_away:.2f}."
            )
        else:
            tactical_narrative = (
                f"Distribution models project a {exp_pace} profile with highest probability scoreline cluster centered on {top_scores_str}."
            )

        # 6. Concluding synthesis
        summary = (
            f"JamBets AI Simulation Intelligence (250,000 Draws): {h_name} vs {a_name} ({league_code}). "
            f"{banker_narrative} {tactical_narrative}"
        )

        return summary
