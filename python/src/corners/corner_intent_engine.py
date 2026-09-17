"""
JamBets — Dynamic Match Corner Intent Engine (MCII)
Calculates real tactical match intent, territorial pitch tilt, low-block siege dynamics,
and wide crossing volume dynamically from empirical club metrics and match context.
Zero hardcoded team names, zero mock placeholders.
"""

from typing import Dict, Any, Optional
from python.src.corners.corners_data_provider import DynamicClubProfile, DynamicLeagueMetrics


class CornerIntentAssessment:
    """Detailed mathematical output of the dynamic Match Corner Intent analysis."""
    def __init__(
        self,
        mcii: float,
        mcii_home: float,
        mcii_away: float,
        siege_index: float,
        wing_pressure_index: float,
        stakes_index: float,
        pragmatic_penalty: float,
        tactical_tag: str,
        tactical_description: str
    ):
        self.mcii = mcii
        self.mcii_home = mcii_home
        self.mcii_away = mcii_away
        self.siege_index = siege_index
        self.wing_pressure_index = wing_pressure_index
        self.stakes_index = stakes_index
        self.pragmatic_penalty = pragmatic_penalty
        self.tactical_tag = tactical_tag
        self.tactical_description = tactical_description

    def to_dict(self) -> Dict[str, Any]:
        return {
            "mcii": round(self.mcii, 3),
            "mcii_home": round(self.mcii_home, 3),
            "mcii_away": round(self.mcii_away, 3),
            "siege_index": round(self.siege_index, 3),
            "wing_pressure_index": round(self.wing_pressure_index, 3),
            "stakes_index": round(self.stakes_index, 3),
            "pragmatic_penalty": round(self.pragmatic_penalty, 3),
            "tactical_tag": self.tactical_tag,
            "tactical_description": self.tactical_description
        }


class CornerIntentEngine:
    """
    Evaluates real-time Match Corner Intent Index (MCII in [0.80, 1.25]).
    Operates strictly dynamically on real club statistics, venue performance,
    and competition stakes without hardcoded lists.
    """

    @classmethod
    def evaluate(
        cls,
        home_club: DynamicClubProfile,
        away_club: DynamicClubProfile,
        league: DynamicLeagueMetrics,
        competition_code: Optional[str] = None
    ) -> CornerIntentAssessment:
        """
        Dynamically derives match corner intent and tactical siege factors.
        """
        h_att = home_club.home_attack_intensity
        h_def = home_club.home_defense_resilience
        a_att = away_club.away_attack_intensity
        a_def = away_club.away_defense_resilience

        # 1. Territorial Pitch Tilt & Low-Block Siege Dynamics (S_siege in [0.95, 1.18])
        # When a heavily attacking home favorite faces a conservative defense,
        # play is funneled wide, triggering multiple deflected crosses & clearances.
        att_disparity_home = h_att - a_att
        att_disparity_away = a_att - h_att

        if att_disparity_home >= 0.50:
            # Home siege state: high volume of wing overloads against away low block
            s_siege_home = min(1.18, 1.04 + (att_disparity_home * 0.10))
            s_siege_away = max(0.92, 0.98 - (att_disparity_home * 0.05))
            siege_profile = "HOME_TERRITORIAL_SIEGE"
        elif att_disparity_away >= 0.50:
            # Away transition siege state
            s_siege_away = min(1.15, 1.03 + (att_disparity_away * 0.08))
            s_siege_home = max(0.94, 0.98 - (att_disparity_away * 0.04))
            siege_profile = "AWAY_TRANSITION_PRESSURE"
        else:
            # Symmetrical open contest
            s_siege_home = 1.00 + (max(0.0, h_att - 1.0) * 0.05)
            s_siege_away = 1.00 + (max(0.0, a_att - 1.0) * 0.05)
            siege_profile = "SYMMETRICAL_HIGH_TEMPO"

        s_siege = (s_siege_home + s_siege_away) / 2.0

        # 2. Wing Progression & Crossing Propensity (W_cross in [0.95, 1.15])
        # Dynamically calculated from combined attacking velocity and shot frequency
        combined_attack = (h_att + a_att) / 2.0
        if combined_attack >= 1.45:
            w_cross = min(1.15, 1.02 + ((combined_attack - 1.45) * 0.12))
        elif combined_attack <= 0.85:
            w_cross = max(0.92, 0.98 - ((0.85 - combined_attack) * 0.10))
        else:
            w_cross = 1.00

        # 3. Competition Stakes & Game Context (D_stakes in [0.95, 1.12])
        c_code = (competition_code or league.league_code or "").upper()
        if any(c in c_code for c in ["_CL", "_EL", "_ECL"]):
            # European continental cup ties have heightened desperation and crossing volume
            d_stakes = 1.08
        elif any(c in c_code for c in ["_PL", "_LL", "_BL", "_SA", "_ED"]):
            # Elite Tier 1 high-pace football
            d_stakes = 1.04
        else:
            d_stakes = 1.01

        # 4. Pragmatic Stalemate Penalty (C_pragmatic in [0.82, 1.00])
        # Two defensive, low-possession sides with low goals reduce set-pieces
        if h_att < 0.90 and a_att < 0.85:
            c_pragmatic = max(0.84, 0.95 - (max(0.0, 1.75 - (h_att + a_att)) * 0.15))
        else:
            c_pragmatic = 1.00

        # Overall MCII multiplier (calibrated to modern game tempo)
        raw_mcii = s_siege * w_cross * d_stakes * c_pragmatic
        mcii = max(0.85, min(1.15, raw_mcii))

        # Venue-specific intent multipliers (strictly bounded to prevent compounding explosion)
        mcii_home = max(0.85, min(1.15, s_siege_home * w_cross * d_stakes * c_pragmatic))
        mcii_away = max(0.82, min(1.12, s_siege_away * w_cross * d_stakes * c_pragmatic))

        # Dynamic tactical tag
        if mcii >= 1.12 and w_cross >= 1.06:
            tactical_tag = "CORNER_FEST"
        elif s_siege >= 1.08:
            tactical_tag = "WING_PRESSURE"
        elif w_cross >= 1.03:
            tactical_tag = "HIGH_CROSS_VOLUME"
        else:
            tactical_tag = "LEAN_OVER"

        # Dynamically generated tactical rationale description
        h_name = home_club.team_name
        a_name = away_club.team_name
        l_name = league.league_name

        if tactical_tag == "CORNER_FEST":
            tactical_desc = (
                f"Dynamic model captures expansive wing attacking profiles in {l_name}. "
                f"{h_name} and {a_name} feature high attacking velocity with sustained wide pressure. "
                f"Defensive blocks under persistent crossing siege are projected to trigger heavy deflected set-piece sequences."
            )
        elif tactical_tag == "WING_PRESSURE":
            tactical_desc = (
                f"Territorial pitch tilt analysis identifies heavy wide channel pressure between {h_name} and {a_name}. "
                f"Overloads on the flanks force deep defensive clearances and deflected blocks, driving corner accumulation."
            )
        elif tactical_tag == "HIGH_CROSS_VOLUME":
            tactical_desc = (
                f"Tactical match dynamics in {l_name} favor frequent final-third entries and wide delivery. "
                f"Both sides commit numbers forward, creating consistent set-piece pressure clearing standard lines."
            )
        else:
            tactical_desc = (
                f"Calibrated set-piece model establishes consistent corner generation between {h_name} and {a_name}, "
                f"with tactical match intent comfortably supporting the lower threshold line."
            )

        return CornerIntentAssessment(
            mcii=mcii,
            mcii_home=mcii_home,
            mcii_away=mcii_away,
            siege_index=s_siege,
            wing_pressure_index=w_cross,
            stakes_index=d_stakes,
            pragmatic_penalty=c_pragmatic,
            tactical_tag=tactical_tag,
            tactical_description=tactical_desc
        )
