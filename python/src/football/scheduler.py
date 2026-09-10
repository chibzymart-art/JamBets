"""
JamBets — Phase 6: Automatic 6-Hour Football Prediction Scheduler & Orchestration Layer
Lagos Timezone (WAT, UTC+1 / Africa/Lagos) Aligned 6-Hour Cycle Orchestrator.
Orchestrates:
  1. Fixture Discovery & 4-Day Queue Eligibility (TODAY to +4 Days in WAT)
  2. Zero-Leakage Pre-Match Feature Engineering (Phase 4)
  3. Dixon-Coles Model Calibration (Phase 4)
  4. Per-Fixture Exactly 250,000 Monte Carlo Simulation Draws (Phase 5)
  5. 45.00% Publication Gating & Confidence Tiering
  6. Idempotent Cloud Supabase Persistence (system_jobs, football_simulations, football_predictions, audit_logs)
  7. Distributed Locking, Worker Crash Recovery, and Transient Error Retries
"""

import os
import sys
import time
import uuid
import signal
import threading
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel, Field

# Ensure Lagos Timezone (WAT: UTC+1)
try:
    import zoneinfo
    LAGOS_TZ = zoneinfo.ZoneInfo("Africa/Lagos")
except Exception:
    LAGOS_TZ = timezone(timedelta(hours=1), name="WAT")

from python.src.config import LEAGUE_REGISTRY, MAX_PREDICTION_WINDOW_DAYS
from python.src.db.supabase_client import CloudSupabaseClient
from python.src.football.historical_dataset import HistoricalDatasetBuilder
from python.src.football.prematch_features import PreMatchFeatureEngine, PreMatchFeatures
from python.src.football.prediction_models import DixonColesModel
from python.src.football.simulation_engine import MonteCarloSimulationEngine
from python.src.football.simulation_pipeline import SimulationPipeline, SimulationPipelineResult
from python.src.football.scheduler_lock import DistributedSchedulerLock
from python.src.football.stale_checker import StaleDataChecker


class PredictionCycleTelemetry(BaseModel):
    cycle_id: str
    idempotency_key: str
    slot: int  # 0: 00:00, 1: 06:00, 2: 12:00, 3: 18:00 WAT
    slot_time_wat: str
    next_scheduled_wat: str
    status: str  # 'COMPLETED', 'FAILED', 'SKIPPED', 'RUNNING'
    started_at: datetime
    finished_at: Optional[datetime] = None
    duration_ms: float = 0.0
    fixtures_discovered: int = 0
    fixtures_eligible: int = 0
    fixtures_processed: int = 0
    predictions_published: int = 0
    fixtures_skipped: int = 0
    fixtures_failed: int = 0
    retried_count: int = 0
    simulations_completed: int = 0
    total_simulated_draws: int = 0
    errors: List[Dict[str, Any]] = Field(default_factory=list)
    dataset_version: str = "v1.0.0"
    model_version: str = "v1.0.0"
    calibration_version: str = "v1.0.0"


class PredictionCycleScheduler:
    """
    Automatic 6-Hour Football Prediction Scheduler aligned to Lagos Timezone (WAT).
    """

    SLOT_HOURS = [0, 6, 12, 18]
    MAX_RETRIES = 3
    RETRY_BACKOFF_SECONDS = [1.0, 2.0, 4.0]

    def __init__(
        self,
        supabase: Optional[CloudSupabaseClient] = None,
        dataset: Optional[HistoricalDatasetBuilder] = None,
        model: Optional[DixonColesModel] = None,
        lock: Optional[DistributedSchedulerLock] = None,
        max_retries: int = MAX_RETRIES
    ):
        self.supabase = supabase or CloudSupabaseClient()
        self.dataset = dataset or HistoricalDatasetBuilder()
        self.model = model or DixonColesModel()
        self.lock = lock or DistributedSchedulerLock(supabase=self.supabase)
        self.max_retries = max_retries

        # Sub-pipelines
        self.feature_engine = PreMatchFeatureEngine(dataset=self.dataset, supabase=self.supabase)
        self.simulation_engine = MonteCarloSimulationEngine(model=self.model)
        self.pipeline = SimulationPipeline(
            model=self.model,
            simulation_engine=self.simulation_engine,
            supabase=self.supabase
        )
        self._shutdown_requested = False

    @classmethod
    def get_wat_slot(cls, ref_time: Optional[datetime] = None) -> Tuple[int, datetime, datetime, str]:
        """
        Computes the current Lagos Timezone (WAT, UTC+1) scheduling slot.
        Slot 0: 00:00 WAT (Midnight Primary Run)
        Slot 1: 06:00 WAT (6:00 AM Retry Fallback)
        Slot 2: 12:00 WAT, Slot 3: 18:00 WAT
        Returns:
            (slot_index, nominal_slot_wat, next_nominal_wat, idempotency_key)
        """
        if ref_time is None:
            ref_time = datetime.now(timezone.utc)
        elif ref_time.tzinfo is None:
            ref_time = ref_time.replace(tzinfo=timezone.utc)

        ref_wat = ref_time.astimezone(LAGOS_TZ)
        hour = ref_wat.hour
        slot = hour // 6  # 0, 1, 2, or 3

        slot_nominal_wat = ref_wat.replace(hour=slot * 6, minute=0, second=0, microsecond=0)
        next_nominal_wat = slot_nominal_wat + timedelta(hours=6)

        date_str = slot_nominal_wat.strftime("%Y-%m-%d")
        idempotency_key = f"prediction-cycle-{date_str}-slot{slot}-wat"

        return slot, slot_nominal_wat, next_nominal_wat, idempotency_key

    @classmethod
    def get_next_run_wat(cls, ref_time: Optional[datetime] = None) -> Tuple[str, datetime, str]:
        """
        Calculates the next scheduled run in Lagos Timezone (WAT):
        - Midnight Primary Run (00:00 WAT)
        - 6:00 AM WAT Retry Fallback (06:00 WAT)
        """
        if ref_time is None:
            ref_time = datetime.now(timezone.utc)
        elif ref_time.tzinfo is None:
            ref_time = ref_time.replace(tzinfo=timezone.utc)

        ref_wat = ref_time.astimezone(LAGOS_TZ)
        today = ref_wat.date()

        run_midnight = datetime(today.year, today.month, today.day, 0, 0, 0, tzinfo=LAGOS_TZ)
        run_retry = datetime(today.year, today.month, today.day, 6, 0, 0, tzinfo=LAGOS_TZ)
        next_midnight = run_midnight + timedelta(days=1)

        if ref_wat < run_retry:
            target = run_retry
            run_type = "0600-retry"
        else:
            target = next_midnight
            run_type = "midnight-primary"

        date_str = target.strftime("%Y-%m-%d")
        idempotency_key = f"prediction-cycle-{date_str}-{run_type}-wat"
        return run_type, target, idempotency_key

    def check_missed_cycles(self, ref_time: Optional[datetime] = None) -> Optional[str]:
        """
        Inspects whether the previous 6-hour cycle slot was missed.
        Returns a warning message if a missed slot is detected, else None.
        """
        if ref_time is None:
            ref_time = datetime.now(timezone.utc)
        elif ref_time.tzinfo is None:
            ref_time = ref_time.replace(tzinfo=timezone.utc)

        prev_time = ref_time - timedelta(hours=6)
        _, _, _, prev_key = self.get_wat_slot(prev_time)

        try:
            job = self.supabase.get_system_job_by_key(prev_key)
            if job is None:
                return f"MISSED_CYCLE_DETECTED: Previous slot {prev_key} was not executed"
            if job.get("status") != "completed":
                return f"INCOMPLETE_PREVIOUS_CYCLE: Previous slot {prev_key} has status {job.get('status')}"
            return None
        except Exception as exc:
            return f"CHECK_MISSED_CYCLE_ERROR: {exc}"

    def ensure_model_calibrated(self) -> None:
        """
        Pre-flight: Ingests verified historical training data from ESPN and calibrates
        the Dixon-Coles bivariate Poisson model parameters (rho, home advantage).
        """
        if len(self.dataset.matches) < 50:
            hist_configs = [
                ("ENG_PL", ["20240519", "20240513", "20240504", "20240427", "20240421", "20240414", "20240406", "20240403"]),
                ("BEL_PL", ["20240526", "20240519", "20240513", "20240505", "20240428", "20240424", "20240421"]),
                ("NED_ED", ["20240519", "20240512", "20240505", "20240428", "20240414", "20240407", "20240330"]),
                ("ESP_LL", ["20240526", "20240519", "20240515", "20240512", "20240505", "20240428"]),
                ("ITA_SA", ["20240526", "20240519", "20240512", "20240505", "20240428"]),
                ("GER_BL", ["20240518", "20240511", "20240504", "20240427", "20240420"]),
                ("FRA_L1", ["20240519", "20240512", "20240503", "20240428", "20240424"]),
                ("EUR_CL", ["20240601", "20240508", "20240501", "20240417", "20240416"])
            ]
            for l_code, dates in hist_configs:
                try:
                    self.dataset.fetch_historical_from_espn(l_code, dates)
                except Exception as exc:
                    print(f"[WARN] Failed historical fetch for {l_code}: {exc}")

        # Calibrate Dixon-Coles rho
        if len(self.dataset.matches) > 0:
            self.model.estimate_rho(self.dataset.matches)

    def execute_cycle(
        self,
        ref_time: Optional[datetime] = None,
        force: bool = False,
        limit_fixtures: int = 50
    ) -> PredictionCycleTelemetry:
        """
        Executes a single 6-hour prediction cycle for the given reference time.

        Enforces:
          - Database-backed distributed lock
          - Idempotency key per slot (rejects duplicate completion unless force=True)
          - Strict 4-day queue horizon (TODAY to +4 days in WAT)
          - Per-fixture isolation: failure on fixture i does not stop fixture i+1
          - Zero future data leakage (prediction_cutoff = kickoff)
          - Exactly 250,000 Monte Carlo draws per eligible fixture
          - >= 45.00% publication filter & 6 confidence tiers
          - Supabase persistence & audit logging
        """
        if ref_time is not None:
            if ref_time.tzinfo is None:
                start_time_utc = ref_time.replace(tzinfo=timezone.utc)
            else:
                start_time_utc = ref_time.astimezone(timezone.utc)
        else:
            start_time_utc = datetime.now(timezone.utc)
        start_perf = time.perf_counter()

        slot, slot_nominal_wat, next_nominal_wat, idempotency_key = self.get_wat_slot(ref_time)
        cycle_uuid = str(uuid.uuid4())
        cycle_id = f"{idempotency_key}-{cycle_uuid[:8]}"

        telemetry = PredictionCycleTelemetry(
            cycle_id=cycle_id,
            idempotency_key=idempotency_key,
            slot=slot,
            slot_time_wat=slot_nominal_wat.isoformat(),
            next_scheduled_wat=next_nominal_wat.isoformat(),
            status="RUNNING",
            started_at=start_time_utc,
            dataset_version="v1.0.0",
            model_version=self.model.model_version,
            calibration_version="v1.0.0"
        )

        print(f"\n==================================================================", flush=True)
        print(f" JamBets — 6-Hour Football Prediction Scheduler (WAT / Africa/Lagos)", flush=True)
        print(f" Cycle ID:       {cycle_id}", flush=True)
        print(f" Idempotency:    {idempotency_key}", flush=True)
        print(f" Nominal WAT:    {slot_nominal_wat.strftime('%Y-%m-%d %H:%M:%S WAT')} (Slot {slot})", flush=True)
        print(f" Next Run:       {next_nominal_wat.strftime('%Y-%m-%d %H:%M:%S WAT')}", flush=True)
        print(f"==================================================================", flush=True)

        # 1. Distributed Lock Acquisition
        lock_meta = {
            "cycle_id": cycle_id,
            "slot": slot,
            "slot_time_wat": slot_nominal_wat.isoformat(),
            "timezone": "Africa/Lagos (WAT)",
            "scheduler_type": "interval_6h"
        }
        acquired, job_id, reason = self.lock.acquire(
            idempotency_key=idempotency_key,
            extra_metadata=lock_meta
        )

        if not acquired and not force:
            duration_ms = (time.perf_counter() - start_perf) * 1000.0
            telemetry.status = "SKIPPED"
            telemetry.finished_at = datetime.now(timezone.utc)
            telemetry.duration_ms = round(duration_ms, 2)
            print(f"[LOCK] Cycle {idempotency_key} skipped: {reason}", flush=True)
            return telemetry

        try:
            # 2. Pre-flight: Calibrate Model & Dataset
            print("[STEP 1] Calibrating Dixon-Coles prediction model...", flush=True)
            self.ensure_model_calibrated()
            self.lock.heartbeat(job_id)

            # 3. Discover Fixtures strictly forward-looking from Cloud Supabase (target_kickoff_at >= TODAY)
            today_start_utc = datetime(start_time_utc.year, start_time_utc.month, start_time_utc.day, 0, 0, 0, tzinfo=timezone.utc)
            print("[STEP 2] Discovering candidate fixtures strictly forward-looking from Cloud Supabase (cutoff TODAY)...", flush=True)
            if hasattr(self.supabase, "get_forward_prediction_queue"):
                candidate_fixtures = self.supabase.get_forward_prediction_queue(
                    ref_time_utc=today_start_utc,
                    max_days=MAX_PREDICTION_WINDOW_DAYS,
                    limit=limit_fixtures
                )
            else:
                candidate_fixtures = self.supabase.get_prediction_queue(limit=limit_fixtures)
            telemetry.fixtures_discovered = len(candidate_fixtures)
            print(f"  • Retrieved {len(candidate_fixtures)} strictly future candidate fixtures in queue", flush=True)

            # 4. Filter Fixture Eligibility & Enforce 4-Day Horizon in WAT
            print("[STEP 3] Validating 4-day horizon & forward eligibility rules in WAT...", flush=True)
            eligible_fixtures = []
            now_wat = start_time_utc.astimezone(LAGOS_TZ)

            for f in candidate_fixtures:
                f_id = f.get("id")
                canonical_key = f.get("canonical_key", "")
                kickoff_str = f.get("target_kickoff_at")
                f_status = f.get("status", "scheduled")

                # Parse kickoff
                try:
                    kickoff_utc = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00"))
                    kickoff_wat = kickoff_utc.astimezone(LAGOS_TZ)
                except Exception as e:
                    telemetry.fixtures_skipped += 1
                    telemetry.errors.append({"fixture_id": f_id, "error": f"INVALID_KICKOFF_TIMESTAMP: {e}"})
                    continue

                # Rule: Must be scheduled or live
                if f_status not in ("scheduled", "live"):
                    telemetry.fixtures_skipped += 1
                    continue

                # Rule: Strict temporal isolation - must not be before cutoff today
                if kickoff_utc < today_start_utc:
                    telemetry.fixtures_skipped += 1
                    telemetry.errors.append({"fixture_id": f_id, "error": "STRICT_FORWARD_ISOLATION_EXCLUDED_PAST_MATCH"})
                    continue

                # Rule: 4-day maximum horizon in WAT (day 0 to day 4)
                delta_days = (kickoff_wat.date() - now_wat.date()).days
                if delta_days < 0 or delta_days > MAX_PREDICTION_WINDOW_DAYS:
                    telemetry.fixtures_skipped += 1
                    telemetry.errors.append({"fixture_id": f_id, "error": f"EXCEEDS_FOUR_DAY_WINDOW (offset: {delta_days} days)"})
                    continue

                # Rule: Check unresolved conflicts
                if self.supabase.has_unresolved_conflict(f_id):
                    telemetry.fixtures_skipped += 1
                    telemetry.errors.append({"fixture_id": f_id, "error": "UNRESOLVED_DATA_CONFLICT"})
                    continue

                eligible_fixtures.append((f, kickoff_utc))

            telemetry.fixtures_eligible = len(eligible_fixtures)
            print(f"  • {len(eligible_fixtures)} fixtures eligible for forward-looking Phase 4/5 pipeline", flush=True)

            # 5. Per-Fixture Isolated Execution Loop with Rate-Limiting & DATA_UNAVAILABLE Handling
            print("[STEP 4] Executing isolated per-fixture prediction & simulation pipeline (2.5s rate-limit delay)...", flush=True)

            for idx, (f, kickoff_utc) in enumerate(eligible_fixtures, 1):
                f_id = f.get("id")
                canonical_key = f.get("canonical_key")
                l_code = f.get("league_code")
                h_team = f.get("home_team_name")
                a_team = f.get("away_team_name")

                print(f"\n  [{idx}/{len(eligible_fixtures)}] Processing: {h_team} vs {a_team} ({l_code})", flush=True)
                print(f"      Canonical Key: {canonical_key}", flush=True)

                # Send lock heartbeat to prevent timeout on long cycles
                self.lock.heartbeat(job_id, {"current_fixture": canonical_key, "processed_count": telemetry.fixtures_processed})

                # Step A & B: Zero-Leakage Pre-Match Feature Extraction
                try:
                    features = self.feature_engine.compute_features(
                        fixture_id=f_id,
                        canonical_key=canonical_key,
                        league_code=l_code,
                        home_team_canonical=h_team,
                        away_team_canonical=a_team,
                        prediction_cutoff=kickoff_utc  # Strict zero future data leakage
                    )
                except Exception as exc:
                    telemetry.fixtures_failed += 1
                    telemetry.errors.append({"fixture_id": f_id, "error": f"FEATURE_EXTRACTION_ERROR: {exc}"})
                    print(f"      [FAILED] Feature extraction exception: {exc}", flush=True)
                    try:
                        self.supabase.update_fixture_status(f_id, "data_unavailable", reason=f"FEATURE_EXTRACTION_ERROR: {exc}")
                        print(f"      [DATA_UNAVAILABLE] Fixture {f_id} status marked as 'data_unavailable'", flush=True)
                    except Exception as patch_exc:
                        print(f"      [WARN] Could not update status: {patch_exc}", flush=True)
                    time.sleep(2.5)
                    continue

                # Step C: Check Feature Gate
                if not features.is_ready:
                    telemetry.fixtures_skipped += 1
                    print(f"      [GATE] NOT_READY: {features.not_ready_reason} (0 Sims, 0 Predictions)", flush=True)
                    try:
                        self.supabase.update_fixture_status(f_id, "data_unavailable", reason=f"NOT_READY: {features.not_ready_reason}")
                        print(f"      [DATA_UNAVAILABLE] Fixture {f_id} status marked as 'data_unavailable'", flush=True)
                    except Exception as patch_exc:
                        print(f"      [WARN] Could not update status: {patch_exc}", flush=True)
                    time.sleep(2.5)
                    continue

                # Step D, E & F: Phase 5 Simulation & Publication Pipeline with Transient Retry
                res = None
                last_err = None

                for attempt in range(1, self.max_retries + 1):
                    try:
                        res = self.pipeline.process_fixture_simulation(
                            fixture_id=f_id,
                            canonical_key=canonical_key,
                            features=features,
                            kickoff_utc=kickoff_utc,
                            persist_to_supabase=True
                        )
                        break  # Success
                    except Exception as exc:
                        last_err = exc
                        telemetry.retried_count += 1
                        print(f"      [RETRY] Attempt {attempt}/{self.max_retries} failed for {canonical_key}: {exc}", flush=True)
                        if attempt < self.max_retries:
                            backoff = self.RETRY_BACKOFF_SECONDS[min(attempt - 1, len(self.RETRY_BACKOFF_SECONDS) - 1)]
                            time.sleep(backoff)

                if res is None:
                    telemetry.fixtures_failed += 1
                    telemetry.errors.append({"fixture_id": f_id, "error": f"PIPELINE_RETRY_EXHAUSTED: {last_err}"})
                    print(f"      [FAILED] Retries exhausted for {canonical_key}", flush=True)
                    try:
                        self.supabase.update_fixture_status(f_id, "data_unavailable", reason=f"PIPELINE_RETRY_EXHAUSTED: {last_err}")
                        print(f"      [DATA_UNAVAILABLE] Fixture {f_id} status marked as 'data_unavailable'", flush=True)
                    except Exception as patch_exc:
                        print(f"      [WARN] Could not update status: {patch_exc}", flush=True)
                    time.sleep(2.5)
                    continue

                # Check Pipeline Result
                if res.status == "PUBLISHED":
                    telemetry.fixtures_processed += 1
                    telemetry.simulations_completed += 1
                    telemetry.total_simulated_draws += 250000
                    telemetry.predictions_published += res.persisted_predictions_count

                    sim = res.simulation_result
                    primary = res.primary_prediction
                    print(f"      [SUCCESS] 250,000 Draws completed in {sim.duration_ms:.1f}ms (Job: {sim.job.simulation_job_id[:8]}...)", flush=True)
                    print(f"      [SNIPER PUBLISHED] 1 Primary row published with {len(res.secondary_predictions)} secondary markets:", flush=True)
                    if primary:
                        tier_str = str(getattr(primary, 'confidence_tier', ''))
                        market_str = str(getattr(primary, 'market_name', ''))
                        outcome_str = str(getattr(primary, 'outcome', ''))
                        prob_val = getattr(primary, 'probability_pct', 0.0)
                        try:
                            prob_str = f"{float(prob_val):.2f}%"
                        except (ValueError, TypeError):
                            prob_str = f"{prob_val}%"
                        print(f"        [PRIMARY] [{tier_str:15}] {market_str:15} -> {outcome_str:12}: {prob_str}", flush=True)
                    for s in res.secondary_predictions:
                        print(f"        [SECONDARY] [{s.get('confidence_tier'):15}] {s.get('market'):15} -> {s.get('prediction'):12}: {s.get('prob')}%", flush=True)

                elif res.status == "SIMULATION_FAILED":
                    telemetry.fixtures_failed += 1
                    telemetry.errors.append({"fixture_id": f_id, "error": res.not_ready_reason})
                    print(f"      [GATE] SIMULATION FAILED: {res.not_ready_reason}", flush=True)
                    try:
                        self.supabase.update_fixture_status(f_id, "data_unavailable", reason=f"SIMULATION_FAILED: {res.not_ready_reason}")
                        print(f"      [DATA_UNAVAILABLE] Fixture {f_id} status marked as 'data_unavailable'", flush=True)
                    except Exception as patch_exc:
                        print(f"      [WARN] Could not update status: {patch_exc}", flush=True)
                else:
                    telemetry.fixtures_skipped += 1
                    print(f"      [STATUS] {res.status}", flush=True)

                # Strict Rate-Limiting delay between each fixture
                print(f"      [RATE-LIMIT] Enforcing 2.5s delay before next fixture...", flush=True)
                time.sleep(2.5)

            # 6. Finalize Cycle Telemetry
            duration_ms = (time.perf_counter() - start_perf) * 1000.0
            telemetry.status = "COMPLETED"
            telemetry.finished_at = datetime.now(timezone.utc)
            telemetry.duration_ms = round(duration_ms, 2)

            # Release Distributed Lock
            final_meta = {
                "cycle_id": cycle_id,
                "idempotency_key": idempotency_key,
                "slot": slot,
                "slot_time_wat": slot_nominal_wat.isoformat(),
                "next_scheduled_wat": next_nominal_wat.isoformat(),
                "duration_ms": telemetry.duration_ms,
                "fixtures_discovered": telemetry.fixtures_discovered,
                "fixtures_eligible": telemetry.fixtures_eligible,
                "fixtures_processed": telemetry.fixtures_processed,
                "predictions_published": telemetry.predictions_published,
                "fixtures_skipped": telemetry.fixtures_skipped,
                "fixtures_failed": telemetry.fixtures_failed,
                "retried_count": telemetry.retried_count,
                "simulations_completed": telemetry.simulations_completed,
                "total_simulated_draws": telemetry.total_simulated_draws,
                "errors_count": len(telemetry.errors)
            }
            self.lock.release(
                job_id=job_id,
                status="completed",
                items_processed=telemetry.fixtures_processed,
                items_failed=telemetry.fixtures_failed,
                final_metadata=final_meta
            )

            # Record Audit Log in Cloud Supabase
            self.supabase.record_audit_log(
                actor_type="scheduler",
                action="prediction_cycle_completed",
                resource_type="system_jobs",
                resource_id=job_id,
                details=final_meta
            )

            print(f"\n==================================================================", flush=True)
            print(f" Phase 6 Prediction Cycle Completed (WAT)", flush=True)
            print(f"  • Total Discovered:     {telemetry.fixtures_discovered}", flush=True)
            print(f"  • Eligible:             {telemetry.fixtures_eligible}", flush=True)
            print(f"  • Processed & 250k Sims: {telemetry.fixtures_processed}", flush=True)
            print(f"  • Predictions Published: {telemetry.predictions_published} (>=45.00%)", flush=True)
            print(f"  • Skipped (NOT_READY):  {telemetry.fixtures_skipped}", flush=True)
            print(f"  • Failed:               {telemetry.fixtures_failed}", flush=True)
            print(f"  • Retries:              {telemetry.retried_count}", flush=True)
            print(f"  • Total Draws:          {telemetry.total_simulated_draws:,}", flush=True)
            print(f"  • Cycle Duration:       {telemetry.duration_ms:.1f}ms", flush=True)
            print(f"==================================================================", flush=True)

            return telemetry

        except Exception as exc:
            duration_ms = (time.perf_counter() - start_perf) * 1000.0
            telemetry.status = "FAILED"
            telemetry.finished_at = datetime.now(timezone.utc)
            telemetry.duration_ms = round(duration_ms, 2)
            telemetry.errors.append({"fatal_cycle_error": str(exc)})

            print(f"[FATAL] Prediction cycle failed: {exc}", flush=True)
            self.lock.release(
                job_id=job_id,
                status="failed",
                error_message=str(exc),
                final_metadata={"fatal_error": str(exc)}
            )
            return telemetry

class AdminTaskPoller(threading.Thread):
    """
    Lightweight background worker polling Cloud Supabase admin_tasks every 30 seconds
    to execute manual engine override triggers on demand from the React UI.
    """
    def __init__(self, scheduler: "PredictionCycleScheduler", poll_interval: float = 30.0):
        super().__init__(daemon=True, name="AdminTaskPoller")
        self.scheduler = scheduler
        self.poll_interval = poll_interval
        self._stop_event = threading.Event()

    def stop(self):
        self._stop_event.set()

    def run(self):
        print(f"[POLLER] Admin task poller thread started (polling every {self.poll_interval}s)...", flush=True)
        while not self._stop_event.is_set():
            try:
                self.poll_and_execute()
            except Exception as exc:
                print(f"[POLLER ERROR] Error during admin task check: {exc}", flush=True)

            self._stop_event.wait(self.poll_interval)
        print("[POLLER] Admin task poller thread stopped.", flush=True)

    def poll_and_execute(self):
        pending_tasks = self.scheduler.supabase.get_pending_admin_tasks()
        if not pending_tasks:
            return

        for task in pending_tasks:
            task_id = task["id"]
            task_name = task.get("task_name", "").upper().strip()
            print(f"\n[POLLER] Found PENDING admin task: {task_name} (ID: {task_id})", flush=True)

            # Mark as RUNNING
            self.scheduler.supabase.update_admin_task(task_id, status="RUNNING")

            try:
                if task_name in ("RUN_PREDICTIONS", "RUN_PREDICTION_ENGINE", "RUN_SIMULATIONS", "RUN_SIMULATION_ENGINE", "SIMULATE", "RUN_PREDICTION"):
                    print("[POLLER] Executing forward-looking prediction cycle (forced override)...", flush=True)
                    telemetry = self.scheduler.execute_cycle(force=True)
                    status = "COMPLETED" if telemetry.status in ("COMPLETED", "SKIPPED") else "FAILED"
                    self.scheduler.supabase.update_admin_task(
                        task_id=task_id,
                        status=status,
                        metadata={
                            "cycle_id": telemetry.cycle_id,
                            "processed": telemetry.fixtures_processed,
                            "published": telemetry.predictions_published,
                            "skipped": telemetry.fixtures_skipped,
                            "failed": telemetry.fixtures_failed,
                            "duration_ms": telemetry.duration_ms
                        }
                    )
                    print(f"[POLLER] Admin task {task_name} finished with status: {status}", flush=True)

                elif task_name in ("RUN_SETTLEMENTS", "RUN_SETTLEMENT_ENGINE"):
                    print("[POLLER] Executing settlement cycle (backward-looking override)...", flush=True)
                    from python.src.football.settlement_scheduler import SettlementScheduler
                    settler = SettlementScheduler(supabase_client=self.scheduler.supabase)
                    result = settler.run_settlement_cycle()
                    self.scheduler.supabase.update_admin_task(
                        task_id=task_id,
                        status="COMPLETED",
                        metadata=result
                    )
                    print(f"[POLLER] Admin task {task_name} finished successfully", flush=True)

                else:
                    self.scheduler.supabase.update_admin_task(
                        task_id=task_id,
                        status="FAILED",
                        error_message=f"Unknown task_name: {task_name}"
                    )
            except Exception as exc:
                print(f"[POLLER ERROR] Failed executing admin task {task_name}: {exc}", flush=True)
                self.scheduler.supabase.update_admin_task(
                    task_id=task_id,
                    status="FAILED",
                    error_message=str(exc)
                )


    def run_daemon(self) -> None:
        """
        Runs the scheduler daemon indefinitely:
        1. Launches 30-second AdminTaskPoller background worker.
        2. Aligns daily primary runs to Midnight (00:00 WAT) and 6:00 AM WAT retry fallback.
        """
        def handle_signal(signum, frame):
            print("\n[INFO] Scheduler daemon received termination signal. Shutting down gracefully...", flush=True)
            self._shutdown_requested = True
            if poller:
                poller.stop()

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)

        print(f"[DAEMON] JamBets Football Prediction Scheduler Daemon started (Lagos Timezone — WAT).", flush=True)
        print(f"         Primary Schedule: Midnight (00:00 WAT). Fallback Retry: 6:00 AM WAT.", flush=True)

        # 1. Start Admin Task Poller (30s polling)
        poller = AdminTaskPoller(scheduler=self, poll_interval=30.0)
        poller.start()

        # 2. Check missed cycles on startup
        missed = self.check_missed_cycles()
        if missed:
            print(f"[DAEMON ALERT] {missed}", flush=True)

        # 3. Continuous scheduling loop aligned to Midnight and 6 AM retry
        while not self._shutdown_requested:
            run_type, next_nominal_wat, _ = self.get_next_run_wat()
            now_wat = datetime.now(timezone.utc).astimezone(LAGOS_TZ)
            sleep_seconds = max(1.0, (next_nominal_wat - now_wat).total_seconds())

            print(f"[DAEMON] Next scheduled cycle: [{run_type}] at {next_nominal_wat.strftime('%Y-%m-%d %H:%M:%S WAT')} (sleeping {int(sleep_seconds)}s)...", flush=True)

            # Sleep in chunks to allow responsive termination
            chunk = 10.0
            elapsed = 0.0
            while elapsed < sleep_seconds and not self._shutdown_requested:
                time.sleep(min(chunk, sleep_seconds - elapsed))
                elapsed += chunk

            if not self._shutdown_requested:
                res = self.execute_cycle()
                # If primary midnight run failed, log alert
                if run_type == "midnight-primary" and res.status == "FAILED":
                    print("[DAEMON ALERT] Midnight primary cycle failed. 06:00 AM retry fallback will trigger.", flush=True)

        poller.stop()
        poller.join(timeout=5.0)
        print("[DAEMON] Scheduler daemon stopped.", flush=True)


def main():
    import argparse
    parser = argparse.ArgumentParser(description="JamBets Football Prediction Scheduler (WAT)")
    parser.add_argument("--run-once", action="store_true", help="Execute single forward prediction cycle and exit")
    parser.add_argument("--daemon", action="store_true", help="Run continuous scheduler daemon with 30s admin poller")
    parser.add_argument("--poll", action="store_true", help="Run 30-second admin tasks poller worker directly")
    parser.add_argument("--poll-interval", type=float, default=30.0, help="Poller interval in seconds (default: 30.0)")
    parser.add_argument("--force", action="store_true", help="Force cycle execution even if already completed")
    args = parser.parse_args()

    scheduler = PredictionCycleScheduler()

    if args.poll:
        print("[POLLER] Starting standalone 30s admin tasks poller...", flush=True)
        poller = AdminTaskPoller(scheduler=scheduler, poll_interval=args.poll_interval)
        poller.start()
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            print("\n[POLLER] Stopping poller...", flush=True)
            poller.stop()
            poller.join()
            sys.exit(0)

    elif args.daemon:
        scheduler.run_daemon()
    else:
        # Default or --run-once
        res = scheduler.execute_cycle(force=args.force)
        sys.exit(0 if res.status in ("COMPLETED", "SKIPPED") else 1)


if __name__ == "__main__":
    main()

