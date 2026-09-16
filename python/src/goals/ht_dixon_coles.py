"""
JamBets — Half-Time Bivariate Dixon-Coles Mathematical Engine
Calibrates discrete 2D joint score probability distribution for the first 45 minutes.
Features low-score dependency correction tau_1H(x, y) and exponential hazard first-goal timing.
"""

import math
import numpy as np
from typing import Dict, Any


class HalfTimeDixonColesModel:
    """
    Evaluates first-half joint score probabilities using Bivariate Dixon-Coles Poisson.
    Models x in {0..4} (home 1H goals) and y in {0..4} (away 1H goals).
    """

    # Low-score correlation parameter for first halves (typically slightly negative)
    DEFAULT_RHO_HT = -0.11

    @classmethod
    def calculate_probabilities(
        cls,
        lambda_ht_h: float,
        lambda_ht_a: float,
        rho: float = DEFAULT_RHO_HT
    ) -> Dict[str, Any]:
        """
        Builds normalized 5x5 joint probability matrix and computes exact 1H outcomes.
        """
        lh = max(0.15, min(2.50, float(lambda_ht_h)))
        la = max(0.10, min(2.20, float(lambda_ht_a)))

        max_goals = 5
        M = np.zeros((max_goals, max_goals), dtype=np.float64)

        for x in range(max_goals):
            for y in range(max_goals):
                p_x = (math.exp(-lh) * (lh ** x)) / math.factorial(x)
                p_y = (math.exp(-la) * (la ** y)) / math.factorial(y)

                # Dixon-Coles low-score dependency parameter
                if x == 0 and y == 0:
                    tau = 1.0 - (lh * la * rho)
                elif x == 1 and y == 0:
                    tau = 1.0 + (la * rho)
                elif x == 0 and y == 1:
                    tau = 1.0 + (lh * rho)
                elif x == 1 and y == 1:
                    tau = 1.0 - rho
                else:
                    tau = 1.0

                tau = max(0.05, tau)
                M[x, y] = tau * p_x * p_y

        # Normalize matrix so total sum is exactly 1.0
        total_sum = np.sum(M)
        if total_sum > 0:
            M = M / total_sum

        # Probability of 0-0 at Half Time
        p_00_ht = float(M[0, 0])

        # Probability of At Least 1 Goal in First Half
        p_ht_over05 = round(max(0.15, min(0.98, 1.0 - p_00_ht)), 4)

        # Probability of Over 1.5 Goals in First Half
        p_under15 = float(M[0, 0] + M[1, 0] + M[0, 1])
        p_ht_over15 = round(max(0.05, min(0.85, 1.0 - p_under15)), 4)

        # Both Teams to Score in First Half
        p_btts_ht = float(np.sum(M[1:, 1:]))

        # Expected First Goal Minute using Median Survival Time of Poisson Process
        # Median time t_half = ln(2) / theta, where theta = (lh + la) / 45.0
        mu_total = lh + la
        if mu_total > 0:
            # t_half = 45 * ln(2) / mu_total
            median_minute = (45.0 * 0.693147) / mu_total
            expected_minute = int(round(max(12, min(42, median_minute))))
        else:
            expected_minute = 35

        return {
            "p_ht_over05": p_ht_over05,
            "p_ht_under05": round(p_00_ht, 4),
            "p_ht_over15": p_ht_over15,
            "p_btts_ht": round(p_btts_ht, 4),
            "lambda_ht_home": round(lh, 2),
            "lambda_ht_away": round(la, 2),
            "lambda_ht_combined": round(lh + la, 2),
            "expected_first_goal_minute": expected_minute,
            "p_00_ht": round(p_00_ht, 4)
        }
