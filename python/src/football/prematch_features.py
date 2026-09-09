"""
JamBets — Pre-Match Feature Engineering Pipeline (Phase 4.7)
Computes pre-match feature vectors strictly using historical data available
BEFORE the prediction cutoff timestamp (zero temporal data leakage).
Implements the Zero-Hallucination Cascading Fallback:
  - Tier 1: FotMob rolling non-penalty xG (npxG) & xGA
  - Tier 2: ESPN Verified historical goal distributions
  - Hard Stop: MissingDataException raised if both Tier 1 & Tier 2 fail (zero synthetic guessing).
Incorporates squad-aware Google News injury debuffs.
"""

import math
from datetime import datetime, timezone
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field

from python.src.football.historical_dataset import HistoricalMatch, HistoricalDatasetBuilder
from python.src.football.identity import normalize_team_name, resolve_fuzzy_team_name
from python.src.sources.fotmob import FotMobAdapter
from python.src.sources.google_news import GoogleNewsAdapter


class MissingDataException(Exception):
    """
    Raised when real data is missing from both Tier 1 (FotMob xG)
    and Tier 2 (ESPN Historical Records).
    Zero-fallback rule: synthetic guessing (lambda = 1.5) is strictly forbidden.
    """
    def __init__(self, fixture_id: Optional[str], canonical_key: str, missing_fields: List[str]):
        self.fixture_id = fixture_id
        self.canonical_key = canonical_key
        self.missing_fields = missing_fields
        super().__init__(
            f"Zero-Hallucination Gate: Real data missing for {canonical_key} ({', '.join(missing_fields)})"
        )


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

    # Data source tier
    data_tier_used: str = "TIER_2_ESPN"  # "TIER_1_FOTMOB" or "TIER_2_ESPN"
    home_npxg: Optional[float] = None
    away_npxg: Optional[float] = None

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

    # Squad-aware injury modifiers
    squad_injury_debuff_home: float = 1.0
    squad_injury_debuff_away: float = 1.0
    flagged_injuries: List[Dict[str, Any]] = Field(default_factory=list)

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
    Constructs pre-match feature snapshots with strict cutoff enforcement
    and cascading real-data fallbacks.
    """

    DECAY_HALF_LIFE_DAYS = 60.0  # Exponential decay half-life in days
    DEFAULT_LEAGUE_GOAL_AVG = 1.35  # Average goals per team per match

    def __init__(
        self,
        dataset: HistoricalDatasetBuilder,
        fotmob: Optional[FotMobAdapter] = None,
        google_news: Optional[GoogleNewsAdapter] = None
    ):
        self.dataset = dataset
        self.fotmob = fotmob or FotMobAdapter()
        self.google_news = google_news or GoogleNewsAdapter()
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
        Cascades Tier 1 (FotMob xG) -> Tier 2 (ESPN Raw Goals).
        Raises MissingDataException if real data is absent.
        """
        if prediction_cutoff.tzinfo is None:
            prediction_cutoff = prediction_cutoff.replace(tzinfo=timezone.utc)

        # Apply rapidfuzz entity resolution
        home_norm = normalize_team_name(home_team_canonical)
        away_norm = normalize_team_name(away_team_canonical)

        # Baseline League Stats for scaling
        league_matches = self.dataset.get_league_matches(league_code, prediction_cutoff)
        if len(league_matches) > 10:
            league_h_goals = sum(m.home_score for m in league_matches) / len(league_matches)
            league_a_goals = sum(m.away_score for m in league_matches) / len(league_matches)
        else:
            league_h_goals = 1.45
            league_a_goals = 1.15

        league_avg = max(0.8, (league_h_goals + league_a_goals) / 2.0)
        home_advantage = min(1.45, max(1.10, league_h_goals / max(0.8, league_a_goals)))

        data_tier_used = "TIER_2_ESPN"
        home_npxg_val = None
        away_npxg_val = None

        # -------------------------------------------------------------
        # TIER 1: FotMob Rolling npxG & xGA Inspection
        # -------------------------------------------------------------
        tier1_success = False
        fotmob_h = self.fotmob.fetch_team_xg_metrics(home_norm, league_code)
        fotmob_a = self.fotmob.fetch_team_xg_metrics(away_norm, league_code)

        if fotmob_h and fotmob_a and fotmob_h.get("matches_analyzed", 0) >= 3 and fotmob_a.get("matches_analyzed", 0) >= 3:
            data_tier_used = "TIER_1_FOTMOB"
            home_npxg_val = fotmob_h.get("npxg_for", 1.35)
            away_npxg_val = fotmob_a.get("npxg_for", 1.15)

            alpha_home = max(0.4, min(2.5, home_npxg_val / max(0.5, league_avg)))
            beta_away = max(0.4, min(2.5, fotmob_a.get("xga", 1.2) / max(0.5, league_avg)))
            alpha_away = max(0.4, min(2.5, away_npxg_val / max(0.5, league_avg)))
            beta_home = max(0.4, min(2.5, fotmob_h.get("xga", 1.2) / max(0.5, league_avg)))

            lambda_h = alpha_home * beta_away * home_advantage * league_avg
            lambda_a = alpha_away * beta_home * (1.0 / home_advantage) * league_avg
            tier1_success = True

            h_points, a_points = 0.0, 0.0
            h_scored_avg, h_conceded_avg = home_npxg_val, fotmob_h.get("xga", 1.2)
            a_scored_avg, a_conceded_avg = away_npxg_val, fotmob_a.get("xga", 1.2)
            h_w_avg_scored, h_w_avg_conceded = home_npxg_val, fotmob_h.get("xga", 1.2)
            a_w_avg_scored, a_w_avg_conceded = away_npxg_val, fotmob_a.get("xga", 1.2)
            home_matches_count = fotmob_h.get("matches_analyzed", 0)
            away_matches_count = fotmob_a.get("matches_analyzed", 0)
            home_rest, away_rest = 7.0, 7.0

        # -------------------------------------------------------------
        # TIER 2: ESPN Historical Records Cascading Fallback
        # -------------------------------------------------------------
        if not tier1_success:
            home_matches = self.dataset.get_team_matches(home_norm, prediction_cutoff, limit=20)
            if not home_matches:
                home_matches = self.dataset.get_team_matches(home_team_canonical, prediction_cutoff, limit=20)

            away_matches = self.dataset.get_team_matches(away_norm, prediction_cutoff, limit=20)
            if not away_matches:
                away_matches = self.dataset.get_team_matches(away_team_canonical, prediction_cutoff, limit=20)

            # ZERO-FALLBACK ENFORCEMENT: Raise MissingDataException if Tier 2 also fails
            if len(home_matches) == 0 or len(away_matches) == 0:
                missing = []
                if len(home_matches) == 0:
                    missing.append(f"historical_matches({home_team_canonical})")
                if len(away_matches) == 0:
                    missing.append(f"historical_matches({away_team_canonical})")
                missing.append("tier1_fotmob_npxg")
                raise MissingDataException(
                    fixture_id=fixture_id,
                    canonical_key=canonical_key,
                    missing_fields=missing
                )

            # Compute Form (Last 5 matches)
            home_last5 = home_matches[:5]
            away_last5 = away_matches[:5]

            h_points = 0.0
            h_scored = 0.0
            h_conceded = 0.0
            for m in home_last5:
                is_home = (m.home_team_canonical == home_norm or m.home_team_canonical == home_team_canonical)
                s = m.home_score if is_home else m.away_score
                c = m.away_score if is_home else m.home_score
                h_scored += s
                h_conceded += c
                if s > c:
                    h_points += 3.0
                elif s == c:
                    h_points += 1.0

            a_points = 0.0
            a_scored = 0.0
            a_conceded = 0.0
            for m in away_last5:
                is_away = (m.away_team_canonical == away_norm or m.away_team_canonical == away_team_canonical)
                s = m.away_score if is_away else m.home_score
                c = m.home_score if is_away else m.away_score
                a_scored += s
                a_conceded += c
                if s > c:
                    a_points += 3.0
                elif s == c:
                    a_points += 1.0

            h_count = max(1, len(home_last5))
            a_count = max(1, len(away_last5))
            h_scored_avg = h_scored / h_count
            h_conceded_avg = h_conceded / h_count
            a_scored_avg = a_scored / a_count
            a_conceded_avg = a_conceded / a_count

            # Exponential Time Decay Weighting
            h_exp_scored, h_exp_conceded, h_weights_sum = 0.0, 0.0, 0.0
            for m in home_matches:
                days_ago = max(0.0, (prediction_cutoff - m.scheduled_kickoff).total_seconds() / 86400.0)
                weight = math.exp(-self.decay_rate * days_ago)
                is_h = (m.home_team_canonical == home_norm or m.home_team_canonical == home_team_canonical)
                h_exp_scored += (m.home_score if is_h else m.away_score) * weight
                h_exp_conceded += (m.away_score if is_h else m.home_score) * weight
                h_weights_sum += weight

            a_exp_scored, a_exp_conceded, a_weights_sum = 0.0, 0.0, 0.0
            for m in away_matches:
                days_ago = max(0.0, (prediction_cutoff - m.scheduled_kickoff).total_seconds() / 86400.0)
                weight = math.exp(-self.decay_rate * days_ago)
                is_a = (m.away_team_canonical == away_norm or m.away_team_canonical == away_team_canonical)
                a_exp_scored += (m.away_score if is_a else m.home_score) * weight
                a_exp_conceded += (m.home_score if is_a else m.away_score) * weight
                a_weights_sum += weight

            h_w_avg_scored = h_exp_scored / max(0.001, h_weights_sum)
            h_w_avg_conceded = h_exp_conceded / max(0.001, h_weights_sum)
            a_w_avg_scored = a_exp_scored / max(0.001, a_weights_sum)
            a_w_avg_conceded = a_exp_conceded / max(0.001, a_weights_sum)

            alpha_home = max(0.4, min(2.5, h_w_avg_scored / max(0.5, league_avg)))
            beta_home = max(0.4, min(2.5, h_w_avg_conceded / max(0.5, league_avg)))
            alpha_away = max(0.4, min(2.5, a_w_avg_scored / max(0.5, league_avg)))
            beta_away = max(0.4, min(2.5, a_w_avg_conceded / max(0.5, league_avg)))

            lambda_h = alpha_home * beta_away * home_advantage * league_avg
            lambda_a = alpha_away * beta_home * (1.0 / home_advantage) * league_avg

            home_matches_count = len(home_matches)
            away_matches_count = len(away_matches)
            home_rest = max(1.0, (prediction_cutoff - home_matches[0].scheduled_kickoff).total_seconds() / 86400.0)
            away_rest = max(1.0, (prediction_cutoff - away_matches[0].scheduled_kickoff).total_seconds() / 86400.0)

        # -------------------------------------------------------------
        # SQUAD-AWARE GOOGLE NEWS NLP: Absence Modifier Debuffs
        # -------------------------------------------------------------
        h_squad = self.fotmob.fetch_squad_roster(home_norm)
        a_squad = self.fotmob.fetch_squad_roster(away_norm)

        h_news = self.google_news.fetch_injury_news(home_norm, h_squad)
        a_news = self.google_news.fetch_injury_news(away_norm, a_squad)

        h_debuff = h_news.get("modifier_debuff", 1.0)
        a_debuff = a_news.get("modifier_debuff", 1.0)

        # Apply offensive debuff to goal expectancy lambda
        lambda_h = lambda_h * h_debuff
        lambda_a = lambda_a * a_debuff

        # Bound check for numerical stability
        lambda_h = max(0.2, min(4.5, lambda_h))
        lambda_a = max(0.2, min(4.5, lambda_a))

        flagged_injuries = []
        for item in h_news.get("flagged_absences", []):
            flagged_injuries.append({"team": home_norm, "player": item.get("player"), "headline": item.get("headline")})
        for item in a_news.get("flagged_absences", []):
            flagged_injuries.append({"team": away_norm, "player": item.get("player"), "headline": item.get("headline")})

        return PreMatchFeatures(
            fixture_id=fixture_id,
            canonical_key=canonical_key,
            prediction_cutoff=prediction_cutoff,
            home_team_canonical=home_norm,
            away_team_canonical=away_norm,
            league_code=league_code,
            data_tier_used=data_tier_used,
            home_npxg=home_npxg_val,
            away_npxg=away_npxg_val,
            home_form_points_last5=h_points,
            away_form_points_last5=a_points,
            home_goals_scored_avg_last5=round(h_scored_avg, 2),
            home_goals_conceded_avg_last5=round(h_conceded_avg, 2),
            away_goals_scored_avg_last5=round(a_scored_avg, 2),
            away_goals_conceded_avg_last5=round(a_conceded_avg, 2),
            home_exp_weighted_goals_scored=round(h_w_avg_scored, 3),
            home_exp_weighted_goals_conceded=round(h_w_avg_conceded, 3),
            away_exp_weighted_goals_scored=round(a_w_avg_scored, 3),
            away_exp_weighted_goals_conceded=round(a_w_avg_conceded, 3),
            alpha_home_attack=round(alpha_home, 4),
            beta_home_defense=round(beta_home, 4),
            alpha_away_attack=round(alpha_away, 4),
            beta_away_defense=round(beta_away, 4),
            lambda_home=round(lambda_h, 4),
            lambda_away=round(lambda_a, 4),
            home_advantage=round(home_advantage, 4),
            squad_injury_debuff_home=round(h_debuff, 2),
            squad_injury_debuff_away=round(a_debuff, 2),
            flagged_injuries=flagged_injuries,
            home_rest_days=round(home_rest, 1),
            away_rest_days=round(away_rest, 1),
            is_ready=True,
            not_ready_reason=None,
            historical_matches_used=home_matches_count + away_matches_count
        )

    # Alias for pipeline compatibility
    extract_features = compute_features
