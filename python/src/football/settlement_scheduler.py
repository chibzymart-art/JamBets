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
        force_now_wat: Optional[datetime] = None,
        force: bool = False
    ) -> Dict[str, Any]:
        """
        Executes a single 15-minute settlement cycle:
        1. Aligns to WAT slot & derives idempotency key
        2. Acquires distributed database lock on Cloud Supabase
        3. Identifies monitored fixtures
        4. Ingests fresh verified data from approved sources (LiveScore & ESPN)
        5. Synchronizes match states & events to Cloud Supabase
        6. Evaluates unsettled predictions deterministically
        7. Persists immutable settlement decisions
        8. Releases lock with status 'completed' and records audit log
        """
        from python.src.football.identity import CanonicalIdentityResolver
        from python.src.football.models import CanonicalFixture

        wat_now = force_now_wat or self.get_wat_now()
        slot_idx, nominal_wat, next_wat, idempotency_key = self.calculate_slot(wat_now)

        if force:
            # Bypass slot collision for manual on-demand execution
            idempotency_key = f"settlement-manual-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6]}"
        elif slot_override is not None:
            slot_idx = slot_override
            date_str = nominal_wat.strftime("%Y-%m-%d")
            idempotency_key = f"settlement-cycle-{date_str}-slot{slot_idx:02d}-wat"

        cycle_id = f"{idempotency_key}-{uuid.uuid4().hex[:8]}"
        start_perf = time.perf_counter()
        cycle_start_utc = datetime.now(timezone.utc)

        print("\n" + "=" * 66)
        print(" JamBets • Live Data Scraper & Deterministic Settlement Engine (WAT)")
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
            "scheduler_type": "interval_15m",
            "forced": force
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
            candidate_fixtures = self.supabase.get_active_fixtures_for_monitoring(limit=500)

            # Augment with any fixtures that have unsettled predictions
            try:
                unsettled_all = self.supabase.get_unsettled_predictions()
                unsettled_fix_ids = {p.get("fixture_id") for p in unsettled_all if p.get("fixture_id")}
                candidate_fix_ids = {f.get("id") for f in candidate_fixtures}
                missing_ids = unsettled_fix_ids - candidate_fix_ids
                if missing_ids:
                    print(f"  • Augmenting candidate list with {len(missing_ids)} fixtures from unsettled predictions...")
                    for m_id in list(missing_ids)[:150]:
                        m_fixes = self.supabase.get("football_prediction_queue", {"id": f"eq.{m_id}", "limit": "1"})
                        if not m_fixes:
                            m_fixes = self.supabase.get("football_fixtures", {"id": f"eq.{m_id}", "limit": "1"})
                        if m_fixes:
                            candidate_fixtures.append(m_fixes[0])
                            candidate_fix_ids.add(m_fixes[0].get("id"))

                # Also augment with any fixtures in football_fixtures kicking off in [-36h, +36h]
                try:
                    w_start = (datetime.now(timezone.utc) - timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%SZ")
                    w_end = (datetime.now(timezone.utc) + timedelta(hours=36)).strftime("%Y-%m-%dT%H:%M:%SZ")
                    recent_fixtures = self.supabase.get("football_fixtures", {
                        "target_kickoff_at": f"gte.{w_start}",
                        "order": "target_kickoff_at.asc",
                        "limit": "200"
                    })
                    recent_added = 0
                    for rf in recent_fixtures:
                        if rf.get("id") not in candidate_fix_ids:
                            candidate_fixtures.append(rf)
                            candidate_fix_ids.add(rf.get("id"))
                            recent_added += 1
                    if recent_added > 0:
                        print(f"  • Augmenting candidate list with {recent_added} recent window fixtures...")
                except Exception as w_err:
                    print(f"  [NOTE] Window fixture augmentation: {w_err}")
            except Exception as aug_err:
                print(f"  [NOTE] Candidate fixture augmentation: {aug_err}")

            stats["fixtures_inspected"] = len(candidate_fixtures)
            print(f"  • Retrieved {len(candidate_fixtures)} monitored candidate fixtures")

            # Step 3: Ingest Fresh Live/Result Feeds from Approved Sources (LiveScore & ESPN)
            print("[STEP 2] Scraping verified match feeds from LiveScore & ESPN across active competitions...")
            live_payloads_by_key: Dict[str, List[Any]] = {}

            # Collect active leagues
            leagues_in_play = set(f.get("league_code") for f in candidate_fixtures if f.get("league_code"))
            if not leagues_in_play or force:
                leagues_in_play = set(LEAGUE_REGISTRY.keys())

            print(f"  • Ingesting feeds across {len(leagues_in_play)} competitions...")
            today_utc = datetime.now(timezone.utc)
            date_from = today_utc - timedelta(days=1)
            date_to = today_utc + timedelta(days=1)

            ls_count = 0
            espn_count = 0

            for league_code in leagues_in_play:
                league_cfg = LEAGUE_REGISTRY.get(league_code)
                if not league_cfg:
                    continue

                # 1. Query LiveScore verified scoreboard & livescores
                try:
                    ls_fixtures = self.livescore_adapter.fetch_fixtures(
                        league_cfg,
                        date_from,
                        date_to
                    )
                    for raw in ls_fixtures:
                        c_fix = CanonicalIdentityResolver.build_canonical_fixture(raw)
                        live_payloads_by_key.setdefault(c_fix.canonical_key, []).append(raw)
                        ls_count += 1
                except Exception as e:
                    print(f"  [WARN] LiveScore fetch error for {league_code}: {e}")

                # 2. Query ESPN verified scoreboard & livescores
                if league_cfg.espn_slug:
                    try:
                        espn_fixtures = self.espn_adapter.fetch_fixtures(
                            league_cfg,
                            date_from,
                            date_to
                        )
                        for raw in espn_fixtures:
                            c_fix = CanonicalIdentityResolver.build_canonical_fixture(raw)
                            live_payloads_by_key.setdefault(c_fix.canonical_key, []).append(raw)
                            espn_count += 1
                    except Exception as e:
                        print(f"  [WARN] ESPN fetch error for {league_code}: {e}")

            print(f"  [OK] Ingested {ls_count} LiveScore matches and {espn_count} ESPN matches across {len(live_payloads_by_key)} unique canonical keys.")

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
                    if not source_payloads:
                        parts = canonical_key.split(":") if ":" in canonical_key else []
                        l_code = fix.get("league_code") or (parts[0] if len(parts) >= 1 else "")
                        h_name = (parts[1] if len(parts) >= 2 else "") or CanonicalIdentityResolver.normalize_team_name(fix.get("home_team_name") or "")
                        a_name = (parts[2] if len(parts) >= 3 else "") or CanonicalIdentityResolver.normalize_team_name(fix.get("away_team_name") or "")
                        if l_code and h_name and a_name:
                            for delta in (0, -1, 1):
                                alt_date = (kickoff_dt + timedelta(days=delta)).strftime("%Y%m%d")
                                alt_key = f"{l_code}:{h_name}:{a_name}:{alt_date}"
                                if alt_key in live_payloads_by_key:
                                    source_payloads = live_payloads_by_key[alt_key]
                                    break

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
                            sources_cnt = len(getattr(match_state, "sources_verified", [])) or len(source_payloads) or 1
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
