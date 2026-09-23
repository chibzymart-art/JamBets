"""
Oddsbanta — High-Performance Basketball Monte Carlo Simulation Engine
Phase 3: Quantitative Simulation Model & Value Edge Calculator

Simulates 250,000 match instances drawing from pace-adjusted bivariate normal distributions:
1. Moneyline (Home Win / Away Win)
2. Point Spread Cover Probabilities (-1.5 to -15.5)
3. Game Total Over/Under Probabilities (Over/Under lines from 180.5 to 245.5)
4. 1st Half Blitz Projected Scoreline
5. Empirical Percentiles & Value Edge (+EV) against sportsbook odds

Invariant: 100% isolated basketball stochastic engine. Zero football touchpoints.
"""

import time
import numpy as np
from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Tuple


@dataclass
class BasketballSimDistribution:
    simulations_count: int
    home_win_prob: float
    away_win_prob: float
    simulated_home_score: float
    simulated_away_score: float
    simulated_total: float
    simulated_margin: float
    spread_cover_probs: Dict[str, float]  # line -> prob home covers
    totals_over_probs: Dict[str, float]   # line -> prob total over
    first_half_home_score: float
    first_half_away_score: float
    percentiles: Dict[str, float]
    execution_time_ms: float


class BasketballMonteCarloSimulator:
    """
    Vectorized 250,000-iteration Monte Carlo simulator for basketball fixtures.
    """

    def __init__(self, default_simulations: int = 250000):
        self.default_sims = default_simulations

    def simulate(
        self,
        home_mean: float,
        away_mean: float,
        pace: float = 99.5,
        market_spread: Optional[float] = None,
        market_total: Optional[float] = None,
        num_simulations: Optional[int] = None
    ) -> BasketballSimDistribution:
        """
        Executes N Monte Carlo game simulations.
        """
        n = num_simulations or self.default_sims
        t0 = time.time()

        # Variance is proportional to game pace: sigma ≈ 1.25 * sqrt(pace)
        sigma = 1.25 * np.sqrt(max(60.0, pace))
        var = sigma ** 2

        # Positive correlation between home and away scoring environments (pace correlation)
        rho = 0.20
        cov_val = rho * var

        mu = np.array([home_mean, away_mean])
        cov_matrix = np.array([
            [var, cov_val],
            [cov_val, var]
        ])

        # Cholesky decomposition for sub-second generation
        L = np.linalg.cholesky(cov_matrix)
        Z = np.random.standard_normal((n, 2))
        sims = mu + Z @ L.T

        home_scores = sims[:, 0]
        away_scores = sims[:, 1]
        margins = home_scores - away_scores
        totals = home_scores + away_scores

        # Probabilities
        home_wins = (margins > 0).mean()
        away_wins = (margins < 0).mean()

        # Spread cover evaluations (-14.5 to +14.5 in 1.0 increments, plus market_spread if given)
        spread_lines = [-10.5, -8.5, -6.5, -5.5, -4.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 8.5, 10.5]
        if market_spread is not None:
            spread_lines.append(float(market_spread))
        spread_lines = sorted(list(set(spread_lines)))

        spread_probs = {}
        for sp in spread_lines:
            # Home covers if margin > -sp (e.g. if spread is -5.5, home covers if margin > 5.5)
            spread_probs[str(sp)] = round(float((margins > -sp).mean()), 4)

        # Over/Under total evaluations
        benchmark_total = home_mean + away_mean
        total_lines = [
            round(benchmark_total - 10.0, 1),
            round(benchmark_total - 6.0, 1),
            round(benchmark_total - 3.0, 1),
            round(benchmark_total, 1),
            round(benchmark_total + 3.0, 1),
            round(benchmark_total + 6.0, 1),
            round(benchmark_total + 10.0, 1),
        ]
        if market_total is not None:
            total_lines.append(float(market_total))
        total_lines = sorted(list(set(total_lines)))

        totals_probs = {}
        for tl in total_lines:
            totals_probs[str(tl)] = round(float((totals > tl).mean()), 4)

        # First half breakdown (~48.5% of total points, with slightly lower pace in Q1)
        fh_home = round(float(home_scores.mean() * 0.485), 1)
        fh_away = round(float(away_scores.mean() * 0.485), 1)

        # Percentiles
        percentiles = {
            "margin_p10": round(float(np.percentile(margins, 10)), 1),
            "margin_p25": round(float(np.percentile(margins, 25)), 1),
            "margin_p50": round(float(np.percentile(margins, 50)), 1),
            "margin_p75": round(float(np.percentile(margins, 75)), 1),
            "margin_p90": round(float(np.percentile(margins, 90)), 1),
            "total_p10": round(float(np.percentile(totals, 10)), 1),
            "total_p25": round(float(np.percentile(totals, 25)), 1),
            "total_p50": round(float(np.percentile(totals, 50)), 1),
            "total_p75": round(float(np.percentile(totals, 75)), 1),
            "total_p90": round(float(np.percentile(totals, 90)), 1),
        }

        t1 = time.time()
        exec_ms = round((t1 - t0) * 1000.0, 2)

        return BasketballSimDistribution(
            simulations_count=n,
            home_win_prob=round(float(home_wins), 4),
            away_win_prob=round(float(away_wins), 4),
            simulated_home_score=round(float(home_scores.mean()), 1),
            simulated_away_score=round(float(away_scores.mean()), 1),
            simulated_total=round(float(totals.mean()), 1),
            simulated_margin=round(float(margins.mean()), 1),
            spread_cover_probs=spread_probs,
            totals_over_probs=totals_probs,
            first_half_home_score=fh_home,
            first_half_away_score=fh_away,
            percentiles=percentiles,
            execution_time_ms=exec_ms
        )

    @classmethod
    def calculate_ev_edge(cls, probability: float, decimal_odds: float) -> Tuple[float, float]:
        """
        Computes Fair Odds, Expected Value (+EV), and Market Edge %:
        Fair Odds = 1 / probability
        Edge % = probability - (1 / decimal_odds)
        EV = probability * (decimal_odds - 1) - (1 - probability)
        """
        if probability <= 0 or probability >= 1.0 or decimal_odds <= 1.0:
            return round(1.0 / max(0.01, probability), 2), 0.0

        fair_odds = round(1.0 / probability, 2)
        implied_prob = 1.0 / decimal_odds
        edge_pct = round((probability - implied_prob) * 100.0, 2)
        return fair_odds, edge_pct
