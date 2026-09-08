"""
JamBets — Automatic 15-Minute Football Settlement Scheduler & Orchestrator
Strictly aligned to Lagos Timezone (WAT, UTC+1 / Africa/Lagos).
Monitors verified live match feeds, synchronizes match states to Cloud Supabase,
and settles published predictions deterministically.
"""

import os
import sys
import time
import uuid
import socket
import argparse
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.config import LEAGUE_REGISTRY, LeagueConfig
from python.src.football.models import FixtureStatus
from python.src.football.live_monitor import LiveMonitorEngine, LiveMatchState
from python.src.football.settlement_engine import SettlementEngine, SettlementDecision, SettlementStatus
from python.src.football.scheduler_lock import DistributedSchedulerLock
from python.src.sources.espn import ESPNAdapter
from python.src.sources.livescore import LiveScoreAdapter

load_dotenv()

# Lagos Timezone (WAT: UTC+1)
try:
    from zoneinfo import ZoneInfo
    WAT_TZ = ZoneInfo("Africa/Lagos")
except Exception:
    WAT_TZ = timezone(timedelta(hours=1), name="WAT")


class SettlementScheduler:
    """
    Automatic 15-Minute Football Live Data & Settlement Scheduler.
    Executes in Lagos Timezone (WAT) with database-backed distributed locking,
    idempotency keys, multi-source validation, and deterministic settlement rules.
    """

    JOB_TYPE = "settlement_engine"
    SLOT_DURATION_MINUTES = 15

    def __init__(
        self,
        supabase_client: Optional[CloudSupabaseClient] = None,
        worker_id: Optional[str] = None
    ):
        self.supabase = supabase_client or CloudSupabaseClient()
        self.worker_id = worker_id or f"{socket.gethostname()}-settle-{os.getpid()}-{uuid.uuid4().hex[:8]}"
        self.lock = DistributedSchedulerLock(
            supabase=self.supabase,
            worker_id=self.worker_id
        )
        self.espn_adapter = ESPNAdapter()
        self.livescore_adapter = LiveScoreAdapter()

    @classmethod
    def get_wat_now(cls) -> datetime:
        """Returns the current datetime in Lagos Timezone (WAT)."""
        return datetime.now(WAT_TZ)

    @classmethod
    def calculate_slot(cls, dt_wat: Optional[datetime] = None) -> Tuple[int, datetime, datetime, str]:
        """
        Calculates the 15-minute slot in Lagos Timezone (WAT).
        96 slots per day:
        Slot 0: 00:00 WAT, Slot 1: 00:15 WAT, ..., Slot 95: 23:45 WAT.
        Returns: (slot_index, nominal_slot_time_wat, next_slot_time_wat, idempotency_key)
        """
        now = dt_wat or cls.get_wat_now()
        slot_index = now.hour * 4 + (now.minute // 15)

        nominal_min = (now.minute // 15) * 15
        nominal_slot_wat = now.replace(minute=nominal_min, second=0, microsecond=0)
        next_slot_wat = nominal_slot_wat + timedelta(minutes=15)

        date_str = nominal_slot_wat.strftime("%Y-%m-%d")
        idempotency_key = f"settlement-cycle-{date_str}-slot{slot_index:02d}-wat"

        return slot_index, nominal_slot_wat, next_slot_wat, idempotency_key

    def run_settlement_cycle(
        self,
        slot_override: Optional[int] = None,
        force_now_wat: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Executes a single 15-minute settlement cycle:
        1. Aligns to WAT slot & derives idempotency key
        2. Acquires distributed database lock on Cloud Supabase
        3. Identifies monitored fixtures
        4. Ingests fresh verified data from approved sources
        5. Synchronizes match states & events to Cloud Supabase
        6. Evaluates unsettled predictions deterministically
        7. Persists immutable settlement decisions
        8. Releases lock with status 'completed' and records audit log
        """
        wat_now = force_now_wat or self.get_wat_now()
        slot_idx, nominal_wat, next_wat, idempotency_key = self.calculate_slot(wat_now)

        if slot_override is not None:
            slot_idx = slot_override
            date_str = nominal_wat.strftime("%Y-%m-%d")
            idempotency_key = f"settlement-cycle-{date_str}-slot{slot_idx:02d}-wat"

        cycle_id = f"{idempotency_key}-{uuid.uuid4().hex[:8]}"
        start_perf = time.perf_counter()
        cycle_start_utc = datetime.now(timezone.utc)

        print("\n" + "=" * 66)
        print(" JamBets • 15-Minute Live Data & Settlement Scheduler (WAT)")
        print(f" Cycle ID:       {cycle_id}")
        print(f" Idempotency:    {idempotency_key}")
        print(f" Nominal WAT:    {nominal_wat.strftime('%Y-%m-%d %H:%M:%S')} WAT (Slot {slot_idx})")
        print(f" Next Run:       {next_wat.strftime('%Y-%m-%d %H:%M:%S')} WAT")
        print("=" * 66)

        # Step 1: Distributed Lock Acquisition
        extra_meta = {
            "cycle_id": cycle_id,
            "slot": slot_idx,
            "slot_time_wat": nominal_wat.isoformat(),
            "next_scheduled_wat": next_wat.isoformat(),
            "timezone": "Africa/Lagos (WAT)",
            "scheduler_type": "interval_15m"
        }

        acquired, job_id, lock_reason = self.lock.acquire(
            idempotency_key=idempotency_key,
            extra_metadata=extra_meta,
            timeout_minutes=10,
            job_type=self.JOB_TYPE
        )

        if not acquired:
            print(f"[LOCK] Settlement cycle {idempotency_key} skipped: {lock_reason}")
            return {
                "status": "SKIPPED",
                "reason": lock_reason,
                "cycle_id": cycle_id,
                "idempotency_key": idempotency_key
            }

        print(f"[LOCK] Distributed lock acquired: {lock_reason} (Job ID: {job_id})")

        stats = {
            "cycle_id": cycle_id,
            "idempotency_key": idempotency_key,
            "fixtures_inspected": 0,
            "fixtures_live": 0,
            "fixtures_finished": 0,
            "predictions_inspected": 0,
            "predictions_settled": 0,
            "settled_won": 0,
            "settled_lost": 0,
            "settled_void": 0,
            "predictions_pending": 0,
            "conflicts_detected": 0,
            "errors_count": 0,
            "duration_ms": 0.0
        }

        try:
            # Step 2: Retrieve Candidate Fixtures from Cloud Supabase
            print("[STEP 1] Retrieving monitored candidate fixtures from Cloud Supabase...")
            candidate_fixtures = self.supabase.get_active_fixtures_for_monitoring(limit=100)
            stats["fixtures_inspected"] = len(candidate_fixtures)
            print(f"  • Retrieved {len(candidate_fixtures)} monitored fixtures")

            # Step 3: Ingest Fresh Live/Result Feeds from Approved Sources
            print("[STEP 2] Querying verified feeds from approved sources (ESPN, LiveScore)...")
            live_payloads_by_key: Dict[str, List[Any]] = {}

            # Collect active leagues
            leagues_in_play = set(f.get("league_code") for f in candidate_fixtures if f.get("league_code"))
            for league_code in leagues_in_play:
                league_cfg = LEAGUE_REGISTRY.get(league_code)
                if not league_cfg:
                    continue

                # Query ESPN scoreboard
                try:
                    today_utc = datetime.now(timezone.utc)
                    espn_fixtures = self.espn_adapter.fetch_fixtures(
                        league_cfg,
                        today_utc - timedelta(days=1),
                        today_utc + timedelta(days=1)
                    )
                    for raw in espn_fixtures:
                        key = f"{league_code}:{raw.home_team_name.lower().replace(' ', '-')}:{raw.away_team_name.lower().replace(' ', '-')}:{raw.kickoff_time.strftime('%Y%m%d')}"
                        live_payloads_by_key.setdefault(key, []).append(raw)
                except Exception as e:
                    print(f"  [WARN] ESPN fetch error for {league_code}: {e}")

            # Step 4: Process Each Fixture with Isolation
            print("[STEP 3] Synchronizing live states and evaluating predictions...")
            self.lock.heartbeat(job_id)

            for idx, fix in enumerate(candidate_fixtures, 1):
                fix_id = fix.get("id")
                canonical_key = fix.get("canonical_key", "")
                kickoff_str = fix.get("target_kickoff_at") or fix.get("kickoff_at")

                try:
                    kickoff_dt = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00")) if kickoff_str else datetime.now(timezone.utc)
                except Exception:
                    kickoff_dt = datetime.now(timezone.utc)

                try:
                    # Multi-source reconciliation for this fixture
                    source_payloads = live_payloads_by_key.get(canonical_key, [])
                    match_state = LiveMonitorEngine.reconcile_multi_sources(
                        fixture_id=fix_id,
                        canonical_key=canonical_key,
                        scheduled_kickoff=kickoff_dt,
                        source_payloads=source_payloads,
                        now_utc=datetime.now(timezone.utc)
                    )

                    if match_state.has_conflict:
                        stats["conflicts_detected"] += 1
                        print(f"  [{idx}/{len(candidate_fixtures)}] CONFLICT on {canonical_key}: {match_state.conflict_reason}")
                        # Persist conflict to audit table
                        self.supabase.record_audit_log(
                            actor_type="system",
                            action="settlement_source_conflict",
                            resource_type="football_fixtures",
                            resource_id=fix_id,
                            details={"reason": match_state.conflict_reason, "canonical_key": canonical_key}
                        )

                    # Update live state in football_fixtures if verified data exists
                    if match_state.is_verified and source_payloads:
                        update_payload = {
                            "status": match_state.status.value,
                            "home_score": match_state.home_score,
                            "away_score": match_state.away_score,
                            "match_minute": match_state.match_minute,
                            "period": match_state.period,
                            "half_time_home_score": match_state.half_time_home_score,
                            "half_time_away_score": match_state.half_time_away_score,
                            "corners_home": match_state.corners_home,
                            "corners_away": match_state.corners_away,
                            "last_synced_at": datetime.now(timezone.utc).isoformat()
                        }
                        self.supabase.update_fixture_live_state(fix_id, update_payload)

                        # If finished, record official result respecting check_verified_has_min_sources
                        if match_state.status == FixtureStatus.FINISHED and match_state.home_score is not None:
                            stats["fixtures_finished"] += 1
                            sources_cnt = len(match_state.sources_verified)
                            now_iso = datetime.now(timezone.utc).isoformat()
                            is_multi_source = sources_cnt >= 2
                            self.supabase.record_football_result({
                                "fixture_id": fix_id,
                                "home_score": match_state.home_score,
                                "away_score": match_state.away_score,
                                "status": "verified" if is_multi_source else "pending",
                                "verification_timestamp": now_iso if is_multi_source else None,
                                "agreeing_sources_count": sources_cnt
                            })
                        elif match_state.status == FixtureStatus.LIVE:
                            stats["fixtures_live"] += 1

                    # Step 5: Evaluate Published Predictions for this Fixture
                    unsettled_preds = self.supabase.get_unsettled_predictions(fix_id)
                    stats["predictions_inspected"] += len(unsettled_preds)

                    for pred in unsettled_preds:
                        # Deterministic rule evaluation
                        decision = SettlementEngine.evaluate(
                            prediction=pred,
                            match_state=match_state,
                            now_utc=datetime.now(timezone.utc)
                        )

                        if decision.status in (SettlementStatus.WON, SettlementStatus.LOST, SettlementStatus.VOID):
                            stats["predictions_settled"] += 1
                            if decision.status == SettlementStatus.WON:
                                stats["settled_won"] += 1
                            elif decision.status == SettlementStatus.LOST:
                                stats["settled_lost"] += 1
                            elif decision.status == SettlementStatus.VOID:
                                stats["settled_void"] += 1

                            # Persist settlement record
                            settle_record = {
                                "prediction_id": pred["id"],
                                "status": decision.status.value,
                                "actual_score": decision.actual_score,
                                "settlement_timestamp": (decision.settled_at or datetime.now(timezone.utc)).isoformat(),
                                "settled_by": decision.settled_by,
                                "notes": decision.notes
                            }
                            self.supabase.upsert_settlement(settle_record)
                            early_tag = "[EARLY] " if decision.is_early_settlement else ""
                            print(f"    • {early_tag}SETTLED: {pred.get('market')} ({pred.get('prediction')}) -> {decision.status.value.upper()} ({decision.notes})")
                        else:
                            stats["predictions_pending"] += 1

                except Exception as ex:
                    stats["errors_count"] += 1
                    print(f"  [ERROR] Isolated fixture failure on {canonical_key}: {ex}")

                # Refresh heartbeat periodically
                if idx % 10 == 0:
                    self.lock.heartbeat(job_id)

            duration_ms = round((time.perf_counter() - start_perf) * 1000.0, 2)
            stats["duration_ms"] = duration_ms

            # Step 6: Complete Job and Release Lock
            merged_meta = dict(extra_meta)
            merged_meta.update(stats)

            self.lock.release(
                job_id=job_id,
                status="completed",
                items_processed=stats["predictions_settled"],
                final_metadata=merged_meta
            )

            # Record final audit log
            self.supabase.record_audit_log(
                actor_type="system",
                action="settlement_cycle_completed",
                resource_type="system_jobs",
                resource_id=job_id,
                details=stats
            )

            print("\n" + "=" * 66)
            print(" Phase 7 Settlement Cycle Completed (WAT)")
            print(f"  • Fixtures Inspected:     {stats['fixtures_inspected']}")
            print(f"  • Live Fixtures:          {stats['fixtures_live']}")
            print(f"  • Finished Fixtures:      {stats['fixtures_finished']}")
            print(f"  • Predictions Inspected:  {stats['predictions_inspected']}")
            print(f"  • Predictions Settled:    {stats['predictions_settled']}")
            print(f"    - WON:                  {stats['settled_won']}")
            print(f"    - LOST:                 {stats['settled_lost']}")
            print(f"    - VOID:                 {stats['settled_void']}")
            print(f"  • Remaining Pending:      {stats['predictions_pending']}")
            print(f"  • Conflicts Detected:     {stats['conflicts_detected']}")
            print(f"  • Cycle Duration:         {duration_ms}ms")
            print("=" * 66 + "\n")

            return stats

        except Exception as fatal_ex:
            duration_ms = round((time.perf_counter() - start_perf) * 1000.0, 2)
            print(f"[FATAL] Settlement cycle failed: {fatal_ex}")
            self.lock.release(
                job_id=job_id,
                status="failed",
                error_message=str(fatal_ex),
                final_metadata={"fatal_error": str(fatal_ex), "duration_ms": duration_ms}
            )
            raise fatal_ex

    def run_daemon(self):
        """Runs the settlement scheduler continuously every 15 minutes."""
        print(f"[*] Starting JamBets 15-Minute Settlement Daemon on worker {self.worker_id} (WAT)...")
        while True:
            now_wat = self.get_wat_now()
            self.run_settlement_cycle()

            # Sleep until next 15-minute slot
            _, _, next_wat, _ = self.calculate_slot(now_wat)
            sleep_seconds = max(5.0, (next_wat - self.get_wat_now()).total_seconds() + 2.0)
            print(f"[*] Sleeping {sleep_seconds:.1f}s until next slot: {next_wat.strftime('%H:%M:%S')} WAT...")
            time.sleep(sleep_seconds)


def main():
    parser = argparse.ArgumentParser(description="JamBets 15-Minute Football Live Data & Settlement Scheduler")
    parser.add_argument("--run-once", action="store_true", help="Execute single 15-minute cycle and exit")
    parser.add_argument("--daemon", action="store_true", help="Run daemon continuously every 15 minutes")
    parser.add_argument("--slot", type=int, default=None, help="Explicit slot override (0-95)")
    args = parser.parse_args()

    scheduler = SettlementScheduler()

    if args.daemon:
        scheduler.run_daemon()
    else:
        scheduler.run_settlement_cycle(slot_override=args.slot)


if __name__ == "__main__":
    main()
