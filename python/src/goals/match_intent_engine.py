"""
JamBets — Match Intent & Contextual Stakes Engine
Evaluates motivational dynamics, competition stages, two-legged ties,
style clashes, and game-management incentives.
Calculates the Match Intent Index (MII) [0.78, 1.22].
"""

import os
import sys
from typing import Dict, Any, Optional
from pydantic import BaseModel

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))


class MatchIntentOutput(BaseModel):
    """Auditable output of the Match Intent Engine."""
    match_intent_index: float  # [0.78, 1.22]
    intent_classification: str
    is_favorable_for_over: bool
    draw_collusion_risk: bool
    clean_sheet_suppression: bool
    intent_rationale: str
    lambda_modifier: float


# Curated Archetypes for Known European Clubs (Managerial & System Posture)
PRAGMATIC_DEFENSIVE_CLUBS = {
    "torino", "as-roma", "roma", "juventus", "atletico-madrid",
    "getafe", "mallorca", "empoli", "verona", "everton", "crystal-palace",
    "udinese", "cadiz", "osasuna", "alaves"
}

HIGH_PRESS_TRANSITION_CLUBS = {
    "liverpool", "bayern-munich", "barcelona", "atalanta", "manchester-city",
    "tottenham-hotspur", "bayer-leverkusen", "psg", "monaco", "eintracht-frankfurt",
    "borussia-dortmund", "feyenoord", "psv-eindhoven", "sporting-cp", "rb-leipzig"
}


class MatchIntentEngine:
    """
    Evaluates competitive intent and context to prevent false Over 2.5
    predictions in tactically conservative or dead-rubber matchups.
    """

    @classmethod
    def evaluate_intent(
        cls,
        home_team: str,
        away_team: str,
        league_code: str,
        league_name: str = "",
        competition_stage: Optional[str] = None,
        home_clean_sheet_pct: float = 0.0,
        away_clean_sheet_pct: float = 0.0,
        home_scoring_rate: float = 1.40,
        away_scoring_rate: float = 1.10,
        metadata: Optional[Dict[str, Any]] = None
    ) -> MatchIntentOutput:
        """
        Calculates Match Intent Index (MII) based on:
        1. Competition stage & leg context
        2. Managerial style clash (Low-Block vs High-Press)
        3. Clean sheet frequency & defensive resilience
        4. Dual attacking intent floor
        """
        meta = metadata or {}
        h_slug = home_team.lower().strip().replace(" ", "-")
        a_slug = away_team.lower().strip().replace(" ", "-")
        stage = (competition_stage or meta.get("stage") or "").lower()

        mii = 1.00
        rationale_bits = []
        is_gridlock = False
        draw_collusion = False
        cs_suppression = False

        # --- 1. Knockout / Leg Stakes Evaluation ---
        is_cup = any(c in league_code for c in ["EUR_CL", "EUR_EL", "EUR_ECL", "CUP"]) or "cup" in (league_name or "").lower()
        leg = meta.get("leg") or (1 if "1st leg" in stage else (2 if "2nd leg" in stage else None))

        if is_cup and leg == 1:
            # 1st leg cup ties: away team containment, risk aversion
            mii *= 0.90
            rationale_bits.append("1st-leg cup tie produces defensive risk-minimization posture.")
        elif is_cup and leg == 2:
            agg_diff = meta.get("aggregate_goal_diff", 0)
            if abs(agg_diff) in (1, 2):
                # 2nd leg trailing by 1-2 goals: chasing team must overcommit
                mii *= 1.14
                rationale_bits.append("2nd-leg knockout deficit forces trailing side into aggressive high-line overcommitment.")
            elif abs(agg_diff) >= 3:
                # 2nd leg blowout: dead rubber game management
                mii *= 0.86
                rationale_bits.append("Large aggregate lead triggers game-management tempo and rotation.")

        # --- 2. Managerial Style & Tactical Archetype Clash ---
        h_is_pragmatic = any(p in h_slug for p in PRAGMATIC_DEFENSIVE_CLUBS)
        a_is_pragmatic = any(p in a_slug for p in PRAGMATIC_DEFENSIVE_CLUBS)
        h_is_high_tempo = any(t in h_slug for t in HIGH_PRESS_TRANSITION_CLUBS)
        a_is_high_tempo = any(t in a_slug for t in HIGH_PRESS_TRANSITION_CLUBS)

        if h_is_pragmatic and a_is_pragmatic:
            # Dual low-block clash (e.g. Torino vs Roma, Getafe vs Mallorca)
            mii *= 0.84
            is_gridlock = True
            rationale_bits.append("Dual pragmatic mid-block clash restricts central penetration and reduces goal expectancy.")
        elif h_is_high_tempo and a_is_high_tempo:
            # Dual aggressive transition clash (e.g. Atalanta vs Leverkusen)
            mii *= 1.15
            rationale_bits.append("Mutual high-pressing transition systems amplify turnover volume in scoring zones.")
        elif (h_is_pragmatic and a_is_high_tempo) or (h_is_high_tempo and a_is_pragmatic):
            # Asymmetric clash (dominant attack vs disciplined low block)
            # Caution: often ends 1-0 or 2-0 if underdog parks bus effectively
            if min(home_scoring_rate, away_scoring_rate) < 0.90:
                mii *= 0.92
                rationale_bits.append("Asymmetric clash with low-scoring underdog increases blowout reliance risk.")

        # --- 3. Defensive Clean Sheet Suppression Penalty ---
        # If both teams are solid defensively, discount Over 2.5
        if home_clean_sheet_pct >= 0.40 or away_clean_sheet_pct >= 0.35:
            cs_suppression = True
            mii *= 0.92
            rationale_bits.append(f"High clean-sheet resilience (Home: {home_clean_sheet_pct*100:.0f}%, Away: {away_clean_sheet_pct*100:.0f}%) discounts total goals.")

        # --- 4. Bound MII within Safe Institutional Limits [0.78, 1.22] ---
        mii = round(max(0.78, min(1.22, mii)), 4)

        # Classification
        if mii >= 1.12:
            classification = "ALL_OUT_ATTACK_HIGH_TEMPO"
        elif mii >= 1.05:
            classification = "MUTUAL_OPEN_TRANSITION"
        elif mii <= 0.88:
            classification = "TACTICAL_GRIDLOCK_PRAGMATISM"
        elif mii <= 0.95:
            classification = "MEASURED_DEFENSIVE_CAUTION"
        else:
            classification = "BALANCED_REGULAR_SEASON"

        final_rationale = " ".join(rationale_bits) if rationale_bits else "Standard regular season competitive balance."

        return MatchIntentOutput(
            match_intent_index=mii,
            intent_classification=classification,
            is_favorable_for_over=(mii >= 1.00 and not is_gridlock),
            draw_collusion_risk=draw_collusion,
            clean_sheet_suppression=cs_suppression,
            intent_rationale=final_rationale,
            lambda_modifier=round(mii ** 0.5, 4)
        )
