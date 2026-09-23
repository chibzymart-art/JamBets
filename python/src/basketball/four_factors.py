"""
Oddsbanta — Dean Oliver Four Factors & Pace Adjustment Model
Phase 3: Quantitative Modeling & Matchup Efficiency Engine

Core Principles:
1. Basketball is possession-anchored: Score = Possessions * Efficiency.
2. Dean Oliver's Four Factors:
   - Shooting: eFG% (40% weight)
   - Turnovers: TOV% (25% weight)
   - Rebounding: ORB% (20% weight)
   - Free Throws: FTR (15% weight)
3. Opponent-adjusted Offensive/Defensive ratings (per 100 possessions).
4. Rest, Back-to-Back (B2B), and Altitude venue adjustments.

Invariant: Isolated basketball mathematical domain. Zero football dependencies.
"""

from dataclasses import dataclass
from typing import Dict, Any, Tuple, Optional
from python.src.basketball.config import LEAGUE_REGISTRY, ALTITUDE_VENUES, FATIGUE_MODIFIERS
from python.src.basketball.models import BasketballFourFactors


@dataclass
class MatchupExpectation:
    expected_pace: float
    home_adj_ortg: float
    away_adj_ortg: float
    home_expected_score: float
    away_expected_score: float
    expected_total: float
    expected_margin: float  # home - away
    four_factors_diff: Dict[str, float]
    hca_applied: float
    fatigue_applied_home: float
    fatigue_applied_away: float


class FourFactorsModel:
    """
    Evaluates basketball matchup efficiency, expected pace, and projected scoring.
    """

    # Dean Oliver Standard Factor Weights
    WEIGHT_EFG = 0.40
    WEIGHT_TOV = 0.25
    WEIGHT_ORB = 0.20
    WEIGHT_FTR = 0.15

    @classmethod
    def calculate_matchup_pace(
        cls,
        home_pace: float,
        away_pace: float,
        league_avg_pace: float = 99.5
    ) -> float:
        """
        Expected Possessions = (Home Pace * Away Pace) / League Avg Pace
        """
        if league_avg_pace <= 0:
            league_avg_pace = 99.5
        pace = (home_pace * away_pace) / league_avg_pace
        # Clamp to realistic basketball bounds (60 to 115 possessions)
        return max(60.0, min(115.0, pace))

    @classmethod
    def calculate_opponent_adjusted_ortg(
        cls,
        team_ortg: float,
        opponent_drtg: float,
        league_avg_ortg: float = 112.0
    ) -> float:
        """
        Adjusted ORtg = (Team ORtg * Opponent DRtg) / League Avg ORtg
        """
        if league_avg_ortg <= 0:
            league_avg_ortg = 112.0
        adj = (team_ortg * opponent_drtg) / league_avg_ortg
        # Clamp to realistic efficiency bounds (85.0 to 135.0 per 100 poss)
        return max(85.0, min(135.0, adj))

    @classmethod
    def compute_four_factors_net_advantage(
        cls,
        team_ff: BasketballFourFactors,
        opponent_ff: BasketballFourFactors
    ) -> float:
        """
        Computes weighted differential in Dean Oliver's 4 factors:
        eFG% diff (+), TOV% diff (lower is better, so opponent - team),
        ORB% diff (+), FTR diff (+).
        """
        efg_diff = team_ff.efg_pct - opponent_ff.efg_pct
        tov_diff = opponent_ff.tov_pct - team_ff.tov_pct  # higher is better for team
        orb_diff = team_ff.orb_pct - opponent_ff.orb_pct
        ftr_diff = team_ff.ftr - opponent_ff.ftr

        net_factor = (
            cls.WEIGHT_EFG * efg_diff
            + cls.WEIGHT_TOV * tov_diff
            + cls.WEIGHT_ORB * orb_diff
            + cls.WEIGHT_FTR * ftr_diff
        )
        return net_factor

    @classmethod
    def evaluate_matchup(
        cls,
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
        custom_hca: Optional[float] = None
    ) -> MatchupExpectation:
        """
        Calculates projected expected pace, scoring, margin, and Four Factors breakdown.
        """
        cfg = LEAGUE_REGISTRY.get(league_code.upper())
        league_pace = cfg.default_pace if cfg else 99.5
        league_ortg = cfg.avg_offensive_rating if cfg else 112.0
        base_hca = cfg.hca_points if cfg else 2.85

        # 1. Expected matchup pace
        matchup_pace = cls.calculate_matchup_pace(home_pace, away_pace, league_pace)

        # 2. Opponent-adjusted efficiency ratings
        home_adj_ortg = cls.calculate_opponent_adjusted_ortg(home_ortg, away_drtg, league_ortg)
        away_adj_ortg = cls.calculate_opponent_adjusted_ortg(away_ortg, home_drtg, league_ortg)

        # 3. Base points per possession
        home_base_pts = matchup_pace * (home_adj_ortg / 100.0)
        away_base_pts = matchup_pace * (away_adj_ortg / 100.0)

        # 4. Home Court Advantage (including altitude venue bonus)
        if custom_hca is not None:
            hca = custom_hca
        else:
            altitude_bonus = ALTITUDE_VENUES.get(home_team_name.lower(), 0.0)
            hca = altitude_bonus if altitude_bonus > 0 else base_hca

        # 5. Fatigue & Rest modifiers
        fatigue_home = 0.0
        fatigue_away = 0.0

        if is_home_b2b:
            fatigue_home += FATIGUE_MODIFIERS["B2B_PENALTY"]
        if is_away_b2b:
            fatigue_away += FATIGUE_MODIFIERS["B2B_PENALTY"]

        rest_diff = home_rest_days - away_rest_days
        capped_rest_bonus = max(
            -FATIGUE_MODIFIERS["MAX_REST_ADVANTAGE"],
            min(
                FATIGUE_MODIFIERS["MAX_REST_ADVANTAGE"],
                rest_diff * FATIGUE_MODIFIERS["REST_ADVANTAGE_PER_DAY"]
            )
        )
        if capped_rest_bonus > 0:
            fatigue_home += capped_rest_bonus
        else:
            fatigue_away += abs(capped_rest_bonus)

        # 6. Four Factors differential impact (translates to net score impact)
        ff_net = cls.compute_four_factors_net_advantage(home_ff, away_ff)
        ff_points_impact = ff_net * 40.0  # ~4.0 points per 10% net Four Factors edge

        # 7. Projected final expected scores
        home_expected = home_base_pts + (hca / 2.0) + fatigue_home + (ff_points_impact / 2.0)
        away_expected = away_base_pts - (hca / 2.0) + fatigue_away - (ff_points_impact / 2.0)

        # Safety clamps
        home_expected = max(50.0, home_expected)
        away_expected = max(50.0, away_expected)

        expected_total = home_expected + away_expected
        expected_margin = home_expected - away_expected

        ff_breakdown = {
            "efg_diff": round(home_ff.efg_pct - away_ff.efg_pct, 4),
            "tov_diff": round(away_ff.tov_pct - home_ff.tov_pct, 4),
            "orb_diff": round(home_ff.orb_pct - away_ff.orb_pct, 4),
            "ftr_diff": round(home_ff.ftr - away_ff.ftr, 4),
            "net_four_factors_advantage": round(ff_net, 4),
        }

        return MatchupExpectation(
            expected_pace=round(matchup_pace, 2),
            home_adj_ortg=round(home_adj_ortg, 2),
            away_adj_ortg=round(away_adj_ortg, 2),
            home_expected_score=round(home_expected, 1),
            away_expected_score=round(away_expected, 1),
            expected_total=round(expected_total, 1),
            expected_margin=round(expected_margin, 1),
            four_factors_diff=ff_breakdown,
            hca_applied=round(hca, 2),
            fatigue_applied_home=round(fatigue_home, 2),
            fatigue_applied_away=round(fatigue_away, 2),
        )
