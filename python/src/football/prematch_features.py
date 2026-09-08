"""
JamBets — Pre-Match Feature Engineering Pipeline
Computes pre-match feature vectors strictly using historical data available
BEFORE the prediction cutoff timestamp (zero temporal data leakage).
Implements the Data Integrity Gate: flags NOT_READY if mandatory features are missing.
"""

import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field

from python.src.football.historical_dataset import HistoricalMatch, HistoricalDatasetBuilder


class PreMatchFeatures(BaseModel):
    """Immutable pre-match feature snapshot for a fixture."""
    fixture_id: Optional[str] = None
    canonical_key: str
    prediction_cutoff: datetime
    dataset_version: str = "v1.0.0"
    feature_version: str = "v1.0.0"
    home_team_canonical: str
    away_team_canonical: str
    league_code: str

    # Form metrics
    home_form_points_last5: float = 0.0
    away_form_points_last5: float = 0.0
    home_goals_scored_avg_last5: float = 0.0
    home_goals_conceded_avg_last5: float = 0.0
    away_goals_scored_avg_last5: float = 0.0
    away_goals_conceded_avg_last5: float = 0.0

    # Exponentially weighted form
    home_exp_weighted_goals_scored: float = 0.0
    home_exp_weighted_goals_conceded: float = 0.0
    away_exp_weighted_goals_scored: float = 0.0
    away_exp_weighted_goals_conceded: float = 0.0

    # Relative attacking/defensive strengths
    alpha_home_attack: float = 1.0
    beta_home_defense: float = 1.0
    alpha_away_attack: float = 1.0
    beta_away_defense: float = 1.0

    # Parametric goal parameters
    lambda_home: float = 1.45
    lambda_away: float = 1.15
    home_advantage: float = 1.25

    # Contextual rest
    home_rest_days: float = 7.0
    away_rest_days: float = 7.0

    # Integrity gate
    is_ready: bool = True
    not_ready_reason: Optional[str] = None
    historical_matches_used: int = 0
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PreMatchFeatureEngine:
    """
    Constructs pre-match feature snapshots with strict cutoff enforcement.
    """

    DECAY_HALF_LIFE_DAYS = 60.0  # Exponential decay half-life in days
    DEFAULT_LEAGUE_GOAL_AVG = 1.35  # Average goals per team per match

    def __init__(self, dataset: HistoricalDatasetBuilder):
        self.dataset = dataset
        self.decay_rate = math.log(2) / self.DECAY_HALF_LIFE_DAYS

    def compute_features(
        self,
        canonical_key: str,
        league_code: str,
        home_team_canonical: str,
        away_team_canonical: str,
        prediction_cutoff: datetime,
        fixture_id: Optional[str] = None,
    ) -> PreMatchFeatures:
        """
        Generates feature snapshot for a fixture.
        Enforces: match.scheduled_kickoff < prediction_cutoff (ZERO LEAKAGE).
        """
        if prediction_cutoff.tzinfo is None:
            prediction_cutoff = prediction_cutoff.replace(tzinfo=timezone.utc)

        # 1. Retrieve historical matches strictly before cutoff
        home_matches = self.dataset.get_team_matches(home_team_canonical, prediction_cutoff, limit=20)
        away_matches = self.dataset.get_team_matches(away_team_canonical, prediction_cutoff, limit=20)

        # DATA INTEGRITY GATE
        if len(home_matches) == 0 or len(away_matches) == 0:
            return PreMatchFeatures(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                prediction_cutoff=prediction_cutoff,
                home_team_canonical=home_team_canonical,
                away_team_canonical=away_team_canonical,
                league_code=league_code,
                is_ready=False,
                not_ready_reason=f"INSUFFICIENT_DATA (home_matches={len(home_matches)}, away_matches={len(away_matches)})",
                historical_matches_used=0
            )

        # 2. Form Calculation (Last 5 matches)
        home_last5 = home_matches[:5]
        away_last5 = away_matches[:5]

        home_points = 0.0
        home_scored = 0.0
        home_conceded = 0.0

        for m in home_last5:
            is_home = (m.home_team_canonical == home_team_canonical)
            team_scored = m.home_score if is_home else m.away_score
            team_conceded = m.away_score if is_home else m.home_score

            home_scored += team_scored
            home_conceded += team_conceded

            if team_scored > team_conceded:
                home_points += 3.0
            elif team_scored == team_conceded:
                home_points += 1.0

        away_points = 0.0
        away_scored = 0.0
        away_conceded = 0.0

        for m in away_last5:
            is_away = (m.away_team_canonical == away_team_canonical)
            team_scored = m.away_score if is_away else m.home_score
            team_conceded = m.home_score if is_away else m.away_score

            away_scored += team_scored
            away_conceded += team_conceded

            if team_scored > team_conceded:
                away_points += 3.0
            elif team_scored == team_conceded:
                away_points += 1.0

        h_count = max(1, len(home_last5))
        a_count = max(1, len(away_last5))

        # 3. Exponential Time Decay Weighting
        h_exp_scored = 0.0
        h_exp_conceded = 0.0
        h_weights_sum = 0.0

        for m in home_matches:
            days_ago = max(0.0, (prediction_cutoff - m.scheduled_kickoff).total_seconds() / 86400.0)
            weight = math.exp(-self.decay_rate * days_ago)
            is_home = (m.home_team_canonical == home_team_canonical)
            h_exp_scored += (m.home_score if is_home else m.away_score) * weight
            h_exp_conceded += (m.away_score if is_home else m.home_score) * weight
            h_weights_sum += weight

        a_exp_scored = 0.0
        a_exp_conceded = 0.0
        a_weights_sum = 0.0

        for m in away_matches:
            days_ago = max(0.0, (prediction_cutoff - m.scheduled_kickoff).total_seconds() / 86400.0)
            weight = math.exp(-self.decay_rate * days_ago)
            is_away = (m.away_team_canonical == away_team_canonical)
            a_exp_scored += (m.away_score if is_away else m.home_score) * weight
            a_exp_conceded += (m.home_score if is_away else m.away_score) * weight
            a_weights_sum += weight

        h_w_avg_scored = h_exp_scored / max(0.001, h_weights_sum)
        h_w_avg_conceded = h_exp_conceded / max(0.001, h_weights_sum)
        a_w_avg_scored = a_exp_scored / max(0.001, a_weights_sum)
        a_w_avg_conceded = a_exp_conceded / max(0.001, a_weights_sum)

        # 4. Relative Attack and Defense Strengths
        league_matches = self.dataset.get_league_matches(league_code, prediction_cutoff)
        if len(league_matches) > 10:
            league_h_goals = sum(m.home_score for m in league_matches) / len(league_matches)
            league_a_goals = sum(m.away_score for m in league_matches) / len(league_matches)
        else:
            league_h_goals = 1.45
            league_a_goals = 1.15

        league_avg = max(0.8, (league_h_goals + league_a_goals) / 2.0)
        home_advantage = min(1.45, max(1.10, league_h_goals / max(0.8, league_a_goals)))

        alpha_home = max(0.4, min(2.5, h_w_avg_scored / max(0.5, league_avg)))
        beta_home = max(0.4, min(2.5, h_w_avg_conceded / max(0.5, league_avg)))
        alpha_away = max(0.4, min(2.5, a_w_avg_scored / max(0.5, league_avg)))
        beta_away = max(0.4, min(2.5, a_w_avg_conceded / max(0.5, league_avg)))

        # 5. Expected Goals Parameters (lambda_home, lambda_away)
        lambda_h = alpha_home * beta_away * home_advantage * league_avg
        lambda_a = alpha_away * beta_home * (1.0 / home_advantage) * league_avg

        # Bound check for stability
        lambda_h = max(0.2, min(4.5, lambda_h))
        lambda_a = max(0.2, min(4.5, lambda_a))

        # Rest days
        home_rest = max(1.0, (prediction_cutoff - home_matches[0].scheduled_kickoff).total_seconds() / 86400.0)
        away_rest = max(1.0, (prediction_cutoff - away_matches[0].scheduled_kickoff).total_seconds() / 86400.0)

        return PreMatchFeatures(
            fixture_id=fixture_id,
            canonical_key=canonical_key,
            prediction_cutoff=prediction_cutoff,
            home_team_canonical=home_team_canonical,
            away_team_canonical=away_team_canonical,
            league_code=league_code,
            home_form_points_last5=home_points,
            away_form_points_last5=away_points,
            home_goals_scored_avg_last5=home_scored / h_count,
            home_goals_conceded_avg_last5=home_conceded / h_count,
            away_goals_scored_avg_last5=away_scored / a_count,
            away_goals_conceded_avg_last5=away_conceded / a_count,
            home_exp_weighted_goals_scored=h_w_avg_scored,
            home_exp_weighted_goals_conceded=h_w_avg_conceded,
            away_exp_weighted_goals_scored=a_w_avg_scored,
            away_exp_weighted_goals_conceded=a_w_avg_conceded,
            alpha_home_attack=round(alpha_home, 4),
            beta_home_defense=round(beta_home, 4),
            alpha_away_attack=round(alpha_away, 4),
            beta_away_defense=round(beta_away, 4),
            lambda_home=round(lambda_h, 4),
            lambda_away=round(lambda_a, 4),
            home_advantage=round(home_advantage, 4),
            home_rest_days=round(home_rest, 1),
            away_rest_days=round(away_rest, 1),
            is_ready=True,
            not_ready_reason=None,
            historical_matches_used=len(home_matches) + len(away_matches)
        )
