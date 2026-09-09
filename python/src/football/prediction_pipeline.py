"""
JamBets — Standalone Football Prediction Pipeline Orchestrator
Executes the full per-fixture prediction pipeline in complete isolation:
Historical Features -> Integrity Gate -> Dixon-Coles -> 250k Simulations -> 45% Filter -> Cloud Supabase.
"""

from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel

from python.src.football.historical_dataset import HistoricalDatasetBuilder, DatasetMetadata
from python.src.football.prematch_features import PreMatchFeatureEngine, PreMatchFeatures
from python.src.football.prediction_models import DixonColesModel
from python.src.football.simulation_engine import MonteCarloSimulationEngine, SimulationRunResult
from python.src.football.publication_filter import PublicationFilter, QualifyingPrediction
from python.src.db.supabase_client import CloudSupabaseClient


class FixturePredictionResult(BaseModel):
    fixture_id: str
    canonical_key: str
    status: str  # 'PUBLISHED', 'NOT_READY', 'SIMULATION_FAILED', 'NO_QUALIFYING_PREDICTIONS'
    feature_snapshot: Optional[PreMatchFeatures] = None
    simulation_result: Optional[SimulationRunResult] = None
    primary_prediction: Optional[QualifyingPrediction] = None
    secondary_predictions: List[Dict[str, Any]] = []
    qualifying_predictions: List[QualifyingPrediction] = []
    not_ready_reason: Optional[str] = None
    persisted_predictions_count: int = 0


class PredictionPipeline:
    """
    Orchestrates the standalone football prediction engine for upcoming fixtures in Sniper Mode.
    Guarantees: 1 Fixture = Exactly 1 Database Row in Cloud Supabase.
    """

    def __init__(
        self,
        dataset: Optional[HistoricalDatasetBuilder] = None,
        supabase: Optional[CloudSupabaseClient] = None,
    ):
        self.dataset = dataset or HistoricalDatasetBuilder()
        self.feature_engine = PreMatchFeatureEngine(self.dataset)
        self.model = DixonColesModel()
        self.simulation_engine = MonteCarloSimulationEngine(self.model)
        self.supabase = supabase or CloudSupabaseClient()

    def process_single_fixture(
        self,
        fixture_id: str,
        canonical_key: str,
        league_code: str,
        home_team_canonical: str,
        away_team_canonical: str,
        kickoff_utc: datetime,
        persist_to_supabase: bool = True,
    ) -> FixturePredictionResult:
        """
        Executes an isolated prediction run for a single fixture in Sniper Mode:
        1. Feature snapshot strictly before kickoff_utc (zero leakage)
        2. Data integrity gate
        3. Parametric Dixon-Coles model
        4. Exactly 250,000 simulations
        5. Filter markets below 45.00%
        6. Sort remaining descending by probability
        7. Extract [0] as primary prediction, [1:4] as secondary predictions JSON list
        8. Upsert exactly ONE row into Cloud Supabase (1 Fixture = 1 Row)
        """
        if kickoff_utc.tzinfo is None:
            kickoff_utc = kickoff_utc.replace(tzinfo=timezone.utc)

        # 1. Feature Engineering with Cutoff Protection
        features = self.feature_engine.compute_features(
            canonical_key=canonical_key,
            league_code=league_code,
            home_team_canonical=home_team_canonical,
            away_team_canonical=away_team_canonical,
            prediction_cutoff=kickoff_utc,
            fixture_id=fixture_id,
        )

        # 2. Data Integrity Gate
        if not features.is_ready:
            return FixturePredictionResult(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                status="NOT_READY",
                feature_snapshot=features,
                not_ready_reason=features.not_ready_reason
            )

        # 3. 250,000 Monte Carlo Simulations
        sim_res = self.simulation_engine.simulate_fixture(
            canonical_key=canonical_key,
            lambda_home=features.lambda_home,
            lambda_away=features.lambda_away,
            fixture_id=fixture_id,
        )

        # 4. Simulation Completion Gate
        if sim_res.status != "completed" or sim_res.completed_simulations < 250000:
            return FixturePredictionResult(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                status="SIMULATION_FAILED",
                feature_snapshot=features,
                simulation_result=sim_res,
                not_ready_reason=f"SIMULATION_INCOMPLETE ({sim_res.completed_simulations} < 250,000)"
            )

        # 5. Extract Qualifying Predictions (>= 45.00%) & Sort Descending
        qualifying = PublicationFilter.filter_market_outcomes(sim_res.market_outcomes)
        qualifying.sort(key=lambda q: q.raw_probability, reverse=True)

        # Sniper Mode Banker Floor: >= 80.00% (raw_probability >= 0.8000)
        has_banker = len(qualifying) > 0 and qualifying[0].raw_probability >= 0.8000

        if has_banker:
            primary = qualifying[0]
            # Secondary predictions: remaining qualifying markets with probability >= 60.00%, capped at 4
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
            # Volatile / Toss-Up Fixture: Protect users with NO_SAFE_BANKER / SKIP
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
            # Secondary predictions for unbankered game: any markets >= 60.00%, up to 4
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

        # 6. Persist to Cloud Supabase: Exactly ONE row per fixture
        if persist_to_supabase:
            try:
                # Upsert simulation record
                sim_payload = {
                    "fixture_id": fixture_id,
                    "target_simulations": 250000,
                    "completed_simulations": sim_res.completed_simulations,
                    "status": "completed",
                    "run_tracking": {
                        "model_version": self.model.model_version,
                        "duration_ms": sim_res.duration_ms,
                        "lambda_home": features.lambda_home,
                        "lambda_away": features.lambda_away,
                        "home_win_pct": sim_res.home_win_pct,
                        "draw_pct": sim_res.draw_pct,
                        "away_win_pct": sim_res.away_win_pct,
                        "over_25_pct": sim_res.over_25_pct,
                        "under_25_pct": sim_res.under_25_pct,
                        "btts_yes_pct": sim_res.btts_yes_pct,
                    }
                }
                created_sim = self.supabase.post("football_simulations", sim_payload)
                sim_id = created_sim[0].get("id") if created_sim else None

                # Upsert single primary prediction with secondary_predictions payload
                pred_payload = {
                    "fixture_id": fixture_id,
                    "simulation_id": sim_id,
                    "market": primary.market_name,
                    "prediction": primary.outcome,
                    "probability": round(float(primary.raw_probability), 4),
                    "confidence_category": primary.confidence_tier,
                    "publication_status": "published",
                    "tier_required": primary.tier_required,
                    "source_data_version": "v1.0.0",
                    "target_kickoff_at": kickoff_utc.isoformat(),
                    "simulations_count": 250000,
                    "secondary_predictions": secondary_list,
                    "metadata": {
                        "probability_pct": primary.probability_pct,
                        "simulations": 250000,
                        "canonical_key": canonical_key,
                        "model_version": self.model.model_version,
                        "home_attack": features.alpha_home_attack,
                        "away_attack": features.alpha_away_attack,
                        "lambda_home": features.lambda_home,
                        "lambda_away": features.lambda_away,
                        "secondary_count": len(secondary_list),
                        "has_safe_banker": has_banker
                    }
                }
                self.supabase.post("football_predictions", pred_payload, on_conflict="fixture_id")
                persisted_count = 1

            except Exception as exc:
                print(f"[ERROR] Failed to persist sniper prediction for {canonical_key}: {exc}")

        return FixturePredictionResult(
            fixture_id=fixture_id,
            canonical_key=canonical_key,
            status="PUBLISHED",
            feature_snapshot=features,
            simulation_result=sim_res,
            primary_prediction=primary,
            secondary_predictions=secondary_list,
            qualifying_predictions=qualifying,
            persisted_predictions_count=persisted_count
        )
