"""
JamBets — First-Half Match Intent & Tactical Tempo Engine
Evaluates team motivational psychology, tactical urgency, and early pressing dynamics
specifically for the first 45 minutes of football matches.
"""

import re
from typing import Dict, Any, Optional
from pydantic import BaseModel, Field


class FirstHalfMatchIntent(BaseModel):
    first_half_intent_index: float = Field(..., ge=0.70, le=1.30)
    early_strike_tempo: str  # BLITZ_HIGH_PRESS, BALANCED_OPENING, PRAGMATIC_FEELING_OUT, KNOCKOUT_CAUTION
    intent_classification: str
    intent_rationale: str
    is_favorable_for_ht05: bool
    lambda_ht_modifier: float = Field(..., ge=0.70, le=1.30)


class FirstHalfIntentEngine:
    """
    Evaluates first-half tactical posture, risk tolerance, and early goal urgency.
    """

    DERBY_KEYWORDS = [
        "derby", "clasico", "clásico", "rivalry", "de klassieker", "old firm",
        "derby della madonnina", "derby d'italia", "north london"
    ]

    @classmethod
    def evaluate_first_half_intent(
        cls,
        home_team: str,
        away_team: str,
        league_code: str,
        league_name: str,
        competition_stage: Optional[str] = None,
        home_scoring_rate: float = 1.4,
        away_scoring_rate: float = 1.1,
        home_clean_sheet_pct: float = 0.25,
        away_clean_sheet_pct: float = 0.25,
        metadata: Optional[Dict[str, Any]] = None
    ) -> FirstHalfMatchIntent:
        """
        Determines the First-Half Match Intent Index (FHTI) and tactical urgency.
        """
        meta = metadata or {}
        comp_str = f"{league_name} {competition_stage or ''} {meta.get('round', '')}".lower()
        match_str = f"{home_team} {away_team}".lower()

        is_cup = any(k in comp_str for k in ["cup", "copa", "pokal", "coupe", "knvb", "fa cup", "efl"])
        is_knockout = any(k in comp_str for k in ["semi", "quarter", "final", "playoff", "knockout", "round of"])
        is_first_leg = any(k in comp_str for k in ["1st leg", "first leg", "leg 1"])
        is_second_leg = any(k in comp_str for k in ["2nd leg", "second leg", "leg 2"])
        is_derby = any(k in match_str or k in comp_str for k in cls.DERBY_KEYWORDS)

        # Baseline index
        fhti = 1.00
        classification = "STANDARD_REGULAR_SEASON"
        tempo = "BALANCED_OPENING"
        rationale = "Standard competitive opening 45 minutes with balanced early tempo."

        # Scenario 1: Two-legged tie first leg (Risk-averse opening half)
        if is_first_leg or ((is_cup or is_knockout) and "1st leg" in comp_str):
            fhti = 0.84
            tempo = "KNOCKOUT_CAUTION"
            classification = "CUP_FIRST_LEG_CAGEYNESS"
            rationale = (
                f"Two-legged knockout first leg. Both {home_team} and {away_team} prioritize structural "
                "risk management in the opening 45 minutes to avoid chasing an aggregate deficit."
            )

        # Scenario 2: Two-legged tie second leg (Urgent attacking from minute 1)
        elif is_second_leg or ((is_cup or is_knockout) and "2nd leg" in comp_str):
            fhti = 1.18
            tempo = "BLITZ_HIGH_PRESS"
            classification = "CUP_DECIDER_MAX_URGENCY"
            rationale = (
                f"Decisive second leg tie. Elimination stakes force immediate verticality and aggressive "
                "early transition play, significantly accelerating first-half goal probability."
            )

        # Scenario 3: High-Tension Local Derby (Early tactical feeling out)
        elif is_derby:
            fhti = 0.88
            tempo = "PRAGMATIC_FEELING_OUT"
            classification = "RIVALRY_EARLY_PRAGMATISM"
            rationale = (
                f"High-friction derby matchup. Historical data indicates conservative early game management, "
                "elevated midfield physical fouls, and low risk-taking before the interval."
            )

        # Scenario 4: High-Scoring Offensive Clash (High Press Blitz)
        elif (home_scoring_rate >= 1.80 and away_scoring_rate >= 1.40) or (home_clean_sheet_pct <= 0.15 and away_clean_sheet_pct <= 0.15):
            fhti = 1.15
            tempo = "BLITZ_HIGH_PRESS"
            classification = "EARLY_TEMPO_TRANSITION_BLITZ"
            rationale = (
                f"Both {home_team} and {away_team} exhibit aggressive forward transition velocity with porous defensive "
                "structures. High early-pressing intensity creates prime conditions for a strike before minute 30."
            )

        # Scenario 5: Defensive Low-Block Stalemate
        elif home_clean_sheet_pct >= 0.45 and away_clean_sheet_pct >= 0.45:
            fhti = 0.82
            tempo = "PRAGMATIC_FEELING_OUT"
            classification = "LOW_BLOCK_EARLY_STALEMATE"
            rationale = (
                f"Both sides operate deep, structured defensive lines with high first-half clean-sheet rates. "
                "Scoring opportunities in the opening 45 minutes are heavily compressed."
            )

        # Scenario 6: Juggernaut Home Favorite (One-Sided Early Siege)
        elif home_scoring_rate >= 2.20 and away_scoring_rate <= 0.90:
            fhti = 1.12
            tempo = "BLITZ_HIGH_PRESS"
            classification = "HOME_JUGGERNAUT_EARLY_SIEGE"
            rationale = (
                f"{home_team} commands overwhelming territorial dominance and sustained early attacking pressure, "
                "driving high first-half goal expectation regardless of opponent counter threat."
            )

        fhti = round(max(0.75, min(1.25, fhti)), 2)
        is_favorable = fhti >= 0.95 and tempo != "LOW_BLOCK_EARLY_STALEMATE"

        return FirstHalfMatchIntent(
            first_half_intent_index=fhti,
            early_strike_tempo=tempo,
            intent_classification=classification,
            intent_rationale=rationale,
            is_favorable_for_ht05=is_favorable,
            lambda_ht_modifier=fhti
        )
