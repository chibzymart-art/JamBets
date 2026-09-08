"""
JamBets — 250,000 Monte Carlo Football Simulation Engine
Executes exactly 250,000 independent simulations per eligible fixture.
Extracts empirical market probabilities and enforces simulation completion gates.
"""

import time
import numpy as np
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from python.src.football.prediction_models import DixonColesModel


class MarketOutcome(BaseModel):
    market_name: str
    outcome: str
    probability: float = Field(ge=0.0, le=100.0)  # Percentage (0.00 to 100.00)
    raw_probability: float = Field(ge=0.0, le=1.0)  # Fractional (0.0000 to 1.0000)
    simulated_hits: int
    total_simulations: int = 250000


class SimulationRunResult(BaseModel):
    fixture_id: Optional[str] = None
    canonical_key: str
    target_simulations: int = 250000
    completed_simulations: int
    status: str  # 'completed' or 'failed'
    start_time: datetime
    completion_time: datetime
    duration_ms: float
    model_version: str = "v1.0.0"
    random_seed: Optional[int] = None
    market_outcomes: List[MarketOutcome] = Field(default_factory=list)
    home_win_pct: float = 0.0
    draw_pct: float = 0.0
    away_win_pct: float = 0.0
    over_25_pct: float = 0.0
    under_25_pct: float = 0.0
    btts_yes_pct: float = 0.0
    scoreline_distribution: Dict[str, float] = Field(default_factory=dict)


class SimulationIncompleteError(Exception):
    """Raised when completed simulations are fewer than the required 250,000."""
    pass


class MonteCarloSimulationEngine:
    """
    High-performance vectorized simulation engine running exactly 250,000 iterations per fixture.
    """

    TARGET_SIMULATIONS = 250000

    def __init__(self, model: Optional[DixonColesModel] = None):
        self.model = model or DixonColesModel()

    def simulate_fixture(
        self,
        canonical_key: str,
        lambda_home: float,
        lambda_away: float,
        fixture_id: Optional[str] = None,
        seed: Optional[int] = None,
        exact_simulations_override: Optional[int] = None,  # Used for testing failure gates
    ) -> SimulationRunResult:
        """
        Runs exactly 250,000 Monte Carlo simulations for a fixture.
        Extracts empirical probabilities for all supported markets.
        """
        start_dt = datetime.now(timezone.utc)
        start_perf = time.perf_counter()

        sim_count = exact_simulations_override if exact_simulations_override is not None else self.TARGET_SIMULATIONS

        # Set random seed if provided
        if seed is not None:
            np.random.seed(seed)

        # 1. Compute Dixon-Coles 2D joint score probability matrix (max 11x11 goals)
        max_goals = 11
        M = self.model.compute_joint_distribution(lambda_home, lambda_away, max_goals=max_goals)
        flat_p = M.flatten()

        # 2. Vectorized 250,000 categorical draws
        sampled_indices = np.random.choice(len(flat_p), size=sim_count, p=flat_p)
        home_goals = sampled_indices // max_goals
        away_goals = sampled_indices % max_goals

        # 3. Verify exactly 250,000 simulations completed
        if len(home_goals) < self.TARGET_SIMULATIONS:
            end_dt = datetime.now(timezone.utc)
            duration_ms = (time.perf_counter() - start_perf) * 1000.0
            return SimulationRunResult(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                target_simulations=self.TARGET_SIMULATIONS,
                completed_simulations=len(home_goals),
                status="failed",
                start_time=start_dt,
                completion_time=end_dt,
                duration_ms=round(duration_ms, 2),
                model_version=self.model.model_version,
                random_seed=seed,
                market_outcomes=[]
            )

        # 4. Extract Empirical Market Probabilities
        n = float(sim_count)

        # 1X2 Market
        hw_hits = int(np.sum(home_goals > away_goals))
        dr_hits = int(np.sum(home_goals == away_goals))
        aw_hits = int(np.sum(home_goals < away_goals))

        p_hw = round((hw_hits / n) * 100.0, 4)
        p_dr = round((dr_hits / n) * 100.0, 4)
        p_aw = round((aw_hits / n) * 100.0, 4)

        # Double Chance Market
        dc_1x_hits = int(np.sum(home_goals >= away_goals))
        dc_x2_hits = int(np.sum(away_goals >= home_goals))
        dc_12_hits = int(np.sum(home_goals != away_goals))

        p_1x = round((dc_1x_hits / n) * 100.0, 4)
        p_x2 = round((dc_x2_hits / n) * 100.0, 4)
        p_12 = round((dc_12_hits / n) * 100.0, 4)

        # Full-Time Goals Markets (Over/Under 1.5, 2.5, 3.5)
        total_goals = home_goals + away_goals

        o15_hits = int(np.sum(total_goals > 1.5))
        u15_hits = int(np.sum(total_goals < 1.5))
        o25_hits = int(np.sum(total_goals > 2.5))
        u25_hits = int(np.sum(total_goals < 2.5))
        o35_hits = int(np.sum(total_goals > 3.5))
        u35_hits = int(np.sum(total_goals < 3.5))

        p_o15 = round((o15_hits / n) * 100.0, 4)
        p_u15 = round((u15_hits / n) * 100.0, 4)
        p_o25 = round((o25_hits / n) * 100.0, 4)
        p_u25 = round((u25_hits / n) * 100.0, 4)
        p_o35 = round((o35_hits / n) * 100.0, 4)
        p_u35 = round((u35_hits / n) * 100.0, 4)

        # Both Teams To Score (BTTS)
        btts_yes_hits = int(np.sum((home_goals > 0) & (away_goals > 0)))
        btts_no_hits = int(np.sum((home_goals == 0) | (away_goals == 0)))

        p_btts_yes = round((btts_yes_hits / n) * 100.0, 4)
        p_btts_no = round((btts_no_hits / n) * 100.0, 4)

        # Half-Time Goals (using empirical 45% first-half goal split)
        # Simulate 1H goals using Poisson with 0.45 * lambda
        h_1h = np.random.poisson(0.45 * lambda_home, size=sim_count)
        a_1h = np.random.poisson(0.45 * lambda_away, size=sim_count)
        tot_1h = h_1h + a_1h

        o05_1h_hits = int(np.sum(tot_1h > 0.5))
        u05_1h_hits = int(np.sum(tot_1h < 0.5))
        p_o05_1h = round((o05_1h_hits / n) * 100.0, 4)
        p_u05_1h = round((u05_1h_hits / n) * 100.0, 4)

        # Assemble market outcomes
        market_outcomes = [
            # 1X2
            MarketOutcome(market_name="1x2", outcome="home", probability=p_hw, raw_probability=round(p_hw/100, 4), simulated_hits=hw_hits),
            MarketOutcome(market_name="1x2", outcome="draw", probability=p_dr, raw_probability=round(p_dr/100, 4), simulated_hits=dr_hits),
            MarketOutcome(market_name="1x2", outcome="away", probability=p_aw, raw_probability=round(p_aw/100, 4), simulated_hits=aw_hits),
            # Double Chance
            MarketOutcome(market_name="double_chance", outcome="1x", probability=p_1x, raw_probability=round(p_1x/100, 4), simulated_hits=dc_1x_hits),
            MarketOutcome(market_name="double_chance", outcome="x2", probability=p_x2, raw_probability=round(p_x2/100, 4), simulated_hits=dc_x2_hits),
            MarketOutcome(market_name="double_chance", outcome="12", probability=p_12, raw_probability=round(p_12/100, 4), simulated_hits=dc_12_hits),
            # Over / Under
            MarketOutcome(market_name="over_under_1.5", outcome="over", probability=p_o15, raw_probability=round(p_o15/100, 4), simulated_hits=o15_hits),
            MarketOutcome(market_name="over_under_1.5", outcome="under", probability=p_u15, raw_probability=round(p_u15/100, 4), simulated_hits=u15_hits),
            MarketOutcome(market_name="over_under_2.5", outcome="over", probability=p_o25, raw_probability=round(p_o25/100, 4), simulated_hits=o25_hits),
            MarketOutcome(market_name="over_under_2.5", outcome="under", probability=p_u25, raw_probability=round(p_u25/100, 4), simulated_hits=u25_hits),
            MarketOutcome(market_name="over_under_3.5", outcome="over", probability=p_o35, raw_probability=round(p_o35/100, 4), simulated_hits=o35_hits),
            MarketOutcome(market_name="over_under_3.5", outcome="under", probability=p_u35, raw_probability=round(p_u35/100, 4), simulated_hits=u35_hits),
            # BTTS
            MarketOutcome(market_name="btts", outcome="yes", probability=p_btts_yes, raw_probability=round(p_btts_yes/100, 4), simulated_hits=btts_yes_hits),
            MarketOutcome(market_name="btts", outcome="no", probability=p_btts_no, raw_probability=round(p_btts_no/100, 4), simulated_hits=btts_no_hits),
            # Half-Time
            MarketOutcome(market_name="ht_result", outcome="1h_over_0.5", probability=p_o05_1h, raw_probability=round(p_o05_1h/100, 4), simulated_hits=o05_1h_hits),
            MarketOutcome(market_name="ht_result", outcome="1h_under_0.5", probability=p_u05_1h, raw_probability=round(p_u05_1h/100, 4), simulated_hits=u05_1h_hits),
        ]

        # Top scorelines
        scoreline_counts = {}
        for h, a in zip(home_goals[:50000], away_goals[:50000]):
            score_key = f"{h}-{a}"
            scoreline_counts[score_key] = scoreline_counts.get(score_key, 0) + 1

        top_scorelines = {
            k: round((v / 50000.0) * 100.0, 2)
            for k, v in sorted(scoreline_counts.items(), key=lambda item: item[1], reverse=True)[:6]
        }

        end_dt = datetime.now(timezone.utc)
        duration_ms = (time.perf_counter() - start_perf) * 1000.0

        return SimulationRunResult(
            fixture_id=fixture_id,
            canonical_key=canonical_key,
            target_simulations=self.TARGET_SIMULATIONS,
            completed_simulations=sim_count,
            status="completed",
            start_time=start_dt,
            completion_time=end_dt,
            duration_ms=round(duration_ms, 2),
            model_version=self.model.model_version,
            random_seed=seed,
            market_outcomes=market_outcomes,
            home_win_pct=p_hw,
            draw_pct=p_dr,
            away_win_pct=p_aw,
            over_25_pct=p_o25,
            under_25_pct=p_u25,
            btts_yes_pct=p_btts_yes,
            scoreline_distribution=top_scorelines
        )
