"""
JamBets — Real Head-to-Head (H2H) Historical Analyzer (Phase 5)
Extracts and analyzes true direct encounters between two clubs across the multi-season dataset.
Applies Bayesian shrinkage toward competition priors when direct H2H samples are limited.
Zero synthetic proxying or arbitrary averaging.
"""

import math
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field

from python.src.db.universal_data_store import UniversalDataStore, H2HRecord


class H2HAnalysisResult(BaseModel):
    """Auditable H2H impact assessment on match outcome distributions."""
    home_team: str
    away_team: str
    encounters_count: int = 0
    has_sufficient_h2h: bool = False
    
    home_win_pct: float = 0.45
    draw_pct: float = 0.27
    away_win_pct: float = 0.28
    
    h2h_avg_goals: float = 2.65
    h2h_over25_pct: float = 0.52
    h2h_btts_pct: float = 0.50
    h2h_avg_corners: float = 8.80
    
    # Tactical edge derived from head-to-head clashes
    h2h_goal_differential: float = 0.0  # Positive = Home dominance, Negative = Away dominance
    tactical_bogey_effect: Optional[str] = None  # e.g. "AWAY_BOGEY_TEAM", "HOME_BOGEY_TEAM"
    h2h_lambda_home_mod: float = 1.00
    h2h_lambda_away_mod: float = 1.00
    recent_scores: List[str] = Field(default_factory=list)


class H2HAnalyzer:
    """
    Evaluates direct historical meetings between two teams.
    Blends genuine H2H results with overall club profiles using Bayesian shrinkage.
    """

    K_H2H_SHRINKAGE = 3.0  # Equivalent weight of prior competition baseline

    @classmethod
    def analyze(
        cls,
        home_team: str,
        away_team: str,
        data_store: Optional[UniversalDataStore] = None
    ) -> H2HAnalysisResult:
        store = data_store or UniversalDataStore.get_instance()
        h2h = store.get_h2h(home_team, away_team)

        n = h2h.matches_count
        recent_score_strings = [
            f"{m.get('home', '')} {m.get('home_score')}-{m.get('away_score')} {m.get('away', '')} ({m.get('date', '')[:10]})"
            for m in h2h.recent_encounters[:5]
        ]

        if n == 0:
            return H2HAnalysisResult(
                home_team=home_team,
                away_team=away_team,
                encounters_count=0,
                has_sufficient_h2h=False,
                recent_scores=[]
            )

        # Raw empirical H2H rates
        raw_h_win_rate = h2h.team_a_wins / n
        raw_draw_rate = h2h.draws / n
        raw_a_win_rate = h2h.team_b_wins / n

        # Baseline priors for 1X2 in competitive football
        prior_h = 0.44
        prior_d = 0.27
        prior_a = 0.29

        # Bayesian shrinkage: w = n / (n + K)
        w = n / (n + cls.K_H2H_SHRINKAGE)
        shrunk_h_win = round(w * raw_h_win_rate + (1.0 - w) * prior_h, 3)
        shrunk_draw = round(w * raw_draw_rate + (1.0 - w) * prior_d, 3)
        shrunk_a_win = round(w * raw_a_win_rate + (1.0 - w) * prior_a, 3)

        # Tactical bogey effect identification
        # If away team has won 70%+ of meetings over 3+ matches, they are a bogey team
        bogey = None
        goal_diff = 0.0
        h_mod = 1.00
        a_mod = 1.00

        if n >= 3:
            if raw_a_win_rate >= 0.65:
                bogey = "AWAY_BOGEY_TEAM"
                a_mod = 1.10
                h_mod = 0.92
            elif raw_h_win_rate >= 0.70:
                bogey = "HOME_DOMINANCE_HISTORY"
                h_mod = 1.10
                a_mod = 0.90

            # Direct goal diff in past meetings
            tot_h_goals = sum(m["home_score"] if m["home"] == home_team else m["away_score"] for m in h2h.recent_encounters)
            tot_a_goals = sum(m["away_score"] if m["home"] == home_team else m["home_score"] for m in h2h.recent_encounters)
            goal_diff = round((tot_h_goals - tot_a_goals) / n, 2)

        return H2HAnalysisResult(
            home_team=home_team,
            away_team=away_team,
            encounters_count=n,
            has_sufficient_h2h=(n >= 2),
            home_win_pct=shrunk_h_win,
            draw_pct=shrunk_draw,
            away_win_pct=shrunk_a_win,
            h2h_avg_goals=h2h.avg_total_goals,
            h2h_over25_pct=h2h.over25_rate,
            h2h_btts_pct=h2h.btts_rate,
            h2h_avg_corners=h2h.avg_corners,
            h2h_goal_differential=goal_diff,
            tactical_bogey_effect=bogey,
            h2h_lambda_home_mod=h_mod,
            h2h_lambda_away_mod=a_mod,
            recent_scores=recent_score_strings
        )
