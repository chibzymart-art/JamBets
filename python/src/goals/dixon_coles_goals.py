"""
JamBets — Bivariate Dixon-Coles Goal Probability Engine
Replaces naive univariate independent Poisson with an exact 2D joint probability matrix
incorporating the Dixon-Coles low-score dependency adjustment tau(x, y).
Eliminates artificial Over 2.5 probability inflation on low-scoring grinders.
"""

import math
import numpy as np
from typing import Dict, Any, Tuple


class DixonColesGoalsModel:
    """
    Mathematical model evaluating exact bivariate goal distribution matrices.
    Calibrated with empirical Dixon-Coles rho parameter.
    """

    # Empirical rho for European domestic football: captures low-scoring clustering
    DEFAULT_RHO = -0.11

    @staticmethod
    def _poisson_pmf(k: int, lamb: float) -> float:
        """Computes Poisson probability P(X = k) = (lamb^k * e^-lamb) / k!"""
        if lamb <= 0:
            return 1.0 if k == 0 else 0.0
        return (math.exp(-lamb) * (lamb ** k)) / math.factorial(k)

    @classmethod
    def compute_joint_matrix(
        cls,
        lambda_h: float,
        lambda_a: float,
        rho: float = DEFAULT_RHO,
        max_goals: int = 10
    ) -> np.ndarray:
        """
        Constructs the 2D joint score probability matrix M[x, y] = P(Home=x, Away=y)
        with Dixon-Coles low-score dependency adjustment tau(x, y).
        """
        h_probs = np.array([cls._poisson_pmf(i, lambda_h) for i in range(max_goals + 1)])
        a_probs = np.array([cls._poisson_pmf(j, lambda_a) for j in range(max_goals + 1)])

        # Outer product of independent Poisson distributions
        M = np.outer(h_probs, a_probs)

        # Apply Dixon-Coles low-score dependency adjustment tau(x, y)
        # Note: rho is typically negative (e.g. -0.11), which:
        # - INCREASES P(0,0) via 1 - lambda_h*lambda_a*(-0.11) > 1
        # - INCREASES P(1,1) via 1 - (-0.11) = 1.11
        # - DEFLATES P(1,0) and P(0,1) via 1 + lambda * (-0.11)
        M[0, 0] *= max(0.01, 1.0 - (lambda_h * lambda_a * rho))
        M[0, 1] *= max(0.01, 1.0 + (lambda_h * rho))
        M[1, 0] *= max(0.01, 1.0 + (lambda_a * rho))
        M[1, 1] *= max(0.01, 1.0 - rho)

        # Re-normalize matrix to guarantee sum = 1.0
        total_mass = float(np.sum(M))
        if total_mass > 0:
            M /= total_mass

        return M

    @classmethod
    def calculate_probabilities(
        cls,
        lambda_h: float,
        lambda_a: float,
        rho: float = DEFAULT_RHO
    ) -> Dict[str, float]:
        """
        Derives exact analytical market probabilities from the joint score distribution.
        """
        lambda_h = max(0.35, min(4.00, float(lambda_h)))
        lambda_a = max(0.25, min(3.50, float(lambda_a)))

        M = cls.compute_joint_matrix(lambda_h, lambda_a, rho=rho)

        # P(Under 2.5) = P(0-0) + P(1-0) + P(0-1) + P(2-0) + P(1-1) + P(0-2)
        p_under_25 = float(
            M[0, 0] + M[1, 0] + M[0, 1] +
            M[2, 0] + M[1, 1] + M[0, 2]
        )
        p_over_25 = max(0.05, min(0.95, round(1.0 - p_under_25, 4)))

        # Both Teams To Score (BTTS) = sum of M[i, j] for i >= 1 and j >= 1
        p_btts_yes = float(np.sum(M[1:, 1:]))
        p_btts_yes = max(0.10, min(0.90, round(p_btts_yes, 4)))

        # Clean Sheet Probabilities
        p_home_clean_sheet = float(np.sum(M[:, 0]))
        p_away_clean_sheet = float(np.sum(M[0, :]))

        # Half-time Over 0.5 Goals (using empirical 44% first-half scoring ratio)
        lambda_ht_total = (lambda_h + lambda_a) * 0.44
        p_ht_over05 = max(0.20, min(0.96, round(1.0 - math.exp(-lambda_ht_total), 4)))

        return {
            "p_over_25": p_over_25,
            "p_under_25": round(1.0 - p_over_25, 4),
            "p_btts_yes": p_btts_yes,
            "p_ht_over05": p_ht_over05,
            "p_home_clean_sheet": round(p_home_clean_sheet, 4),
            "p_away_clean_sheet": round(p_away_clean_sheet, 4),
            "xg_combined": round(lambda_h + lambda_a, 2)
        }
