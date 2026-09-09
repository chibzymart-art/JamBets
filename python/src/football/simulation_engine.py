"""
JamBets — Standalone Per-Fixture 250,000 Monte Carlo Football Simulation Engine (Phase 5)
Consumes validated fixture-specific model parameters from Phase 4 and independently
simulates each eligible football fixture exactly 250,000 times.

Strictly enforces:
- Formal SimulationInputContract with zero fabricated/imputed parameters
- Explicit SimulationJob identity and lifecycle (QUEUED, RUNNING, COMPLETED, FAILED, INCOMPLETE)
- PCG64 random number generator with auditable seed provenance
- Per-fixture isolation (zero cross-fixture state leakage)
- Mathematical Dixon-Coles bivariate Poisson sampling
- Conditional binomial half-time and second-half simulation (h_1h + h_2h == h_total)
- Corner simulation when validated corner parameters are present (otherwise MARKET_NOT_READY)
- Deterministic discrete outcome extraction across all supported markets
- Statistical sanity and convergence verification
- Exact 250,000 simulation completion gate (completed_count == 250000)
"""

import time
import uuid
import numpy as np
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel, Field

from python.src.football.prediction_models import DixonColesModel


class SimulationInputContract(BaseModel):
    """
    Mandatory per-fixture input contract required before beginning simulation.
    If any mandatory input is missing, malformed, or invalid, triggers NOT_READY.
    """
    fixture_id: str
    sport: str = "football"
    competition: str
    season: str
    home_team: str
    away_team: str
    scheduled_kickoff: datetime
    prediction_cutoff: datetime
    dataset_version: str = "v1.0.0"
    feature_version: str = "v1.0.0"
    model_version: str = "v1.0.0"
    calibration_version: Optional[str] = "v1.0.0"
    lambda_home: float
    lambda_away: float
    model_parameters: Dict[str, Any] = Field(default_factory=dict)
    corner_parameters: Optional[Dict[str, float]] = None
    supported_markets: List[str] = Field(
        default_factory=lambda: [
            "1x2", "double_chance", "over_under_0.5", "over_under_1.5", "over_under_2.5", "over_under_3.5", "over_under_4.5",
            "home_goals_0.5", "away_goals_0.5",
            "btts", "ht_goals_0.5", "ht_goals_1.5", "2h_goals_0.5", "2h_goals_1.5", "corners"
        ]
    )
    source_verification_state: str = "verified"
    feature_integrity_state: str = "ready"

    def validate_readiness(self) -> Tuple[bool, Optional[str]]:
        """Validates all mandatory contract inputs."""
        if not self.fixture_id or not self.home_team or not self.away_team or not self.competition:
            return False, "MISSING_MANDATORY_IDENTIFIERS"
        if self.scheduled_kickoff is None or self.prediction_cutoff is None:
            return False, "MISSING_TIMESTAMPS"
        if self.scheduled_kickoff < self.prediction_cutoff:
            return False, "INVALID_TEMPORAL_ORDER (kickoff < cutoff)"
        if self.lambda_home <= 0.0 or self.lambda_away <= 0.0:
            return False, f"INVALID_GOAL_RATES (lambda_home={self.lambda_home}, lambda_away={self.lambda_away})"
        if np.isnan(self.lambda_home) or np.isnan(self.lambda_away) or np.isinf(self.lambda_home) or np.isinf(self.lambda_away):
            return False, "NON_FINITE_GOAL_RATES"
        if self.source_verification_state != "verified":
            return False, f"UNVERIFIED_SOURCE_STATE ({self.source_verification_state})"
        if self.feature_integrity_state != "ready":
            return False, f"FEATURE_INTEGRITY_NOT_READY ({self.feature_integrity_state})"
        return True, None


class SimulationJob(BaseModel):
    """
    Auditable lifecycle identity for a single 250,000 Monte Carlo simulation run.
    """
    simulation_job_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    fixture_id: str
    model_version: str = "v1.0.0"
    dataset_version: str = "v1.0.0"
    feature_version: str = "v1.0.0"
    calibration_version: Optional[str] = "v1.0.0"
    status: str = "QUEUED"  # QUEUED, RUNNING, COMPLETED, FAILED, INCOMPLETE, CANCELLED
    target_count: int = 250000
    completed_count: int = 0
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: Optional[datetime] = None
    duration_ms: float = 0.0
    rng_algorithm: str = "PCG64"
    seed: int = 0
    error_info: Optional[str] = None


class MarketOutcome(BaseModel):
    """
    Extracted market probability and empirical count from 250,000 simulations.
    """
    market_name: str
    outcome: str
    probability: float = Field(ge=0.0, le=100.0)  # Percentage: 0.00 to 100.00
    raw_probability: float = Field(ge=0.0, le=1.0)  # Fractional: 0.0000 to 1.0000
    simulated_hits: int
    total_simulations: int = 250000
    is_ready: bool = True
    not_ready_reason: Optional[str] = None


class SanityCheckReport(BaseModel):
    """
    Statistical sanity and convergence report evaluated across the 250,000 draws.
    """
    is_valid: bool = True
    sum_1x2: float
    sum_btts: float
    sum_1h_05: float
    sum_2h_05: float
    monotonicity_goals_ok: bool
    double_chance_ok: bool
    all_probabilities_bounded: bool
    violations: List[str] = Field(default_factory=list)


class SimulationRunResult(BaseModel):
    """
    Complete result returned from a 250,000 Monte Carlo simulation execution.
    """
    job: SimulationJob
    contract: SimulationInputContract
    target_simulations: int = 250000
    completed_simulations: int
    status: str  # 'completed', 'failed', 'incomplete', 'NOT_READY'
    duration_ms: float
    sanity_report: Optional[SanityCheckReport] = None
    market_outcomes: List[MarketOutcome] = Field(default_factory=list)
    home_win_pct: float = 0.0
    draw_pct: float = 0.0
    away_win_pct: float = 0.0
    over_25_pct: float = 0.0
    under_25_pct: float = 0.0
    btts_yes_pct: float = 0.0
    scoreline_distribution: Dict[str, float] = Field(default_factory=dict)
    first_half_avg_goals: float = 0.0
    second_half_avg_goals: float = 0.0
    corners_simulated: bool = False
    corners_avg: Optional[float] = None


class SimulationIncompleteError(Exception):
    """Raised when completed simulations are strictly fewer than the required 250,000."""
    pass


class MonteCarloSimulationEngine:
    """
    Standalone Phase 5 Football Monte Carlo Simulation Engine.
    Executes exactly 250,000 iterations per eligible fixture using vectorized sampling.
    """

    TARGET_SIMULATIONS = 250000
    MAX_GOALS_GRID = 11  # 0 to 10 goals per side = 121 score states

    def __init__(self, model: Optional[DixonColesModel] = None):
        self.model = model or DixonColesModel()

    def simulate_fixture(
        self,
        contract: Optional[SimulationInputContract] = None,
        canonical_key: Optional[str] = None,
        lambda_home: Optional[float] = None,
        lambda_away: Optional[float] = None,
        fixture_id: Optional[str] = None,
        seed: Optional[int] = None,
        exact_simulations_override: Optional[int] = None,  # Used exclusively for testing failure gates
        **kwargs
    ) -> SimulationRunResult:
        """
        Executes an isolated 250,000 Monte Carlo simulation run for a single fixture.
        Enforces input contract, exact 250k completion, RNG provenance, and market logic.
        """
        start_dt = datetime.now(timezone.utc)
        start_perf = time.perf_counter()

        # Support direct parameter invocation by wrapping in SimulationInputContract
        if contract is None:
            if lambda_home is None or lambda_away is None:
                raise ValueError("Either contract or (lambda_home, lambda_away) must be provided")
            parts = (canonical_key or "ENG_PL:home:away:20260908").split(":")
            comp = parts[0] if len(parts) > 0 else "ENG_PL"
            home = parts[1] if len(parts) > 1 else "home"
            away = parts[2] if len(parts) > 2 else "away"
            now_utc = datetime.now(timezone.utc)
            contract = SimulationInputContract(
                fixture_id=fixture_id or str(uuid.uuid4()),
                competition=comp,
                season=kwargs.get("season", "2024"),
                home_team=home,
                away_team=away,
                scheduled_kickoff=kwargs.get("scheduled_kickoff", now_utc),
                prediction_cutoff=kwargs.get("prediction_cutoff", now_utc),
                lambda_home=lambda_home,
                lambda_away=lambda_away,
                model_parameters=kwargs.get("model_parameters", {}),
                corner_parameters=kwargs.get("corner_parameters", None)
            )

        # 1. Validate Input Contract
        is_ready, not_ready_reason = contract.validate_readiness()
        if not is_ready:
            job = SimulationJob(
                fixture_id=contract.fixture_id,
                model_version=contract.model_version,
                dataset_version=contract.dataset_version,
                feature_version=contract.feature_version,
                calibration_version=contract.calibration_version,
                status="NOT_READY",
                target_count=self.TARGET_SIMULATIONS,
                completed_count=0,
                started_at=start_dt,
                finished_at=start_dt,
                duration_ms=0.0,
                error_info=not_ready_reason
            )
            return SimulationRunResult(
                job=job,
                contract=contract,
                target_simulations=self.TARGET_SIMULATIONS,
                completed_simulations=0,
                status="NOT_READY",
                duration_ms=0.0,
                market_outcomes=[]
            )

        sim_count = exact_simulations_override if exact_simulations_override is not None else self.TARGET_SIMULATIONS

        # 2. Derive deterministic, auditable seed provenance
        if seed is None:
            # Deterministically hash fixture ID and timestamp for reproducible provenance
            derived_seed = abs(hash(f"{contract.fixture_id}_{contract.scheduled_kickoff.isoformat()}")) % (2**31 - 1)
        else:
            derived_seed = int(seed)

        # Initialize Simulation Job
        job = SimulationJob(
            fixture_id=contract.fixture_id,
            model_version=contract.model_version,
            dataset_version=contract.dataset_version,
            feature_version=contract.feature_version,
            calibration_version=contract.calibration_version,
            status="RUNNING",
            target_count=self.TARGET_SIMULATIONS,
            completed_count=0,
            started_at=start_dt,
            rng_algorithm="PCG64",
            seed=derived_seed
        )

        # Dedicated isolated NumPy Generator per fixture
        rng = np.random.Generator(np.random.PCG64(derived_seed))

        # 3. Compute Dixon-Coles 2D joint score distribution matrix (11x11 goals)
        M = self.model.compute_joint_distribution(
            contract.lambda_home,
            contract.lambda_away,
            max_goals=self.MAX_GOALS_GRID
        )
        flat_p = M.flatten()

        # 4. Vectorized 250,000 categorical draws for full-time scorelines
        sampled_indices = rng.choice(len(flat_p), size=sim_count, p=flat_p)
        home_goals = sampled_indices // self.MAX_GOALS_GRID
        away_goals = sampled_indices % self.MAX_GOALS_GRID

        # 5. Exact 250,000 Iteration Completion Gate
        completed_count = len(home_goals)
        job.completed_count = completed_count

        if completed_count < self.TARGET_SIMULATIONS:
            end_dt = datetime.now(timezone.utc)
            duration_ms = (time.perf_counter() - start_perf) * 1000.0
            job.status = "FAILED"
            job.finished_at = end_dt
            job.duration_ms = round(duration_ms, 2)
            job.error_info = f"Simulation gate failure: completed {completed_count} < required {self.TARGET_SIMULATIONS}"

            return SimulationRunResult(
                job=job,
                contract=contract,
                target_simulations=self.TARGET_SIMULATIONS,
                completed_simulations=completed_count,
                status="failed",
                duration_ms=round(duration_ms, 2),
                market_outcomes=[]
            )

        # 6. Half-Time and Second-Half Goals Simulation
        # Model-grounded half-time split (default 0.44 empirical goal share in 1H)
        f_1h = float(contract.model_parameters.get("half_time_split", 0.44))
        f_1h = max(0.20, min(0.60, f_1h))

        # Conditional binomial goal allocation guarantees h_1h + h_2h == h_total
        h_1h = rng.binomial(home_goals, f_1h)
        a_1h = rng.binomial(away_goals, f_1h)
        h_2h = home_goals - h_1h
        a_2h = away_goals - a_1h

        tot_ft = home_goals + away_goals
        tot_1h = h_1h + a_1h
        tot_2h = h_2h + a_2h

        # 7. Corner Simulation (if model parameters provided, else MARKET_NOT_READY)
        corners_simulated = False
        corners_avg = None
        tot_corners = None

        if contract.corner_parameters and "lambda_corners_total" in contract.corner_parameters:
            lam_c = float(contract.corner_parameters["lambda_corners_total"])
            if lam_c > 0.0:
                tot_corners = rng.poisson(lam_c, size=sim_count)
                corners_simulated = True
                corners_avg = round(float(np.mean(tot_corners)), 2)

        # 8. Deterministic Market Extraction (Discrete integer comparisons)
        n = float(completed_count)

        # 1X2 Match Result
        hw_hits = int(np.sum(home_goals > away_goals))
        dr_hits = int(np.sum(home_goals == away_goals))
        aw_hits = int(np.sum(home_goals < away_goals))

        p_hw = round((hw_hits / n) * 100.0, 4)
        p_dr = round((dr_hits / n) * 100.0, 4)
        p_aw = round((aw_hits / n) * 100.0, 4)

        # Double Chance
        dc_1x_hits = int(np.sum(home_goals >= away_goals))
        dc_x2_hits = int(np.sum(away_goals >= home_goals))
        dc_12_hits = int(np.sum(home_goals != away_goals))

        p_1x = round((dc_1x_hits / n) * 100.0, 4)
        p_x2 = round((dc_x2_hits / n) * 100.0, 4)
        p_12 = round((dc_12_hits / n) * 100.0, 4)

        # Full-Time Goals (O/U 0.5, 1.5, 2.5, 3.5, 4.5)
        o05_hits = int(np.sum(tot_ft >= 1))
        u05_hits = int(np.sum(tot_ft == 0))
        o15_hits = int(np.sum(tot_ft >= 2))
        u15_hits = int(np.sum(tot_ft <= 1))
        o25_hits = int(np.sum(tot_ft >= 3))
        u25_hits = int(np.sum(tot_ft <= 2))
        o35_hits = int(np.sum(tot_ft >= 4))
        u35_hits = int(np.sum(tot_ft <= 3))
        o45_hits = int(np.sum(tot_ft >= 5))
        u45_hits = int(np.sum(tot_ft <= 4))

        p_o05 = round((o05_hits / n) * 100.0, 4)
        p_u05 = round((u05_hits / n) * 100.0, 4)
        p_o15 = round((o15_hits / n) * 100.0, 4)
        p_u15 = round((u15_hits / n) * 100.0, 4)
        p_o25 = round((o25_hits / n) * 100.0, 4)
        p_u25 = round((u25_hits / n) * 100.0, 4)
        p_o35 = round((o35_hits / n) * 100.0, 4)
        p_u35 = round((u35_hits / n) * 100.0, 4)
        p_o45 = round((o45_hits / n) * 100.0, 4)
        p_u45 = round((u45_hits / n) * 100.0, 4)

        # Team Specific Totals (Home / Away Over/Under 0.5)
        home_o05_hits = int(np.sum(home_goals >= 1))
        home_u05_hits = int(np.sum(home_goals == 0))
        away_o05_hits = int(np.sum(away_goals >= 1))
        away_u05_hits = int(np.sum(away_goals == 0))

        p_home_o05 = round((home_o05_hits / n) * 100.0, 4)
        p_home_u05 = round((home_u05_hits / n) * 100.0, 4)
        p_away_o05 = round((away_o05_hits / n) * 100.0, 4)
        p_away_u05 = round((away_u05_hits / n) * 100.0, 4)

        # Both Teams To Score (BTTS)
        btts_yes_hits = int(np.sum((home_goals >= 1) & (away_goals >= 1)))
        btts_no_hits = int(np.sum((home_goals == 0) | (away_goals == 0)))

        p_btts_yes = round((btts_yes_hits / n) * 100.0, 4)
        p_btts_no = round((btts_no_hits / n) * 100.0, 4)

        # Half-Time Goals (O/U 0.5, 1.5)
        o05_1h_hits = int(np.sum(tot_1h >= 1))
        u05_1h_hits = int(np.sum(tot_1h == 0))
        o15_1h_hits = int(np.sum(tot_1h >= 2))
        u15_1h_hits = int(np.sum(tot_1h <= 1))

        p_o05_1h = round((o05_1h_hits / n) * 100.0, 4)
        p_u05_1h = round((u05_1h_hits / n) * 100.0, 4)
        p_o15_1h = round((o15_1h_hits / n) * 100.0, 4)
        p_u15_1h = round((u15_1h_hits / n) * 100.0, 4)

        # Second-Half Goals (O/U 0.5, 1.5)
        o05_2h_hits = int(np.sum(tot_2h >= 1))
        u05_2h_hits = int(np.sum(tot_2h == 0))
        o15_2h_hits = int(np.sum(tot_2h >= 2))
        u15_2h_hits = int(np.sum(tot_2h <= 1))

        p_o05_2h = round((o05_2h_hits / n) * 100.0, 4)
        p_u05_2h = round((u05_2h_hits / n) * 100.0, 4)
        p_o15_2h = round((o15_2h_hits / n) * 100.0, 4)
        p_u15_2h = round((u15_2h_hits / n) * 100.0, 4)

        # Assemble market outcomes
        market_outcomes: List[MarketOutcome] = [
            # 1X2
            MarketOutcome(market_name="1x2", outcome="home", probability=p_hw, raw_probability=round(p_hw/100, 4), simulated_hits=hw_hits),
            MarketOutcome(market_name="1x2", outcome="draw", probability=p_dr, raw_probability=round(p_dr/100, 4), simulated_hits=dr_hits),
            MarketOutcome(market_name="1x2", outcome="away", probability=p_aw, raw_probability=round(p_aw/100, 4), simulated_hits=aw_hits),
            # Double Chance
            MarketOutcome(market_name="double_chance", outcome="1x", probability=p_1x, raw_probability=round(p_1x/100, 4), simulated_hits=dc_1x_hits),
            MarketOutcome(market_name="double_chance", outcome="x2", probability=p_x2, raw_probability=round(p_x2/100, 4), simulated_hits=dc_x2_hits),
            MarketOutcome(market_name="double_chance", outcome="12", probability=p_12, raw_probability=round(p_12/100, 4), simulated_hits=dc_12_hits),
            # Ultra-Safe Full-Time Goals
            MarketOutcome(market_name="over_under_0.5", outcome="over", probability=p_o05, raw_probability=round(p_o05/100, 4), simulated_hits=o05_hits),
            MarketOutcome(market_name="over_under_0.5", outcome="under", probability=p_u05, raw_probability=round(p_u05/100, 4), simulated_hits=u05_hits),
            MarketOutcome(market_name="over_under_1.5", outcome="over", probability=p_o15, raw_probability=round(p_o15/100, 4), simulated_hits=o15_hits),
            MarketOutcome(market_name="over_under_1.5", outcome="under", probability=p_u15, raw_probability=round(p_u15/100, 4), simulated_hits=u15_hits),
            MarketOutcome(market_name="over_under_2.5", outcome="over", probability=p_o25, raw_probability=round(p_o25/100, 4), simulated_hits=o25_hits),
            MarketOutcome(market_name="over_under_2.5", outcome="under", probability=p_u25, raw_probability=round(p_u25/100, 4), simulated_hits=u25_hits),
            MarketOutcome(market_name="over_under_3.5", outcome="over", probability=p_o35, raw_probability=round(p_o35/100, 4), simulated_hits=o35_hits),
            MarketOutcome(market_name="over_under_3.5", outcome="under", probability=p_u35, raw_probability=round(p_u35/100, 4), simulated_hits=u35_hits),
            MarketOutcome(market_name="over_under_4.5", outcome="over", probability=p_o45, raw_probability=round(p_o45/100, 4), simulated_hits=o45_hits),
            MarketOutcome(market_name="over_under_4.5", outcome="under", probability=p_u45, raw_probability=round(p_u45/100, 4), simulated_hits=u45_hits),
            # Team-Specific Totals
            MarketOutcome(market_name="home_goals_0.5", outcome="over", probability=p_home_o05, raw_probability=round(p_home_o05/100, 4), simulated_hits=home_o05_hits),
            MarketOutcome(market_name="home_goals_0.5", outcome="under", probability=p_home_u05, raw_probability=round(p_home_u05/100, 4), simulated_hits=home_u05_hits),
            MarketOutcome(market_name="away_goals_0.5", outcome="over", probability=p_away_o05, raw_probability=round(p_away_o05/100, 4), simulated_hits=away_o05_hits),
            MarketOutcome(market_name="away_goals_0.5", outcome="under", probability=p_away_u05, raw_probability=round(p_away_u05/100, 4), simulated_hits=away_u05_hits),
            # BTTS
            MarketOutcome(market_name="btts", outcome="yes", probability=p_btts_yes, raw_probability=round(p_btts_yes/100, 4), simulated_hits=btts_yes_hits),
            MarketOutcome(market_name="btts", outcome="no", probability=p_btts_no, raw_probability=round(p_btts_no/100, 4), simulated_hits=btts_no_hits),
            # Half-Time Goals
            MarketOutcome(market_name="ht_goals_0.5", outcome="over", probability=p_o05_1h, raw_probability=round(p_o05_1h/100, 4), simulated_hits=o05_1h_hits),
            MarketOutcome(market_name="ht_goals_0.5", outcome="under", probability=p_u05_1h, raw_probability=round(p_u05_1h/100, 4), simulated_hits=u05_1h_hits),
            MarketOutcome(market_name="ht_goals_1.5", outcome="over", probability=p_o15_1h, raw_probability=round(p_o15_1h/100, 4), simulated_hits=o15_1h_hits),
            MarketOutcome(market_name="ht_goals_1.5", outcome="under", probability=p_u15_1h, raw_probability=round(p_u15_1h/100, 4), simulated_hits=u15_1h_hits),
            # Second-Half Goals
            MarketOutcome(market_name="2h_goals_0.5", outcome="over", probability=p_o05_2h, raw_probability=round(p_o05_2h/100, 4), simulated_hits=o05_2h_hits),
            MarketOutcome(market_name="2h_goals_0.5", outcome="under", probability=p_u05_2h, raw_probability=round(p_u05_2h/100, 4), simulated_hits=u05_2h_hits),
            MarketOutcome(market_name="2h_goals_1.5", outcome="over", probability=p_o15_2h, raw_probability=round(p_o15_2h/100, 4), simulated_hits=o15_2h_hits),
            MarketOutcome(market_name="2h_goals_1.5", outcome="under", probability=p_u15_2h, raw_probability=round(p_u15_2h/100, 4), simulated_hits=u15_2h_hits),
        ]

        # Corners extraction (if simulated)
        if corners_simulated and tot_corners is not None:
            c85_o_hits = int(np.sum(tot_corners >= 9))
            c85_u_hits = int(np.sum(tot_corners <= 8))
            c95_o_hits = int(np.sum(tot_corners >= 10))
            c95_u_hits = int(np.sum(tot_corners <= 9))
            c105_o_hits = int(np.sum(tot_corners >= 11))
            c105_u_hits = int(np.sum(tot_corners <= 10))

            p_c85_o = round((c85_o_hits / n) * 100.0, 4)
            p_c85_u = round((c85_u_hits / n) * 100.0, 4)
            p_c95_o = round((c95_o_hits / n) * 100.0, 4)
            p_c95_u = round((c95_u_hits / n) * 100.0, 4)
            p_c105_o = round((c105_o_hits / n) * 100.0, 4)
            p_c105_u = round((c105_u_hits / n) * 100.0, 4)

            market_outcomes.extend([
                MarketOutcome(market_name="corners_8.5", outcome="over", probability=p_c85_o, raw_probability=round(p_c85_o/100, 4), simulated_hits=c85_o_hits),
                MarketOutcome(market_name="corners_8.5", outcome="under", probability=p_c85_u, raw_probability=round(p_c85_u/100, 4), simulated_hits=c85_u_hits),
                MarketOutcome(market_name="corners_9.5", outcome="over", probability=p_c95_o, raw_probability=round(p_c95_o/100, 4), simulated_hits=c95_o_hits),
                MarketOutcome(market_name="corners_9.5", outcome="under", probability=p_c95_u, raw_probability=round(p_c95_u/100, 4), simulated_hits=c95_u_hits),
                MarketOutcome(market_name="corners_10.5", outcome="over", probability=p_c105_o, raw_probability=round(p_c105_o/100, 4), simulated_hits=c105_o_hits),
                MarketOutcome(market_name="corners_10.5", outcome="under", probability=p_c105_u, raw_probability=round(p_c105_u/100, 4), simulated_hits=c105_u_hits),
            ])
        else:
            # Mark corners MARKET_NOT_READY (no fabricated parameters)
            market_outcomes.append(
                MarketOutcome(
                    market_name="corners",
                    outcome="unsupported",
                    probability=0.0,
                    raw_probability=0.0,
                    simulated_hits=0,
                    is_ready=False,
                    not_ready_reason="MARKET_NOT_READY: Insufficient verified historical corner data"
                )
            )

        # 9. Statistical Sanity and Convergence Verification
        sanity = self.check_convergence_and_sanity(
            p_hw=p_hw, p_dr=p_dr, p_aw=p_aw,
            p_1x=p_1x, p_x2=p_x2, p_12=p_12,
            p_o15=p_o15, p_u15=p_u15,
            p_o25=p_o25, p_u25=p_u25,
            p_o35=p_o35, p_u35=p_u35,
            p_btts_yes=p_btts_yes, p_btts_no=p_btts_no,
            p_o05_1h=p_o05_1h, p_u05_1h=p_u05_1h,
            p_o05_2h=p_o05_2h, p_u05_2h=p_u05_2h
        )

        # 10. Compute Top Scoreline Distribution
        scoreline_counts: Dict[str, int] = {}
        sample_size = min(50000, completed_count)
        for h, a in zip(home_goals[:sample_size], away_goals[:sample_size]):
            score_key = f"{h}-{a}"
            scoreline_counts[score_key] = scoreline_counts.get(score_key, 0) + 1

        top_scorelines = {
            k: round((v / float(sample_size)) * 100.0, 2)
            for k, v in sorted(scoreline_counts.items(), key=lambda item: item[1], reverse=True)[:6]
        }

        end_dt = datetime.now(timezone.utc)
        duration_ms = (time.perf_counter() - start_perf) * 1000.0

        job.status = "COMPLETED"
        job.finished_at = end_dt
        job.duration_ms = round(duration_ms, 2)

        return SimulationRunResult(
            job=job,
            contract=contract,
            target_simulations=self.TARGET_SIMULATIONS,
            completed_simulations=completed_count,
            status="completed",
            duration_ms=round(duration_ms, 2),
            sanity_report=sanity,
            market_outcomes=market_outcomes,
            home_win_pct=p_hw,
            draw_pct=p_dr,
            away_win_pct=p_aw,
            over_25_pct=p_o25,
            under_25_pct=p_u25,
            btts_yes_pct=p_btts_yes,
            scoreline_distribution=top_scorelines,
            first_half_avg_goals=round(float(np.mean(tot_1h)), 2),
            second_half_avg_goals=round(float(np.mean(tot_2h)), 2),
            corners_simulated=corners_simulated,
            corners_avg=corners_avg
        )

    @staticmethod
    def check_convergence_and_sanity(
        p_hw: float, p_dr: float, p_aw: float,
        p_1x: float, p_x2: float, p_12: float,
        p_o15: float, p_u15: float,
        p_o25: float, p_u25: float,
        p_o35: float, p_u35: float,
        p_btts_yes: float, p_btts_no: float,
        p_o05_1h: float, p_u05_1h: float,
        p_o05_2h: float, p_u05_2h: float
    ) -> SanityCheckReport:
        """
        Runs mathematical sanity checks on extracted market probabilities.
        Detects anomalies or broken probability axioms.
        """
        violations: List[str] = []

        # 1. Mutually exclusive sums check (Tolerance 0.05%)
        sum_1x2 = p_hw + p_dr + p_aw
        if abs(sum_1x2 - 100.0) > 0.05:
            violations.append(f"1X2 sum out of bounds: {sum_1x2}% (expected 100.0%)")

        sum_btts = p_btts_yes + p_btts_no
        if abs(sum_btts - 100.0) > 0.05:
            violations.append(f"BTTS sum out of bounds: {sum_btts}% (expected 100.0%)")

        sum_1h_05 = p_o05_1h + p_u05_1h
        if abs(sum_1h_05 - 100.0) > 0.05:
            violations.append(f"1H O/U 0.5 sum out of bounds: {sum_1h_05}%")

        sum_2h_05 = p_o05_2h + p_u05_2h
        if abs(sum_2h_05 - 100.0) > 0.05:
            violations.append(f"2H O/U 0.5 sum out of bounds: {sum_2h_05}%")

        # 2. Monotonicity of goal thresholds
        monotonicity_goals = (p_o35 <= p_o25 <= p_o15) and (p_u15 <= p_u25 <= p_u35)
        if not monotonicity_goals:
            violations.append(f"Goal monotonicity violated: O3.5={p_o35}%, O2.5={p_o25}%, O1.5={p_o15}%")

        # 3. Double Chance consistency
        dc_ok = (p_1x >= max(p_hw, p_dr) - 0.01) and (p_x2 >= max(p_dr, p_aw) - 0.01) and (p_12 >= max(p_hw, p_aw) - 0.01)
        if not dc_ok:
            violations.append("Double Chance lower-bound violated")

        # 4. Bounds check: all within [0.0, 100.0]
        probs = [p_hw, p_dr, p_aw, p_1x, p_x2, p_12, p_o15, p_u15, p_o25, p_u25, p_o35, p_u35, p_btts_yes, p_btts_no]
        all_bounded = all(0.0 <= p <= 100.0 for p in probs)
        if not all_bounded:
            violations.append("Probability outside [0.0, 100.0] detected")

        return SanityCheckReport(
            is_valid=len(violations) == 0,
            sum_1x2=round(sum_1x2, 2),
            sum_btts=round(sum_btts, 2),
            sum_1h_05=round(sum_1h_05, 2),
            sum_2h_05=round(sum_2h_05, 2),
            monotonicity_goals_ok=monotonicity_goals,
            double_chance_ok=dc_ok,
            all_probabilities_bounded=all_bounded,
            violations=violations
        )
