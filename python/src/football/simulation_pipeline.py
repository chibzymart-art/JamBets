"""
JamBets — Standalone Phase 5 Simulation Pipeline Orchestrator
Bridges Phase 4 feature engineering & statistical models to Phase 5 250,000 Monte Carlo execution.
Persists completed simulation jobs and qualifying predictions to Cloud Supabase.
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

from python.src.football.prematch_features import PreMatchFeatures
from python.src.football.prediction_models import DixonColesModel
from python.src.football.simulation_engine import (
    SimulationInputContract,
    MonteCarloSimulationEngine,
    SimulationRunResult,
    SimulationJob
)
from python.src.football.publication_filter import PublicationFilter, QualifyingPrediction
from python.src.db.supabase_client import CloudSupabaseClient


class SimulationPipelineResult(BaseModel):
    fixture_id: str
    canonical_key: str
    status: str  # 'PUBLISHED', 'NOT_READY', 'SIMULATION_FAILED', 'NO_QUALIFYING_PREDICTIONS'
    contract: Optional[SimulationInputContract] = None
    simulation_result: Optional[SimulationRunResult] = None
    primary_prediction: Optional[QualifyingPrediction] = None
    secondary_predictions: List[Dict[str, Any]] = Field(default_factory=list)
    qualifying_predictions: List[QualifyingPrediction] = Field(default_factory=list)
    persisted_predictions_count: int = 0
    not_ready_reason: Optional[str] = None


class SimulationPipeline:
    """
    Orchestrates per-fixture Phase 5 Monte Carlo simulation and persistence in Sniper Mode.
    Guarantees: 1 Fixture = Exactly 1 Database Row in Cloud Supabase.
    """

    def __init__(
        self,
        model: Optional[DixonColesModel] = None,
        simulation_engine: Optional[MonteCarloSimulationEngine] = None,
        supabase: Optional[CloudSupabaseClient] = None
    ):
        self.model = model or DixonColesModel()
        self.simulation_engine = simulation_engine or MonteCarloSimulationEngine(model=self.model)
        self.supabase = supabase or CloudSupabaseClient()

    def process_fixture_simulation(
        self,
        fixture_id: str,
        canonical_key: str,
        features: PreMatchFeatures,
        kickoff_utc: datetime,
        dataset_version: str = "v1.0.0",
        feature_version: str = "v1.0.0",
        persist_to_supabase: bool = True,
        seed: Optional[int] = None
    ) -> SimulationPipelineResult:
        """
        Runs isolated 250,000 Monte Carlo simulation for a fixture and stores qualifying markets in Sniper Mode:
        - Primary prediction: market with absolute highest probability (>= 45%)
        - Secondary predictions: top 2nd, 3rd, 4th highest probabilities formatted into JSONB array
        - Exactly 1 row upserted per fixture
        """
        # 1. Feature Gate Verification
        if not features.is_ready:
            return SimulationPipelineResult(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                status="NOT_READY",
                not_ready_reason=features.not_ready_reason
            )

        # 2. Build Simulation Input Contract
        contract = SimulationInputContract(
            fixture_id=fixture_id,
            sport="football",
            competition=features.league_code,
            season="2024",
            home_team=features.home_team_canonical,
            away_team=features.away_team_canonical,
            scheduled_kickoff=kickoff_utc,
            prediction_cutoff=features.prediction_cutoff,
            dataset_version=dataset_version,
            feature_version=feature_version,
            model_version=self.model.model_version,
            calibration_version="v1.0.0",
            lambda_home=features.lambda_home,
            lambda_away=features.lambda_away,
            model_parameters={
                "rho": self.model.rho,
                "home_advantage": self.model.home_advantage,
                "half_time_split": 0.44
            },
            corner_parameters=None,  # Flags corners MARKET_NOT_READY (no fake parameters)
            source_verification_state="verified",
            feature_integrity_state="ready"
        )

        # 3. Execute Isolated 250,000 Monte Carlo Simulation
        sim_res = self.simulation_engine.simulate_fixture(
            contract=contract,
            seed=seed
        )

        # 4. Enforce Completion Gate
        if sim_res.status != "completed" or sim_res.completed_simulations < 250000:
            return SimulationPipelineResult(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                status="SIMULATION_FAILED",
                contract=contract,
                simulation_result=sim_res,
                not_ready_reason=f"SIMULATION_GATE_FAILED (completed {sim_res.completed_simulations} < 250,000)"
            )

        # 5. Extract Qualifying Market Predictions (>= 45.00%) & Sort Descending
        ready_outcomes = [m for m in sim_res.market_outcomes if m.is_ready]
        qualifying = PublicationFilter.filter_market_outcomes(ready_outcomes)
        qualifying.sort(key=lambda q: q.raw_probability, reverse=True)

        # Sniper Mode Banker Floor: >= 80.00% (raw_probability >= 0.8000)
        has_banker = len(qualifying) > 0 and qualifying[0].raw_probability >= 0.8000

        if has_banker:
            primary = qualifying[0]
            secondary_candidates = [q for q in qualifying[1:] if q.raw_probability >= 0.6000]
            secondary_list = [
                {
                    "market": q.market_name,
                    "prediction": q.outcome,
                    "probability": round(float(q.raw_probability), 4),
                    "prob": round(float(q.probability_pct), 2),
                    "confidence_tier": q.confidence_tier,
                    "tier": q.confidence_tier
                }
                for q in secondary_candidates[:4]
            ]
        else:
            top_prob = round(float(qualifying[0].raw_probability), 4) if qualifying else 0.0
            top_prob_pct = round(float(qualifying[0].probability_pct), 2) if qualifying else 0.0
            primary = QualifyingPrediction(
                market_name="NO_SAFE_BANKER",
                outcome="SKIP",
                probability_pct=top_prob_pct,
                raw_probability=top_prob,
                confidence_tier="NO_SAFE_BANKER",
                publication_status="published",
                tier_required="free",
                is_qualifying=True
            )
            secondary_candidates = [q for q in qualifying if q.raw_probability >= 0.6000]
            secondary_list = [
                {
                    "market": q.market_name,
                    "prediction": q.outcome,
                    "probability": round(float(q.raw_probability), 4),
                    "prob": round(float(q.probability_pct), 2),
                    "confidence_tier": q.confidence_tier,
                    "tier": q.confidence_tier
                }
                for q in secondary_candidates[:4]
            ]

        persisted_count = 0

        # 6. Persist Simulation Job & Single Sniper Prediction to Cloud Supabase
        if persist_to_supabase and primary:
            try:
                # Upsert simulation record in football_simulations
                sim_payload = {
                    "fixture_id": fixture_id,
                    "target_simulations": 250000,
                    "completed_simulations": sim_res.completed_simulations,
                    "status": "completed",
                    "run_tracking": {
                        "simulation_job_id": sim_res.job.simulation_job_id,
                        "model_version": self.model.model_version,
                        "dataset_version": dataset_version,
                        "feature_version": feature_version,
                        "calibration_version": contract.calibration_version,
                        "rng_algorithm": sim_res.job.rng_algorithm,
                        "seed": sim_res.job.seed,
                        "duration_ms": sim_res.duration_ms,
                        "lambda_home": features.lambda_home,
                        "lambda_away": features.lambda_away,
                        "home_win_pct": sim_res.home_win_pct,
                        "draw_pct": sim_res.draw_pct,
                        "away_win_pct": sim_res.away_win_pct,
                        "over_25_pct": sim_res.over_25_pct,
                        "under_25_pct": sim_res.under_25_pct,
                        "btts_yes_pct": sim_res.btts_yes_pct,
                        "first_half_avg_goals": sim_res.first_half_avg_goals,
                        "second_half_avg_goals": sim_res.second_half_avg_goals,
                        "corners_simulated": sim_res.corners_simulated,
                        "sanity_report": sim_res.sanity_report.model_dump() if sim_res.sanity_report else {},
                        "scoreline_distribution": sim_res.scoreline_distribution
                    }
                }
                created_sim = self.supabase.post("football_simulations", sim_payload)
                sim_db_id = created_sim[0].get("id") if created_sim else None

                # Upsert single primary prediction with secondary_predictions payload
                pred_payload = {
                    "fixture_id": fixture_id,
                    "simulation_id": sim_db_id,
                    "market": primary.market_name,
                    "prediction": primary.outcome,
                    "probability": round(float(primary.raw_probability), 4),
                    "confidence_category": primary.confidence_tier,
                    "publication_status": "published",
                    "tier_required": primary.tier_required,
                    "source_data_version": dataset_version,
                    "target_kickoff_at": kickoff_utc.isoformat(),
                    "simulations_count": 250000,
                    "secondary_predictions": secondary_list,
                    "metadata": {
                        "simulation_job_id": sim_res.job.simulation_job_id,
                        "probability_pct": primary.probability_pct,
                        "simulations": 250000,
                        "canonical_key": canonical_key,
                        "model_version": self.model.model_version,
                        "home_attack": features.alpha_home_attack,
                        "away_attack": features.alpha_away_attack,
                        "lambda_home": features.lambda_home,
                        "lambda_away": features.lambda_away,
                        "secondary_count": len(secondary_list),
                        "has_safe_banker": has_banker,
                        "poisson_parameters": sim_res.poisson_parameters,
                        "simulation_outlines": sim_res.simulation_outlines
                    }
                }
                existing_p = self.supabase.get("football_predictions", {"fixture_id": f"eq.{fixture_id}", "select": "id"})
                if existing_p:
                    self.supabase.patch("football_predictions", pred_payload, {"fixture_id": f"eq.{fixture_id}"})
                else:
                    self.supabase.post("football_predictions", pred_payload)

                self.supabase.patch("football_fixtures", {"status": "scheduled"}, {"id": f"eq.{fixture_id}"})
                persisted_count = 1

            except Exception as exc:
                print(f"[ERROR] Failed to persist Phase 5 sniper prediction for {canonical_key}: {exc}")

        status_result = "PUBLISHED" if qualifying else "NO_QUALIFYING_PREDICTIONS"

        return SimulationPipelineResult(
            fixture_id=fixture_id,
            canonical_key=canonical_key,
            status=status_result,
            contract=contract,
            simulation_result=sim_res,
            primary_prediction=primary,
            secondary_predictions=secondary_list,
            qualifying_predictions=qualifying,
            persisted_predictions_count=persisted_count
        )
