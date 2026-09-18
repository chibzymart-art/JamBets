"""
JamBets — Universal Match Motivation & Stakes Matrix (Phase 5)
Calculates real tactical match purpose, competition phase, rivalry intensity,
relegation desperation, and tournament leg game-management incentives.
Applies auditable modifiers to goal and set-piece rates.
"""

from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field

# High-Intensity Rivalry Derbies (Elevated tactical friction, heightened booking & set-piece rates)
HISTORICAL_DERBIES = {
    frozenset(["arsenal", "tottenham-hotspur"]): "NORTH_LONDON_DERBY",
    frozenset(["liverpool", "everton"]): "MERSEYSIDE_DERBY",
    frozenset(["manchester-united", "manchester-city"]): "MANCHESTER_DERBY",
    frozenset(["real-madrid", "barcelona"]): "EL_CLASICO",
    frozenset(["real-madrid", "atletico-madrid"]): "MADRID_DERBY",
    frozenset(["inter-milan", "ac-milan"]): "DERBY_DELLA_MADONNINA",
    frozenset(["juventus", "inter-milan"]): "DERBY_D_ITALIA",
    frozenset(["as-roma", "lazio"]): "DERBY_DELLA_CAPITALE",
    frozenset(["bayern-munich", "borussia-dortmund"]): "DER_KLASSIKER",
    frozenset(["celtic", "rangers"]): "OLD_FIRM_DERBY",
    frozenset(["fenerbahce", "galatasaray"]): "INTERCONTINENTAL_DERBY",
    frozenset(["psg", "marseille"]): "LE_CLASSIQUE",
    frozenset(["boca-juniors", "river-plate"]): "SUPERCLASICO",
    frozenset(["benfica", "sporting-cp"]): "DERBY_DE_LISBOA"
}


class MatchMotivationAssessment(BaseModel):
    """Auditable output of the Match Motivation & Stakes Engine."""
    match_purpose_tag: str = "BALANCED_COMPETITIVE"
    is_derby: bool = False
    is_knockout: bool = False
    knockout_leg: Optional[int] = None
    
    # Parametric multipliers
    lambda_home_mod: float = 1.00
    lambda_away_mod: float = 1.00
    tempo_mod: float = 1.00
    draw_mod: float = 1.00
    corner_mod: float = 1.00
    
    tactical_rationale: str = "Standard league competitive fixture."


class MatchMotivationEngine:
    """
    Evaluates competitive intent and psychological context for any match.
    """

    @classmethod
    def evaluate(
        cls,
        home_slug: str,
        away_slug: str,
        league_code: str,
        competition_stage: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> MatchMotivationAssessment:
        meta = metadata or {}
        h = home_slug.lower().strip()
        a = away_slug.lower().strip()
        stage = (competition_stage or meta.get("stage") or "").lower()

        # 1. Rivalry / Derby Check
        pair = frozenset([h, a])
        derby_name = HISTORICAL_DERBIES.get(pair)
        if derby_name:
            return MatchMotivationAssessment(
                match_purpose_tag="FIERCE_RIVALRY_DERBY",
                is_derby=True,
                lambda_home_mod=0.96,
                lambda_away_mod=0.96,
                tempo_mod=1.05,
                draw_mod=1.12,  # Cagey derbies see higher draw rates
                corner_mod=1.10,  # High desperate clearance and block volume
                tactical_rationale=f"High-friction {derby_name.replace('_', ' ').title()}: elevated competitive tension and defensive duels."
            )

        # 2. Tournament Knockout Context
        is_cup = any(c in league_code.upper() for c in ["_CL", "_EL", "_ECL", "CUP"]) or "cup" in stage or "knockout" in stage
        leg = meta.get("leg") or (1 if "1st leg" in stage else (2 if "2nd leg" in stage else None))

        if is_cup:
            if leg == 1:
                return MatchMotivationAssessment(
                    match_purpose_tag="CUP_TIE_LEG_1",
                    is_knockout=True,
                    knockout_leg=1,
                    lambda_home_mod=0.94,
                    lambda_away_mod=0.88,  # Away side prioritizes defensive containment
                    tempo_mod=0.92,
                    draw_mod=1.15,
                    corner_mod=0.95,
                    tactical_rationale="1st-leg cup knockout: away side maintains compact low-risk shape to protect the return leg."
                )
            elif leg == 2:
                agg_diff = meta.get("aggregate_goal_diff", 0)
                if abs(agg_diff) in (1, 2):
                    return MatchMotivationAssessment(
                        match_purpose_tag="CUP_TIE_LEG_2_CHASE",
                        is_knockout=True,
                        knockout_leg=2,
                        lambda_home_mod=1.12,
                        lambda_away_mod=1.12,
                        tempo_mod=1.15,
                        draw_mod=0.85,  # Chasing team must risk everything
                        corner_mod=1.15,  # Relentless late-game siege
                        tactical_rationale="2nd-leg knockout deficit: trailing side forced into aggressive high-line transition overcommitment."
                    )
                elif abs(agg_diff) >= 3:
                    return MatchMotivationAssessment(
                        match_purpose_tag="CUP_DEAD_RUBBER",
                        is_knockout=True,
                        knockout_leg=2,
                        lambda_home_mod=0.90,
                        lambda_away_mod=0.90,
                        tempo_mod=0.88,
                        draw_mod=1.10,
                        corner_mod=0.90,
                        tactical_rationale="Large aggregate knockout margin induces rotation and tempo preservation."
                    )

        # 3. Standard competitive league match
        return MatchMotivationAssessment(
            match_purpose_tag="BALANCED_LEAGUE_CONTEST",
            is_derby=False,
            is_knockout=False,
            lambda_home_mod=1.00,
            lambda_away_mod=1.00,
            tempo_mod=1.00,
            draw_mod=1.00,
            corner_mod=1.00,
            tactical_rationale="Regular season competitive league fixture with full table motivation."
        )
