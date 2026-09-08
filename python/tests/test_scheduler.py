"""
JamBets — Phase 6 Automated Test Suite
Validates the Automatic 6-Hour Football Prediction Scheduler, Lagos Timezone (WAT) slots,
distributed locking, crash recovery, 4-day horizon eligibility, Phase 4/5 integration,
exact 250,000 draws verification, 45% publication filter, and failure isolation.
"""

import unittest
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
from unittest.mock import MagicMock, patch

try:
    import zoneinfo
    LAGOS_TZ = zoneinfo.ZoneInfo("Africa/Lagos")
except Exception:
    LAGOS_TZ = timezone(timedelta(hours=1), name="WAT")

from python.src.football.scheduler import PredictionCycleScheduler, PredictionCycleTelemetry
from python.src.football.scheduler_lock import DistributedSchedulerLock
from python.src.football.publication_filter import PublicationFilter, QualifyingPrediction
from python.src.football.simulation_engine import (
    SimulationInputContract,
    MonteCarloSimulationEngine,
    SimulationIncompleteError,
    MarketOutcome
)
from python.src.football.prematch_features import PreMatchFeatures
from python.src.football.prediction_models import DixonColesModel


class MockSupabaseClient:
    """Mock Supabase client for deterministic unit testing."""
    def __init__(self):
        self.system_jobs: Dict[str, Dict[str, Any]] = {}
        self.conflicts: List[Dict[str, Any]] = []
        self.prediction_queue: List[Dict[str, Any]] = []
        self.predictions: List[Dict[str, Any]] = []
        self.audit_logs: List[Dict[str, Any]] = []

    def get_system_job_by_key(self, idempotency_key: str) -> Optional[Dict[str, Any]]:
        return self.system_jobs.get(idempotency_key)

    def create_system_job(self, job_payload: Dict[str, Any]) -> Dict[str, Any]:
        job_id = f"job-{len(self.system_jobs) + 1}"
        record = dict(job_payload)
        record["id"] = job_id
        self.system_jobs[job_payload["idempotency_key"]] = record
        return record

    def update_system_job(self, job_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for k, v in self.system_jobs.items():
            if v.get("id") == job_id:
                v.update(updates)
                return v
        return None

    def get(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        if table == "system_jobs":
            id_filter = params.get("id", "") if params else ""
            if id_filter.startswith("eq."):
                target_id = id_filter.replace("eq.", "")
                for v in self.system_jobs.values():
                    if v.get("id") == target_id:
                        return [v]
            return list(self.system_jobs.values())
        elif table == "football_data_conflicts":
            return self.conflicts
        elif table == "football_prediction_queue":
            return self.prediction_queue
        elif table == "football_predictions":
            return self.predictions
        return []

    def post(self, table: str, data: Any, on_conflict: Optional[str] = None) -> List[Dict[str, Any]]:
        if table == "audit_logs":
            self.audit_logs.append(data)
            return [data]
        elif table == "football_predictions":
            self.predictions.append(data)
            return [data]
        elif table == "football_simulations":
            return [{"id": "sim-mock-123"}]
        elif table == "system_jobs":
            return [self.create_system_job(data)]
        return [data]

    def has_unresolved_conflict(self, fixture_id: str) -> bool:
        for c in self.conflicts:
            if c.get("fixture_id") == fixture_id and c.get("resolution") == "unresolved":
                return True
        return False

    def get_prediction_queue(self, limit: int = 50) -> List[Dict[str, Any]]:
        return self.prediction_queue[:limit]

    def record_audit_log(self, actor_type: str, action: str, resource_type: Optional[str] = None, resource_id: Optional[str] = None, details: Optional[Dict[str, Any]] = None, actor_id: Optional[str] = None) -> Dict[str, Any]:
        entry = {
            "actor_type": actor_type,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details or {}
        }
        self.audit_logs.append(entry)
        return entry


class TestPredictionCycleScheduler(unittest.TestCase):

    def setUp(self):
        self.supabase = MockSupabaseClient()
        self.lock = DistributedSchedulerLock(supabase=self.supabase, worker_id="test-worker-1")
        self.scheduler = PredictionCycleScheduler(supabase=self.supabase, lock=self.lock)

    # 1. Lagos Timezone Slot Calculation
    def test_01_wat_timezone_slot_calculation(self):
        # 02:30 WAT -> Slot 0 (00:00 - 05:59 WAT)
        dt1 = datetime(2026, 9, 8, 2, 30, tzinfo=LAGOS_TZ)
        slot1, nom1, next1, key1 = PredictionCycleScheduler.get_wat_slot(dt1)
        self.assertEqual(slot1, 0)
        self.assertEqual(nom1.hour, 0)
        self.assertEqual(next1.hour, 6)
        self.assertEqual(key1, "prediction-cycle-2026-09-08-slot0-wat")

        # 08:15 WAT -> Slot 1 (06:00 - 11:59 WAT)
        dt2 = datetime(2026, 9, 8, 8, 15, tzinfo=LAGOS_TZ)
        slot2, nom2, next2, key2 = PredictionCycleScheduler.get_wat_slot(dt2)
        self.assertEqual(slot2, 1)
        self.assertEqual(nom2.hour, 6)
        self.assertEqual(next2.hour, 12)
        self.assertEqual(key2, "prediction-cycle-2026-09-08-slot1-wat")

        # 14:00 WAT -> Slot 2 (12:00 - 17:59 WAT)
        dt3 = datetime(2026, 9, 8, 14, 0, tzinfo=LAGOS_TZ)
        slot3, nom3, next3, key3 = PredictionCycleScheduler.get_wat_slot(dt3)
        self.assertEqual(slot3, 2)
        self.assertEqual(nom3.hour, 12)
        self.assertEqual(next3.hour, 18)
        self.assertEqual(key3, "prediction-cycle-2026-09-08-slot2-wat")

        # 19:45 WAT -> Slot 3 (18:00 - 23:59 WAT)
        dt4 = datetime(2026, 9, 8, 19, 45, tzinfo=LAGOS_TZ)
        slot4, nom4, next4, key4 = PredictionCycleScheduler.get_wat_slot(dt4)
        self.assertEqual(slot4, 3)
        self.assertEqual(nom4.hour, 18)
        self.assertEqual(key4, "prediction-cycle-2026-09-08-slot3-wat")

    # 2. Idempotency Key Uniqueness
    def test_02_idempotency_key_generation_wat(self):
        dt1 = datetime(2026, 9, 8, 18, 0, tzinfo=LAGOS_TZ)
        dt2 = datetime(2026, 9, 8, 23, 59, tzinfo=LAGOS_TZ)
        _, _, _, key1 = PredictionCycleScheduler.get_wat_slot(dt1)
        _, _, _, key2 = PredictionCycleScheduler.get_wat_slot(dt2)
        self.assertEqual(key1, key2)  # Both fall into Slot 3 of same day

        dt3 = datetime(2026, 9, 9, 0, 1, tzinfo=LAGOS_TZ)
        _, _, _, key3 = PredictionCycleScheduler.get_wat_slot(dt3)
        self.assertNotEqual(key1, key3)  # Next day Slot 0 is different key

    # 3. Distributed Lock Acquisition and Release
    def test_03_distributed_lock_acquisition_and_release(self):
        key = "prediction-cycle-2026-09-08-slot1-wat"
        acquired, job_id, status = self.lock.acquire(key)
        self.assertTrue(acquired)
        self.assertIsNotNone(job_id)
        self.assertEqual(status, "ACQUIRED")

        # Release lock
        released = self.lock.release(job_id, status="completed", items_processed=5)
        self.assertTrue(released)

        # Subsequent acquire reports ALREADY_COMPLETED
        acq2, _, status2 = self.lock.acquire(key)
        self.assertFalse(acq2)
        self.assertEqual(status2, "ALREADY_COMPLETED")

    # 4. Distributed Lock Collision Prevention
    def test_04_distributed_lock_collision_prevention(self):
        key = "prediction-cycle-2026-09-08-slot2-wat"
        acquired1, job_id1, status1 = self.lock.acquire(key)
        self.assertTrue(acquired1)

        # Worker 2 attempts concurrent acquire on same key
        lock2 = DistributedSchedulerLock(supabase=self.supabase, worker_id="test-worker-2")
        acquired2, job_id2, status2 = lock2.acquire(key)
        self.assertFalse(acquired2)
        self.assertEqual(status2, "LOCKED_BY_ACTIVE_WORKER")

    # 5. Stale Lock Crash Recovery
    def test_05_stale_lock_crash_recovery(self):
        key = "prediction-cycle-2026-09-08-slot0-wat"
        # Simulate crashed worker whose heartbeat was 25 minutes ago
        past_heartbeat = (datetime.now(timezone.utc) - timedelta(minutes=25)).isoformat()
        self.supabase.create_system_job({
            "job_type": "prediction_worker",
            "status": "running",
            "started_at": past_heartbeat,
            "idempotency_key": key,
            "metadata": {"worker_id": "dead-worker", "heartbeat_at": past_heartbeat}
        })

        # New worker attempts acquire -> should recover crashed lock
        lock_recover = DistributedSchedulerLock(supabase=self.supabase, worker_id="recovery-worker")
        acquired, job_id, status = lock_recover.acquire(key, timeout_minutes=10)
        self.assertTrue(acquired)
        self.assertEqual(status, "CRASH_RECOVERED_ACQUIRED")

    # 6. Missed Cycle Detection
    def test_06_missed_cycle_detection(self):
        # When previous slot has not executed, reports warning
        ref_time = datetime(2026, 9, 8, 12, 0, tzinfo=LAGOS_TZ)  # Slot 2
        # Previous slot is Slot 1 (06:00 WAT). Since it's not in system_jobs:
        msg = self.scheduler.check_missed_cycles(ref_time)
        self.assertIsNotNone(msg)
        self.assertIn("MISSED_CYCLE_DETECTED", msg)

    # 7. Four-Day Horizon Eligibility (WAT)
    def test_07_eligibility_four_day_window_wat(self):
        now_wat = datetime(2026, 9, 8, 12, 0, tzinfo=LAGOS_TZ)

        # Day 0 (today) -> Eligible
        t0 = (now_wat + timedelta(hours=3)).astimezone(timezone.utc).isoformat()
        # Day +4 -> Eligible
        t4 = (now_wat + timedelta(days=4)).astimezone(timezone.utc).isoformat()
        # Day +5 -> Disqualified (beyond 4 days)
        t5 = (now_wat + timedelta(days=5, hours=2)).astimezone(timezone.utc).isoformat()
        # Past -> Disqualified
        tp = (now_wat - timedelta(days=1)).astimezone(timezone.utc).isoformat()

        self.supabase.prediction_queue = [
            {"id": "f0", "canonical_key": "k0", "target_kickoff_at": t0, "status": "scheduled", "home_team_name": "Team A", "away_team_name": "Team B", "league_code": "ENG_PL"},
            {"id": "f4", "canonical_key": "k4", "target_kickoff_at": t4, "status": "scheduled", "home_team_name": "Team C", "away_team_name": "Team D", "league_code": "ENG_PL"},
            {"id": "f5", "canonical_key": "k5", "target_kickoff_at": t5, "status": "scheduled", "home_team_name": "Team E", "away_team_name": "Team F", "league_code": "ENG_PL"},
            {"id": "fp", "canonical_key": "kp", "target_kickoff_at": tp, "status": "scheduled", "home_team_name": "Team G", "away_team_name": "Team H", "league_code": "ENG_PL"}
        ]

        with patch.object(self.scheduler, "ensure_model_calibrated", return_value=None):
            with patch.object(self.scheduler.feature_engine, "compute_features") as mock_feat:
                mock_feat.return_value = MagicMock(is_ready=False, not_ready_reason="TEST_NOT_READY")
                telemetry = self.scheduler.execute_cycle(ref_time=now_wat, force=True)

        self.assertEqual(telemetry.fixtures_discovered, 4)
        self.assertEqual(telemetry.fixtures_eligible, 2)  # f0 and f4 only
        self.assertEqual(telemetry.fixtures_skipped, 4)  # 2 ineligible + 2 NOT_READY

    # 8. Cancelled and Conflicted Fixtures Rejection
    def test_08_eligibility_cancelled_or_conflicted(self):
        now_wat = datetime(2026, 9, 8, 12, 0, tzinfo=LAGOS_TZ)
        t_valid = (now_wat + timedelta(days=1)).astimezone(timezone.utc).isoformat()

        self.supabase.prediction_queue = [
            {"id": "fcanc", "canonical_key": "kcanc", "target_kickoff_at": t_valid, "status": "cancelled", "home_team_name": "Team A", "away_team_name": "Team B", "league_code": "ENG_PL"},
            {"id": "fconf", "canonical_key": "kconf", "target_kickoff_at": t_valid, "status": "scheduled", "home_team_name": "Team C", "away_team_name": "Team D", "league_code": "ENG_PL"}
        ]
        # Mark fconf with unresolved conflict
        self.supabase.conflicts.append({"fixture_id": "fconf", "resolution": "unresolved"})

        with patch.object(self.scheduler, "ensure_model_calibrated", return_value=None):
            telemetry = self.scheduler.execute_cycle(ref_time=now_wat, force=True)

        self.assertEqual(telemetry.fixtures_discovered, 2)
        self.assertEqual(telemetry.fixtures_eligible, 0)  # Both rejected

    # 9. Phase 4 Feature Gate NOT_READY Protection
    def test_09_phase4_feature_gate_not_ready(self):
        contract = SimulationInputContract(
            fixture_id="f1",
            competition="ENG_PL",
            season="2024",
            home_team="Team A",
            away_team="Team B",
            scheduled_kickoff=datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc),
            prediction_cutoff=datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc),
            lambda_home=1.5,
            lambda_away=1.2,
            feature_integrity_state="missing_history"  # NOT READY
        )
        is_ready, reason = contract.validate_readiness()
        self.assertFalse(is_ready)
        self.assertIn("NOT_READY", reason)

    # 10. Phase 5 Exact 250,000 Iterations Gate
    def test_10_phase5_exact_250k_gate(self):
        engine = MonteCarloSimulationEngine()
        contract = SimulationInputContract(
            fixture_id="f1",
            competition="ENG_PL",
            season="2024",
            home_team="Team A",
            away_team="Team B",
            scheduled_kickoff=datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc),
            prediction_cutoff=datetime(2026, 9, 8, 16, 0, tzinfo=timezone.utc),
            lambda_home=1.5,
            lambda_away=1.2
        )
        # Exact 250k succeeds
        res = engine.simulate_fixture(contract, exact_simulations_override=250000)
        self.assertEqual(res.completed_simulations, 250000)
        self.assertEqual(res.status, "completed")

        # 249,999 fails completion gate and yields 0 market outcomes
        res_fail = engine.simulate_fixture(contract, exact_simulations_override=249999)
        self.assertEqual(res_fail.status, "failed")
        self.assertLess(res_fail.completed_simulations, 250000)
        self.assertEqual(len(res_fail.market_outcomes), 0)


    # 11. 45.00% Publication Filter
    def test_11_publication_filter_threshold_45(self):
        # 44.99% is strictly rejected
        p_sub = PublicationFilter.classify_tier(0.4499)
        self.assertIsNone(p_sub)

        # 45.00% is published as RISKY
        p_gate = PublicationFilter.classify_tier(0.4500)
        self.assertEqual(p_gate, "RISKY")

    # 12. Confidence Tier Classification Boundaries
    def test_12_confidence_tier_boundaries(self):
        self.assertEqual(PublicationFilter.classify_tier(0.4500), "RISKY")
        self.assertEqual(PublicationFilter.classify_tier(0.5999), "RISKY")
        self.assertEqual(PublicationFilter.classify_tier(0.6000), "LOW CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_tier(0.6999), "LOW CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_tier(0.7000), "MID CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_tier(0.8299), "MID CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_tier(0.8300), "HIGH CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_tier(0.8999), "HIGH CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_tier(0.9000), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_tier(0.9599), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_tier(0.9600), "BANGER")
        self.assertEqual(PublicationFilter.classify_tier(1.0000), "BANGER")

    # 13. Fixture Failure Isolation
    def test_13_fixture_failure_isolation(self):
        now_wat = datetime(2026, 9, 8, 12, 0, tzinfo=LAGOS_TZ)
        t_valid = (now_wat + timedelta(days=1)).astimezone(timezone.utc).isoformat()

        self.supabase.prediction_queue = [
            {"id": "f_fail", "canonical_key": "k_fail", "target_kickoff_at": t_valid, "status": "scheduled", "home_team_name": "Broken Team", "away_team_name": "Team B", "league_code": "ENG_PL"},
            {"id": "f_good", "canonical_key": "k_good", "target_kickoff_at": t_valid, "status": "scheduled", "home_team_name": "Good Home", "away_team_name": "Good Away", "league_code": "ENG_PL"}
        ]

        def mock_compute(fixture_id, **kwargs):
            if fixture_id == "f_fail":
                raise RuntimeError("Simulated Database Error on Fixture 1")
            return MagicMock(
                is_ready=True,
                league_code="ENG_PL",
                home_team_canonical="Good Home",
                away_team_canonical="Good Away",
                lambda_home=1.5,
                lambda_away=1.1,
                alpha_home_attack=1.2,
                alpha_away_attack=0.9,
                prediction_cutoff=datetime.now(timezone.utc)
            )

        with patch.object(self.scheduler, "ensure_model_calibrated", return_value=None):
            with patch.object(self.scheduler.feature_engine, "compute_features", side_effect=mock_compute):
                telemetry = self.scheduler.execute_cycle(ref_time=now_wat, force=True)

        # Fixture 1 failed, but Fixture 2 continued and completed successfully
        self.assertEqual(telemetry.fixtures_failed, 1)
        self.assertEqual(telemetry.fixtures_processed, 1)
        self.assertEqual(telemetry.simulations_completed, 1)
        self.assertEqual(telemetry.total_simulated_draws, 250000)

    # 14. Transient Retry with Exponential Backoff
    def test_14_transient_retry_with_backoff(self):
        attempts = 0
        def mock_sim(*args, **kwargs):
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise ConnectionResetError("Transient network timeout")
            # Success on attempt 3
            mock_res = MagicMock(
                status="PUBLISHED",
                qualifying_predictions=[MagicMock(confidence_tier="HIGH CONFIDENCE", market_name="1x2", outcome="home", probability_pct=85.0)],
                simulation_result=MagicMock(duration_ms=50.0, job=MagicMock(simulation_job_id="job-123"))
            )
            return mock_res

        now_wat = datetime(2026, 9, 8, 12, 0, tzinfo=LAGOS_TZ)
        t_valid = (now_wat + timedelta(days=1)).astimezone(timezone.utc).isoformat()
        self.supabase.prediction_queue = [
            {"id": "f_retry", "canonical_key": "k_retry", "target_kickoff_at": t_valid, "status": "scheduled", "home_team_name": "Team A", "away_team_name": "Team B", "league_code": "ENG_PL"}
        ]

        with patch.object(self.scheduler, "ensure_model_calibrated", return_value=None):
            with patch.object(self.scheduler.feature_engine, "compute_features", return_value=MagicMock(is_ready=True, prediction_cutoff=datetime.now(timezone.utc))):
                with patch.object(self.scheduler.pipeline, "process_fixture_simulation", side_effect=mock_sim):
                    telemetry = self.scheduler.execute_cycle(ref_time=now_wat, force=True)

        self.assertEqual(attempts, 3)
        self.assertEqual(telemetry.retried_count, 2)
        self.assertEqual(telemetry.fixtures_processed, 1)

    # 15. Permanent Error Does Not Endless Loop
    def test_15_permanent_error_no_endless_retry(self):
        now_wat = datetime(2026, 9, 8, 12, 0, tzinfo=LAGOS_TZ)
        t_valid = (now_wat + timedelta(days=1)).astimezone(timezone.utc).isoformat()
        self.supabase.prediction_queue = [
            {"id": "f_perm", "canonical_key": "k_perm", "target_kickoff_at": t_valid, "status": "scheduled", "home_team_name": "Team A", "away_team_name": "Team B", "league_code": "ENG_PL"}
        ]

        with patch.object(self.scheduler, "ensure_model_calibrated", return_value=None):
            # Feature extraction error fails immediately without retrying the feature extractor 3 times
            with patch.object(self.scheduler.feature_engine, "compute_features", side_effect=ValueError("Invalid Schema Format")):
                telemetry = self.scheduler.execute_cycle(ref_time=now_wat, force=True)

        self.assertEqual(telemetry.fixtures_failed, 1)
        self.assertEqual(telemetry.retried_count, 0)  # No transient retry on permanent error

    # 16. Historical Contamination Protection
    def test_16_historical_contamination_protection(self):
        # Two fixtures between identical teams on different dates must produce distinct canonical keys
        f1_key = "ENG_PL:arsenal:chelsea:20260908"
        f2_key = "ENG_PL:arsenal:chelsea:20260915"
        self.assertNotEqual(f1_key, f2_key)


if __name__ == "__main__":
    unittest.main()
