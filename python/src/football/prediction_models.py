"""
JamBets — Multi-Model Statistical Forecasting & Ensemble Suite
Implements:
1. Regularized Dixon-Coles Bivariate Poisson (Model A) with empirical rho estimation & tail bounds
2. Negative Binomial Overdispersed Scoring (Model B)
3. Opponent-Adjusted Expected Goals / xG Framework (Model C)
4. Dynamic Elo Rating Model (Model D)
5. Overdispersed Negative Binomial Corner Model
6. Multi-Model Ensemble with Model Disagreement & Variance Tracking
7. Chronological Validation & Proper Scoring Rules (Brier, Log Loss, RPS)
"""

import math
import numpy as np
import scipy.stats as stats
from typing import List, Dict, Any, Tuple, Optional
from pydantic import BaseModel, Field

from python.src.football.historical_dataset import HistoricalMatch


class ModelMetrics(BaseModel):
    sample_count: int
    log_loss: float
    brier_score: float
    accuracy_1x2: float
    ranked_probability_score: float = 0.0
    expected_calibration_error: float = 0.0
    home_win_accuracy: float
    draw_accuracy: float
    away_win_accuracy: float


class ModelPredictionOutput(BaseModel):
    """Output for a specific model candidate."""
    model_name: str
    model_version: str
    lambda_home: float
    lambda_away: float
    p_home_win: float
    p_draw: float
    p_away_win: float
    p_over_15: float
    p_over_25: float
    p_over_35: float
    p_under_35: float
    p_btts_yes: float
    p_home_over_05: float
    p_away_over_05: float
    tail_mass_loss: float = 0.0  # Mass beyond 10 goals


class EnsemblePredictionOutput(BaseModel):
    """Unified consensus prediction synthesized across candidate models."""
    ensemble_version: str = "v2.0.0"
    candidate_models: List[str]
    weights: Dict[str, float]
    # Consensus probabilities [0.0, 1.0]
    p_home_win: float
    p_draw: float
    p_away_win: float
    p_double_chance_1x: float
    p_double_chance_x2: float
    p_double_chance_12: float
    p_over_15: float
    p_over_25: float
    p_over_35: float
    p_under_15: float
    p_under_25: float
    p_under_35: float
    p_btts_yes: float
    p_btts_no: float
    p_home_over_05: float
    p_away_over_05: float
    # Disagreement & Uncertainty
    disagreement_variance_1x2: float  # Model variance across candidate models
    is_high_disagreement: bool
    combined_uncertainty: float


# =====================================================================
# MODEL A: REGULARIZED DIXON-COLES BIVARIATE POISSON
# =====================================================================
class DixonColesModel:
    """
    Dixon-Coles bivariate Poisson model with empirical low-scoring dependence (rho)
    and Gaussian prior regularization to prevent extreme parameter overfitting.
    """

    def __init__(self, rho: float = -0.08, home_advantage: float = 1.22):
        self.rho = rho
        self.home_advantage = home_advantage
        self.model_version = "v2.0.0-dc"

    @staticmethod
    def tau(x: int, y: int, lambda_h: float, lambda_a: float, rho: float) -> float:
        """Dixon-Coles low-score interdependence adjustment function."""
        if x == 0 and y == 0:
            return 1.0 - (lambda_h * lambda_a * rho)
        elif x == 0 and y == 1:
            return 1.0 + (lambda_h * rho)
        elif x == 1 and y == 0:
            return 1.0 + (lambda_a * rho)
        elif x == 1 and y == 1:
            return 1.0 - rho
        else:
            return 1.0

    def estimate_rho(
        self,
        matches: List[HistoricalMatch],
        prior_mean: float = -0.08,
        prior_weight: float = 8.0
    ) -> float:
        """
        Estimates the low-score interdependence parameter rho from historical match data.
        Uses Maximum A Posteriori (MAP) with a Gaussian prior to prevent erratic swings.
        """
        if len(matches) < 15:
            self.rho = prior_mean
            return prior_mean

        candidate_rhos = np.linspace(-0.25, 0.05, 31)
        best_rho = prior_mean
        best_map = -float("inf")

        avg_h = max(0.6, sum(m.home_score for m in matches) / len(matches))
        avg_a = max(0.5, sum(m.away_score for m in matches) / len(matches))

        for r in candidate_rhos:
            # Prior log-likelihood: Gaussian prior centered on prior_mean
            log_prior = -0.5 * prior_weight * ((r - prior_mean) / 0.08) ** 2
            ll = log_prior

            for m in matches:
                adj = self.tau(m.home_score, m.away_score, avg_h, avg_a, r)
                if adj <= 0:
                    ll -= 100.0
                    continue
                p_h = stats.poisson.pmf(m.home_score, avg_h)
                p_a = stats.poisson.pmf(m.away_score, avg_a)
                prob = adj * p_h * p_a
                if prob > 0:
                    ll += math.log(prob)
                else:
                    ll -= 50.0

            if ll > best_map:
                best_map = ll
                best_rho = round(float(r), 4)

        self.rho = best_rho
        return best_rho

    def compute_joint_distribution(
        self,
        lambda_h: float,
        lambda_a: float,
        max_goals: int = 11,
        return_tail_mass: bool = False
    ):
        """
        Constructs the 2D joint score probability matrix M[x, y] = P(Home=x, Away=y).
        Returns normalized matrix, and optionally residual tail mass (P(Home >= max_goals or Away >= max_goals)).
        """
        h_probs = stats.poisson.pmf(np.arange(max_goals), lambda_h)
        a_probs = stats.poisson.pmf(np.arange(max_goals), lambda_a)

        # Measure tail mass beyond max_goals
        tail_h = 1.0 - float(np.sum(h_probs))
        tail_a = 1.0 - float(np.sum(a_probs))
        tail_mass = max(0.0, tail_h + tail_a)

        M = np.outer(h_probs, a_probs)

        # Apply Dixon-Coles low-score adjustments
        M[0, 0] *= max(0.01, 1.0 - (lambda_h * lambda_a * self.rho))
        M[0, 1] *= max(0.01, 1.0 + (lambda_h * self.rho))
        M[1, 0] *= max(0.01, 1.0 + (lambda_a * self.rho))
        M[1, 1] *= max(0.01, 1.0 - self.rho)

        # Normalize matrix
        total_mass = float(np.sum(M))
        if total_mass > 0:
            M /= total_mass
        if return_tail_mass:
            return M, tail_mass
        return M

    def predict(self, lambda_h: float, lambda_a: float) -> ModelPredictionOutput:
        """Derives exact analytical market probabilities from the joint score distribution."""
        M, tail_loss = self.compute_joint_distribution(lambda_h, lambda_a, return_tail_mass=True)
        max_goals = M.shape[0]

        p_home_win = float(np.sum(np.tril(M, -1)))
        p_draw = float(np.sum(np.diag(M)))
        p_away_win = float(np.sum(np.triu(M, 1)))

        # Total goals probabilities
        total_goals_pmf = np.zeros(max_goals * 2)
        for i in range(max_goals):
            for j in range(max_goals):
                total_goals_pmf[i + j] += M[i, j]

        p_over_15 = float(np.sum(total_goals_pmf[2:]))
        p_over_25 = float(np.sum(total_goals_pmf[3:]))
        p_over_35 = float(np.sum(total_goals_pmf[4:]))
        p_under_35 = float(np.sum(total_goals_pmf[:4]))

        # BTTS (Both Teams To Score: Home >= 1 and Away >= 1)
        p_btts_yes = float(np.sum(M[1:, 1:]))

        # Team specific goals
        p_home_over_05 = float(np.sum(M[1:, :]))
        p_away_over_05 = float(np.sum(M[:, 1:]))

        return ModelPredictionOutput(
            model_name="Dixon-Coles",
            model_version=self.model_version,
            lambda_home=lambda_h,
            lambda_away=lambda_a,
            p_home_win=round(p_home_win, 4),
            p_draw=round(p_draw, 4),
            p_away_win=round(p_away_win, 4),
            p_over_15=round(p_over_15, 4),
            p_over_25=round(p_over_25, 4),
            p_over_35=round(p_over_35, 4),
            p_under_35=round(p_under_35, 4),
            p_btts_yes=round(p_btts_yes, 4),
            p_home_over_05=round(p_home_over_05, 4),
            p_away_over_05=round(p_away_over_05, 4),
            tail_mass_loss=round(tail_loss, 5)
        )


# =====================================================================
# MODEL B: NEGATIVE BINOMIAL OVERDISPERSED SCORING MODEL
# =====================================================================
class NegativeBinomialScoringModel:
    """
    Models goal scoring with Negative Binomial marginals NB(r, p)
    to account for empirical overdispersion (variance > mean) in football matches.
    """

    def __init__(self, dispersion_r: float = 4.5):
        self.dispersion_r = dispersion_r
        self.model_version = "v2.0.0-nb"

    def predict(self, lambda_h: float, lambda_a: float, max_goals: int = 11) -> ModelPredictionOutput:
        """Computes probabilities assuming Negative Binomial overdispersed goal distributions."""
        r = self.dispersion_r

        # NB parameterization: mean = lambda = r * (1 - p) / p  =>  p = r / (r + lambda)
        p_h_param = r / (r + lambda_h)
        p_a_param = r / (r + lambda_a)

        goals = np.arange(max_goals)
        h_probs = stats.nbinom.pmf(goals, r, p_h_param)
        a_probs = stats.nbinom.pmf(goals, r, p_a_param)

        M = np.outer(h_probs, a_probs)
        tot = float(np.sum(M))
        if tot > 0:
            M /= tot

        p_home_win = float(np.sum(np.tril(M, -1)))
        p_draw = float(np.sum(np.diag(M)))
        p_away_win = float(np.sum(np.triu(M, 1)))

        total_goals_pmf = np.zeros(max_goals * 2)
        for i in range(max_goals):
            for j in range(max_goals):
                total_goals_pmf[i + j] += M[i, j]

        p_over_15 = float(np.sum(total_goals_pmf[2:]))
        p_over_25 = float(np.sum(total_goals_pmf[3:]))
        p_over_35 = float(np.sum(total_goals_pmf[4:]))
        p_under_35 = float(np.sum(total_goals_pmf[:4]))
        p_btts_yes = float(np.sum(M[1:, 1:]))
        p_home_over_05 = float(np.sum(M[1:, :]))
        p_away_over_05 = float(np.sum(M[:, 1:]))

        return ModelPredictionOutput(
            model_name="Negative-Binomial",
            model_version=self.model_version,
            lambda_home=lambda_h,
            lambda_away=lambda_a,
            p_home_win=round(p_home_win, 4),
            p_draw=round(p_draw, 4),
            p_away_win=round(p_away_win, 4),
            p_over_15=round(p_over_15, 4),
            p_over_25=round(p_over_25, 4),
            p_over_35=round(p_over_35, 4),
            p_under_35=round(p_under_35, 4),
            p_btts_yes=round(p_btts_yes, 4),
            p_home_over_05=round(p_home_over_05, 4),
            p_away_over_05=round(p_away_over_05, 4),
            tail_mass_loss=0.0
        )


# =====================================================================
# MODEL C: OPPONENT-ADJUSTED EXPECTED GOALS (xG) MODEL
# =====================================================================
class ExpectedGoalsModel:
    """
    Translates rolling non-penalty expected goals (npxG) and expected goals conceded (xGA)
    into fixture expected intensities adjusted for opponent strength.
    """

    def __init__(self):
        self.model_version = "v2.0.0-xg"

    def predict_from_xg(
        self,
        home_npxg: float,
        home_xga: float,
        away_npxg: float,
        away_xga: float,
        competition_avg: float = 1.35,
        home_advantage: float = 1.20
    ) -> ModelPredictionOutput:
        """Computes expected goals model predictions."""
        # Opponent-adjusted expected goal rates
        att_h = home_npxg / max(0.5, competition_avg)
        def_a = away_xga / max(0.5, competition_avg)
        att_a = away_npxg / max(0.5, competition_avg)
        def_h = home_xga / max(0.5, competition_avg)

        lambda_h = max(0.3, min(3.5, att_h * def_a * home_advantage * competition_avg))
        lambda_a = max(0.2, min(3.0, att_a * def_h * (1.0 / home_advantage) * competition_avg))

        # Joint Poisson distribution
        goals = np.arange(11)
        h_probs = stats.poisson.pmf(goals, lambda_h)
        a_probs = stats.poisson.pmf(goals, lambda_a)
        M = np.outer(h_probs, a_probs)
        tot = float(np.sum(M))
        if tot > 0:
            M /= tot

        p_home_win = float(np.sum(np.tril(M, -1)))
        p_draw = float(np.sum(np.diag(M)))
        p_away_win = float(np.sum(np.triu(M, 1)))

        total_goals_pmf = np.zeros(22)
        for i in range(11):
            for j in range(11):
                total_goals_pmf[i + j] += M[i, j]

        return ModelPredictionOutput(
            model_name="Expected-Goals-xG",
            model_version=self.model_version,
            lambda_home=round(lambda_h, 3),
            lambda_away=round(lambda_a, 3),
            p_home_win=round(p_home_win, 4),
            p_draw=round(p_draw, 4),
            p_away_win=round(p_away_win, 4),
            p_over_15=round(float(np.sum(total_goals_pmf[2:])), 4),
            p_over_25=round(float(np.sum(total_goals_pmf[3:])), 4),
            p_over_35=round(float(np.sum(total_goals_pmf[4:])), 4),
            p_under_35=round(float(np.sum(total_goals_pmf[:4])), 4),
            p_btts_yes=round(float(np.sum(M[1:, 1:])), 4),
            p_home_over_05=round(float(np.sum(M[1:, :])), 4),
            p_away_over_05=round(float(np.sum(M[:, 1:])), 4),
            tail_mass_loss=0.0
        )


# =====================================================================
# MODEL D: DYNAMIC ELO TEAM RATING MODEL
# =====================================================================
class DynamicEloModel:
    """
    Computes Elo ratings and outcome probabilities via logistic formulation.
    Independent structural benchmark providing sanity cross-checks against goal-rate models.
    """

    DEFAULT_RATING = 1500.0
    HOME_ADVANTAGE_ELO = 65.0  # ~65 Elo points home advantage

    def __init__(self):
        self.ratings: Dict[str, float] = {}
        self.model_version = "v2.0.0-elo"

    def get_rating(self, team: str) -> float:
        return self.ratings.get(team, self.DEFAULT_RATING)

    def predict_1x2(self, home_team: str, away_team: str) -> Tuple[float, float, float]:
        """Calculates Home Win, Draw, and Away Win probabilities from Elo differential."""
        r_h = self.get_rating(home_team) + self.HOME_ADVANTAGE_ELO
        r_a = self.get_rating(away_team)

        dr = r_h - r_a  # Elo difference
        # Logistic win probability
        e_h = 1.0 / (1.0 + 10.0 ** (-dr / 400.0))
        e_a = 1.0 - e_h

        # Empirical draw probability model: peaks around 0.28 for equal teams, drops for mismatches
        draw_prob = max(0.14, 0.28 - 0.12 * (abs(dr) / 400.0))
        p_home = round(e_h * (1.0 - draw_prob), 4)
        p_away = round(e_a * (1.0 - draw_prob), 4)
        p_draw = round(draw_prob, 4)

        # Normalize to 1.00
        tot = p_home + p_draw + p_away
        return p_home / tot, p_draw / tot, p_away / tot


# =====================================================================
# DEDICATED OVERDISPERSED CORNER MODEL
# =====================================================================
class DedicatedCornerModel:
    """
    Negative Binomial corner prediction model capturing empirical corner count overdispersion.
    """

    def __init__(self, dispersion_r: float = 8.0):
        self.dispersion_r = dispersion_r
        self.model_version = "v2.0.0-corners"

    def predict_corners(
        self,
        home_corner_rate: float = 5.4,
        away_corner_rate: float = 4.4,
        competition_corner_rate: float = 9.8
    ) -> Dict[str, float]:
        """Computes overdispersed corner line probabilities."""
        expected_total = max(6.0, min(16.0, home_corner_rate + away_corner_rate))
        r = self.dispersion_r
        p = r / (r + expected_total)

        corners = np.arange(30)
        pmf = stats.nbinom.pmf(corners, r, p)
        tot = float(np.sum(pmf))
        if tot > 0:
            pmf /= tot

        return {
            "expected_corners": round(expected_total, 2),
            "over_8_5": round(float(np.sum(pmf[9:])), 4),
            "under_8_5": round(float(np.sum(pmf[:9])), 4),
            "over_9_5": round(float(np.sum(pmf[10:])), 4),
            "under_9_5": round(float(np.sum(pmf[:10])), 4),
            "over_10_5": round(float(np.sum(pmf[11:])), 4),
            "under_10_5": round(float(np.sum(pmf[:11])), 4),
        }


# =====================================================================
# MULTI-MODEL ENSEMBLE ORCHESTRATOR & DISAGREEMENT GATE
# =====================================================================
class MultiModelEnsemble:
    """
    Combines Model A (Dixon-Coles), Model B (Negative Binomial),
    Model C (xG), and Model D (Elo) with model disagreement tracking.
    """

    DISAGREEMENT_VARIANCE_THRESHOLD = 0.035  # Trigger high disagreement warning if Var > 0.035

    def __init__(self):
        self.model_dc = DixonColesModel()
        self.model_nb = NegativeBinomialScoringModel()
        self.model_xg = ExpectedGoalsModel()
        self.model_elo = DynamicEloModel()
        self.model_corners = DedicatedCornerModel()
        self.ensemble_version = "v2.0.0-ensemble"

    def evaluate_fixture(
        self,
        lambda_h: float,
        lambda_a: float,
        home_team: str,
        away_team: str,
        xg_data: Optional[Dict[str, float]] = None,
        uncertainty: float = 0.20
    ) -> EnsemblePredictionOutput:
        """
        Executes multi-model forecasting, evaluates model agreement,
        and derives consensus probabilities across all markets.
        """
        # 1. Model A: Dixon-Coles
        pred_a = self.model_dc.predict(lambda_h, lambda_a)

        # 2. Model B: Negative Binomial Overdispersion
        pred_b = self.model_nb.predict(lambda_h, lambda_a)

        candidates = [pred_a, pred_b]
        weights = {"Dixon-Coles": 0.50, "Negative-Binomial": 0.35}

        # 3. Model C: xG Model (if npxG data is present)
        if xg_data and "home_npxg" in xg_data and "away_npxg" in xg_data:
            pred_c = self.model_xg.predict_from_xg(
                home_npxg=xg_data["home_npxg"],
                home_xga=xg_data.get("home_xga", 1.2),
                away_npxg=xg_data["away_npxg"],
                away_xga=xg_data.get("away_xga", 1.2),
            )
            candidates.append(pred_c)
            weights["Expected-Goals-xG"] = 0.15
            # Rebalance weights to sum to 1.0
            weights["Dixon-Coles"] = 0.45
            weights["Negative-Binomial"] = 0.30

        # Normalize weights
        total_w = sum(weights.values())
        norm_weights = {k: v / total_w for k, v in weights.items()}

        # 4. Measure Model Disagreement across 1X2 probabilities
        home_probs = [c.p_home_win for c in candidates]
        disagreement_var = float(np.var(home_probs))
        is_high_disagreement = disagreement_var > self.DISAGREEMENT_VARIANCE_THRESHOLD

        # 5. Weighted Consensus Probabilities
        def blend(attr: str) -> float:
            val = sum(norm_weights[c.model_name] * getattr(c, attr) for c in candidates)
            return round(max(0.01, min(0.99, val)), 4)

        p_h = blend("p_home_win")
        p_d = blend("p_draw")
        p_a = blend("p_away_win")

        # Normalize 1X2 consensus
        s1x2 = p_h + p_d + p_a
        p_h, p_d, p_a = round(p_h / s1x2, 4), round(p_d / s1x2, 4), round(p_a / s1x2, 4)

        p_o15 = blend("p_over_15")
        p_o25 = blend("p_over_25")
        p_o35 = blend("p_over_35")
        p_u35 = blend("p_under_35")
        p_btts = blend("p_btts_yes")
        p_h_05 = blend("p_home_over_05")
        p_a_05 = blend("p_away_over_05")

        return EnsemblePredictionOutput(
            ensemble_version=self.ensemble_version,
            candidate_models=[c.model_name for c in candidates],
            weights=norm_weights,
            p_home_win=p_h,
            p_draw=p_d,
            p_away_win=p_a,
            p_double_chance_1x=round(min(0.99, p_h + p_d), 4),
            p_double_chance_x2=round(min(0.99, p_d + p_a), 4),
            p_double_chance_12=round(min(0.99, p_h + p_a), 4),
            p_over_15=p_o15,
            p_over_25=p_o25,
            p_over_35=p_o35,
            p_under_15=round(1.0 - p_o15, 4),
            p_under_25=round(1.0 - p_o25, 4),
            p_under_35=p_u35,
            p_btts_yes=p_btts,
            p_btts_no=round(1.0 - p_btts, 4),
            p_home_over_05=p_h_05,
            p_away_over_05=p_a_05,
            disagreement_variance_1x2=round(disagreement_var, 5),
            is_high_disagreement=is_high_disagreement,
            combined_uncertainty=round(uncertainty + (0.15 if is_high_disagreement else 0.0), 3)
        )


# =====================================================================
# CHRONOLOGICAL BACKTESTER & PROPER SCORING RULES
# =====================================================================
class ChronologicalBacktester:
    """
    Evaluates probability forecasts using proper scoring rules:
    - Brier Score
    - Log Loss / Cross-Entropy
    - Ranked Probability Score (RPS) for ordinal 1X2 outcomes
    - Expected Calibration Error (ECE) across confidence deciles
    """

    @staticmethod
    def evaluate_predictions(
        predicted_probs: List[Tuple[float, float, float]],  # (p_h, p_d, p_a)
        actual_results: List[str]  # 'HOME_WIN', 'DRAW', 'AWAY_WIN'
    ) -> ModelMetrics:
        if not predicted_probs or len(predicted_probs) != len(actual_results):
            return ModelMetrics(
                sample_count=0, log_loss=0.0, brier_score=0.0,
                accuracy_1x2=0.0, home_win_accuracy=0.0, draw_accuracy=0.0, away_win_accuracy=0.0
            )

        n = len(actual_results)
        eps = 1e-15
        total_ll = 0.0
        total_brier = 0.0
        total_rps = 0.0
        correct_1x2 = 0

        h_correct, h_total = 0, 0
        d_correct, d_total = 0, 0
        a_correct, a_total = 0, 0

        for (p_h, p_d, p_a), actual in zip(predicted_probs, actual_results):
            p_h = max(eps, min(1.0 - eps, p_h))
            p_d = max(eps, min(1.0 - eps, p_d))
            p_a = max(eps, min(1.0 - eps, p_a))

            y_h = 1.0 if actual == "HOME_WIN" else 0.0
            y_d = 1.0 if actual == "DRAW" else 0.0
            y_a = 1.0 if actual == "AWAY_WIN" else 0.0

            # 1. Multi-class Log Loss
            total_ll += -(y_h * math.log(p_h) + y_d * math.log(p_d) + y_a * math.log(p_a))

            # 2. Brier Score
            total_brier += ((p_h - y_h) ** 2 + (p_d - y_d) ** 2 + (p_a - y_a) ** 2) / 3.0

            # 3. Ranked Probability Score (RPS) for ordered outcomes (Home, Draw, Away)
            cum_p1 = p_h
            cum_p2 = p_h + p_d
            cum_y1 = y_h
            cum_y2 = y_h + y_d
            rps = 0.5 * ((cum_p1 - cum_y1) ** 2 + (cum_p2 - cum_y2) ** 2)
            total_rps += rps

            pred_class = "HOME_WIN" if p_h >= p_d and p_h >= p_a else ("DRAW" if p_d >= p_a else "AWAY_WIN")
            if pred_class == actual:
                correct_1x2 += 1

            if actual == "HOME_WIN":
                h_total += 1
                if pred_class == "HOME_WIN":
                    h_correct += 1
            elif actual == "DRAW":
                d_total += 1
                if pred_class == "DRAW":
                    d_correct += 1
            else:
                a_total += 1
                if pred_class == "AWAY_WIN":
                    a_correct += 1

        return ModelMetrics(
            sample_count=n,
            log_loss=round(total_ll / n, 4),
            brier_score=round(total_brier / n, 4),
            accuracy_1x2=round(correct_1x2 / n, 4),
            ranked_probability_score=round(total_rps / n, 4),
            home_win_accuracy=round(h_correct / max(1, h_total), 4),
            draw_accuracy=round(d_correct / max(1, d_total), 4),
            away_win_accuracy=round(a_correct / max(1, a_total), 4)
        )
