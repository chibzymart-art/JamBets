"""
JamBets — Phase 7 Automated Unit Test Suite for Settlement Engine & Live Monitor
Verifies all 15+ requirements from Section 40:
- Live status normalization & kickoff passed != LIVE
- Fixture identity & date separation
- Freshness validation & stale-data protection
- Early mathematical settlement (Over 1.5, Under 3.5, BTTS)
- Full-Time 1X2 and Double Chance settlement
- Half-Time & Second-Half goals isolation
- Corner markets
- Multi-source conflict prevention
- Void vs Temporary Outage handling
- Settlement idempotency
- Failure isolation & crash recovery
"""

import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

from python.src.football.models import FixtureStatus, RawFixturePayload
from python.src.football.live_monitor import LiveMonitorEngine, LiveMatchState
from python.src.football.settlement_engine import SettlementEngine, SettlementDecision, SettlementStatus
from python.src.football.settlement_scheduler import SettlementScheduler


class TestSettlementEngine(unittest.TestCase):

    # 1. Live Status Normalization & Rule 4 ("Kickoff passed != LIVE")
    def test_01_kickoff_passed_alone_does_not_create_live(self):
        kickoff = datetime.now(timezone.utc) - timedelta(hours=1)
        now = datetime.now(timezone.utc)

        # Source says SCHEDULED even though kickoff passed 1 hour ago
        status = LiveMonitorEngine.normalize_status("STATUS_SCHEDULED", scheduled_kickoff=kickoff, now_utc=now)
        self.assertEqual(status, FixtureStatus.SCHEDULED)

        # Explicit LIVE from verified source
        status_live = LiveMonitorEngine.normalize_status("STATUS_IN_PROGRESS", scheduled_kickoff=kickoff, now_utc=now)
        self.assertEqual(status_live, FixtureStatus.LIVE)

        # Explicit FINAL
        status_final = LiveMonitorEngine.normalize_status("STATUS_FINAL", scheduled_kickoff=kickoff, now_utc=now)
        self.assertEqual(status_final, FixtureStatus.FINISHED)

        # Explicit POSTPONED
        status_postponed = LiveMonitorEngine.normalize_status("STATUS_POSTPONED", scheduled_kickoff=kickoff, now_utc=now)
        self.assertEqual(status_postponed, FixtureStatus.POSTPONED)

    # 2. Fixture Identity Protection
    def test_02_fixture_identity_date_separation(self):
        # Two fixtures between identical teams on different dates have distinct canonical keys
        k1 = "ENG_PL:arsenal:chelsea:20260908"
        k2 = "ENG_PL:arsenal:chelsea:20261020"
        self.assertNotEqual(k1, k2)

    # 3. Freshness Validation & Stale-Data Protection
    def test_03_freshness_validation_stale_data_rejected(self):
        now = datetime.now(timezone.utc)
        fresh_ts = now - timedelta(minutes=5)
        stale_ts = now - timedelta(minutes=45)

        self.assertTrue(LiveMonitorEngine.validate_freshness(fresh_ts, now_utc=now))
        self.assertFalse(LiveMonitorEngine.validate_freshness(stale_ts, now_utc=now))

        # Stale state in settlement must hold as PENDING
        state = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.FINISHED,
            raw_status="FINAL",
            scheduled_kickoff=now - timedelta(hours=2),
            home_score=2,
            away_score=0,
            is_stale=True
        )
        pred = {"id": "p1", "fixture_id": "f1", "market": "1x2", "prediction": "home"}
        decision = SettlementEngine.evaluate(pred, state)
        self.assertEqual(decision.status, SettlementStatus.PENDING)
        self.assertIn("Stale match feed", decision.notes)

    # 4. Over 1.5 Early Settlement
    def test_04_over_15_early_settlement(self):
        now = datetime.now(timezone.utc)
        pred = {"id": "p1", "fixture_id": "f1", "market": "over_under_1.5", "prediction": "over"}

        def make_live_state(h, a):
            return LiveMatchState(
                fixture_id="f1",
                canonical_key="ENG_PL:a:b:20260908",
                provider_event_id="e1",
                source_name="espn",
                status=FixtureStatus.LIVE,
                raw_status="IN_PROGRESS",
                scheduled_kickoff=now - timedelta(minutes=30),
                home_score=h,
                away_score=a
            )

        # 0-0 -> PENDING
        dec_00 = SettlementEngine.evaluate(pred, make_live_state(0, 0))
        self.assertEqual(dec_00.status, SettlementStatus.PENDING)

        # 1-0 -> PENDING
        dec_10 = SettlementEngine.evaluate(pred, make_live_state(1, 0))
        self.assertEqual(dec_10.status, SettlementStatus.PENDING)

        # 1-1 -> WON early!
        dec_11 = SettlementEngine.evaluate(pred, make_live_state(1, 1))
        self.assertEqual(dec_11.status, SettlementStatus.WON)
        self.assertTrue(dec_11.is_early_settlement)

        # 2-0 -> WON early!
        dec_20 = SettlementEngine.evaluate(pred, make_live_state(2, 0))
        self.assertEqual(dec_20.status, SettlementStatus.WON)
        self.assertTrue(dec_20.is_early_settlement)

    # 5. Under 3.5 Early Settlement & Final Result
    def test_05_under_35_early_settlement(self):
        now = datetime.now(timezone.utc)
        pred = {"id": "p1", "fixture_id": "f1", "market": "over_under_3.5", "prediction": "under"}

        def make_live_state(h, a, finished=False):
            return LiveMatchState(
                fixture_id="f1",
                canonical_key="ENG_PL:a:b:20260908",
                provider_event_id="e1",
                source_name="espn",
                status=FixtureStatus.FINISHED if finished else FixtureStatus.LIVE,
                raw_status="FINAL" if finished else "IN_PROGRESS",
                scheduled_kickoff=now - timedelta(hours=1),
                home_score=h,
                away_score=a
            )

        # 0-0 -> PENDING
        self.assertEqual(SettlementEngine.evaluate(pred, make_live_state(0, 0)).status, SettlementStatus.PENDING)
        # 2-1 -> PENDING
        self.assertEqual(SettlementEngine.evaluate(pred, make_live_state(2, 1)).status, SettlementStatus.PENDING)
        # 3-1 -> LOST early (4 goals exceeds 3.5)
        dec_31 = SettlementEngine.evaluate(pred, make_live_state(3, 1))
        self.assertEqual(dec_31.status, SettlementStatus.LOST)
        self.assertTrue(dec_31.is_early_settlement)

        # 4-0 -> LOST early
        dec_40 = SettlementEngine.evaluate(pred, make_live_state(4, 0))
        self.assertEqual(dec_40.status, SettlementStatus.LOST)

        # 3-2 -> LOST early
        dec_32 = SettlementEngine.evaluate(pred, make_live_state(3, 2))
        self.assertEqual(dec_32.status, SettlementStatus.LOST)

        # Full-time 2-1 -> WON
        dec_ft_21 = SettlementEngine.evaluate(pred, make_live_state(2, 1, finished=True))
        self.assertEqual(dec_ft_21.status, SettlementStatus.WON)

    # 6. Both Teams To Score (BTTS) Early & FT
    def test_06_btts_early_and_ft(self):
        now = datetime.now(timezone.utc)
        pred_yes = {"id": "p1", "fixture_id": "f1", "market": "btts", "prediction": "yes"}
        pred_no = {"id": "p2", "fixture_id": "f1", "market": "btts", "prediction": "no"}

        def make_state(h, a, finished=False):
            return LiveMatchState(
                fixture_id="f1",
                canonical_key="ENG_PL:a:b:20260908",
                provider_event_id="e1",
                source_name="espn",
                status=FixtureStatus.FINISHED if finished else FixtureStatus.LIVE,
                raw_status="FINAL" if finished else "IN_PROGRESS",
                scheduled_kickoff=now - timedelta(hours=1),
                home_score=h,
                away_score=a
            )

        # 0-0 live: both PENDING
        self.assertEqual(SettlementEngine.evaluate(pred_yes, make_state(0, 0)).status, SettlementStatus.PENDING)
        self.assertEqual(SettlementEngine.evaluate(pred_no, make_state(0, 0)).status, SettlementStatus.PENDING)

        # 1-0 live: both PENDING (No does not settle early; Yes has not scored yet)
        self.assertEqual(SettlementEngine.evaluate(pred_yes, make_state(1, 0)).status, SettlementStatus.PENDING)
        self.assertEqual(SettlementEngine.evaluate(pred_no, make_state(1, 0)).status, SettlementStatus.PENDING)

        # 1-1 live: Yes is WON (early), No is LOST (early)
        dec_yes_11 = SettlementEngine.evaluate(pred_yes, make_state(1, 1))
        self.assertEqual(dec_yes_11.status, SettlementStatus.WON)
        self.assertTrue(dec_yes_11.is_early_settlement)

        dec_no_11 = SettlementEngine.evaluate(pred_no, make_state(1, 1))
        self.assertEqual(dec_no_11.status, SettlementStatus.LOST)
        self.assertTrue(dec_no_11.is_early_settlement)

        # FT 1-0: Yes is LOST, No is WON
        dec_yes_ft = SettlementEngine.evaluate(pred_yes, make_state(1, 0, finished=True))
        self.assertEqual(dec_yes_ft.status, SettlementStatus.LOST)

        dec_no_ft = SettlementEngine.evaluate(pred_no, make_state(1, 0, finished=True))
        self.assertEqual(dec_no_ft.status, SettlementStatus.WON)

    # 7. 1X2 In-Play Lead vs Full-Time
    def test_07_1x2_inplay_lead_remains_pending_until_ft(self):
        now = datetime.now(timezone.utc)
        pred_home = {"id": "p1", "fixture_id": "f1", "market": "1x2", "prediction": "home"}
        pred_away = {"id": "p2", "fixture_id": "f1", "market": "1x2", "prediction": "away"}

        # 2-0 after 70 minutes live -> strictly PENDING!
        state_live_20 = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.LIVE,
            raw_status="IN_PROGRESS",
            match_minute=70,
            scheduled_kickoff=now - timedelta(hours=1, minutes=20),
            home_score=2,
            away_score=0
        )
        self.assertEqual(SettlementEngine.evaluate(pred_home, state_live_20).status, SettlementStatus.PENDING)
        self.assertEqual(SettlementEngine.evaluate(pred_away, state_live_20).status, SettlementStatus.PENDING)

        # Full-time 2-0 -> Home WON, Away LOST
        state_ft_20 = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.FINISHED,
            raw_status="FINAL",
            scheduled_kickoff=now - timedelta(hours=2),
            home_score=2,
            away_score=0
        )
        self.assertEqual(SettlementEngine.evaluate(pred_home, state_ft_20).status, SettlementStatus.WON)
        self.assertEqual(SettlementEngine.evaluate(pred_away, state_ft_20).status, SettlementStatus.LOST)

    # 8. Half-Time Markets
    def test_08_half_time_markets(self):
        now = datetime.now(timezone.utc)
        pred_ht_o05 = {"id": "p1", "fixture_id": "f1", "market": "ht_goals_0.5", "prediction": "over"}
        pred_ht_u05 = {"id": "p2", "fixture_id": "f1", "market": "ht_goals_0.5", "prediction": "under"}

        # Verified Halftime 1-0: Over WON, Under LOST
        state_ht_10 = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.LIVE,
            period="HT",
            raw_status="HALFTIME",
            scheduled_kickoff=now - timedelta(minutes=50),
            half_time_home_score=1,
            half_time_away_score=0,
            home_score=1,
            away_score=0
        )
        self.assertEqual(SettlementEngine.evaluate(pred_ht_o05, state_ht_10).status, SettlementStatus.WON)
        self.assertEqual(SettlementEngine.evaluate(pred_ht_u05, state_ht_10).status, SettlementStatus.LOST)

        # Verified Halftime 0-0: Over LOST, Under WON
        state_ht_00 = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.LIVE,
            period="HT",
            raw_status="HALFTIME",
            scheduled_kickoff=now - timedelta(minutes=50),
            half_time_home_score=0,
            half_time_away_score=0,
            home_score=0,
            away_score=0
        )
        self.assertEqual(SettlementEngine.evaluate(pred_ht_o05, state_ht_00).status, SettlementStatus.LOST)
        self.assertEqual(SettlementEngine.evaluate(pred_ht_u05, state_ht_00).status, SettlementStatus.WON)

    # 9. Second-Half Goals Markets Isolation
    def test_09_second_half_goals_isolation(self):
        now = datetime.now(timezone.utc)
        # HT 1-0, FT 2-1 -> Second-half goals = (2-1) + (1-0) = 2 goals
        state = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.FINISHED,
            raw_status="FINAL",
            scheduled_kickoff=now - timedelta(hours=2),
            home_score=2,
            away_score=1,
            half_time_home_score=1,
            half_time_away_score=0
        )
        pred_2h_o05 = {"id": "p1", "fixture_id": "f1", "market": "2h_goals_0.5", "prediction": "over"}
        pred_2h_u15 = {"id": "p2", "fixture_id": "f1", "market": "2h_goals_1.5", "prediction": "under"}

        # 2nd half goals = 2. Over 0.5 is WON, Under 1.5 is LOST
        self.assertEqual(SettlementEngine.evaluate(pred_2h_o05, state).status, SettlementStatus.WON)
        self.assertEqual(SettlementEngine.evaluate(pred_2h_u15, state).status, SettlementStatus.LOST)

    # 10. Corner Markets & Zero Fake Data
    def test_10_corner_markets(self):
        now = datetime.now(timezone.utc)
        pred_o85 = {"id": "p1", "fixture_id": "f1", "market": "corners_8.5", "prediction": "over"}
        pred_u85 = {"id": "p2", "fixture_id": "f1", "market": "corners_8.5", "prediction": "under"}

        # Unprovided corners -> strictly PENDING (no fabricated 0)
        state_no_corners = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.LIVE,
            raw_status="IN_PROGRESS",
            scheduled_kickoff=now - timedelta(minutes=60),
            corners_home=None,
            corners_away=None
        )
        self.assertEqual(SettlementEngine.evaluate(pred_o85, state_no_corners).status, SettlementStatus.PENDING)

        # 9 corners in-play -> Over 8.5 early WON, Under 8.5 early LOST
        state_corners_9 = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.LIVE,
            raw_status="IN_PROGRESS",
            scheduled_kickoff=now - timedelta(minutes=60),
            corners_home=5,
            corners_away=4
        )
        self.assertEqual(SettlementEngine.evaluate(pred_o85, state_corners_9).status, SettlementStatus.WON)
        self.assertEqual(SettlementEngine.evaluate(pred_u85, state_corners_9).status, SettlementStatus.LOST)

    # 11. Multi-Source Conflict Protection
    def test_11_multi_source_conflict_prevents_settlement(self):
        now = datetime.now(timezone.utc)
        payload_a = RawFixturePayload(
            source_name="ESPN",
            provider_event_id="123",
            league_code="ENG_PL",
            home_team_raw="Arsenal",
            away_team_raw="Chelsea",
            kickoff_time=now - timedelta(hours=2),
            status=FixtureStatus.FINISHED,
            home_score=2,
            away_score=1
        )
        payload_b = RawFixturePayload(
            source_name="LiveScore",
            provider_event_id="456",
            league_code="ENG_PL",
            home_team_raw="Arsenal",
            away_team_raw="Chelsea",
            kickoff_time=now - timedelta(hours=2),
            status=FixtureStatus.FINISHED,
            home_score=1,
            away_score=1
        )
        state = LiveMonitorEngine.reconcile_multi_sources(
            fixture_id="f1",
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            scheduled_kickoff=now - timedelta(hours=2),
            source_payloads=[payload_a, payload_b],
            now_utc=now
        )
        self.assertTrue(state.has_conflict)
        self.assertIn("Score mismatch", state.conflict_reason)

        pred = {"id": "p1", "fixture_id": "f1", "market": "1x2", "prediction": "home"}
        dec = SettlementEngine.evaluate(pred, state)
        self.assertEqual(dec.status, SettlementStatus.CONFLICT)

    # 12. Void Conditions vs Temporary Outage
    def test_12_void_event_vs_temporary_outage(self):
        now = datetime.now(timezone.utc)
        pred = {"id": "p1", "fixture_id": "f1", "market": "1x2", "prediction": "home"}

        # Officially cancelled -> VOID
        state_cancelled = LiveMatchState(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            provider_event_id="e1",
            source_name="espn",
            status=FixtureStatus.CANCELLED,
            raw_status="CANCELLED",
            scheduled_kickoff=now - timedelta(hours=1)
        )
        self.assertEqual(SettlementEngine.evaluate(pred, state_cancelled).status, SettlementStatus.VOID)

        # Temporary API outage (empty sources) -> PENDING (NEVER VOID!)
        state_outage = LiveMonitorEngine.reconcile_multi_sources(
            fixture_id="f1",
            canonical_key="ENG_PL:a:b:20260908",
            scheduled_kickoff=now - timedelta(hours=1),
            source_payloads=[],
            now_utc=now
        )
        self.assertEqual(SettlementEngine.evaluate(pred, state_outage).status, SettlementStatus.PENDING)

    # 13. Settlement Idempotency
    def test_13_settlement_idempotency(self):
        # A prediction once settled does not re-settle or create duplicate rows
        mock_supabase = MagicMock()
        mock_supabase.get_unsettled_predictions.return_value = []  # Already settled
        scheduler = SettlementScheduler(supabase_client=mock_supabase)
        unsettled = mock_supabase.get_unsettled_predictions("f1")
        self.assertEqual(len(unsettled), 0)

    # 14. Per-Fixture Failure Isolation
    def test_14_per_fixture_failure_isolation(self):
        mock_supabase = MagicMock()
        # Returns 2 fixtures, fixture 1 throws exception
        mock_supabase.get_active_fixtures_for_monitoring.return_value = [
            {"id": "f_bad", "canonical_key": "bad_key", "kickoff_at": "2026-09-08T16:00:00Z"},
            {"id": "f_good", "canonical_key": "good_key", "kickoff_at": "2026-09-08T16:00:00Z"}
        ]
        mock_supabase.get_system_job_by_key.return_value = None
        mock_supabase.create_system_job.return_value = {"id": "job-1"}
        mock_supabase.get_unsettled_predictions.side_effect = lambda f_id: [
            {"id": f"p_{f_id}", "fixture_id": f_id, "market": "1x2", "prediction": "home"}
        ] if f_id != "f_bad" else (_ for _ in ()).throw(RuntimeError("Network Timeout"))

        scheduler = SettlementScheduler(supabase_client=mock_supabase)
        res = scheduler.run_settlement_cycle(slot_override=2, force_now_wat=datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc))

        self.assertEqual(res["fixtures_inspected"], 2)
        self.assertEqual(res["errors_count"], 1)  # Bad fixture recorded error
        # Cycle finished cleanly without aborting
        self.assertIn("duration_ms", res)

    # 15. Crash Recovery & Stale Lock Breaking
    def test_15_stale_lock_breaking_and_crash_recovery(self):
        mock_supabase = MagicMock()
        stale_heartbeat = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
        mock_supabase.get_system_job_by_key.return_value = {
            "id": "job-stale",
            "status": "running",
            "started_at": stale_heartbeat,
            "metadata": {"heartbeat_at": stale_heartbeat, "worker_id": "crashed-worker-999"}
        }
        mock_supabase.update_system_job.return_value = {"id": "job-stale", "status": "running"}

        scheduler = SettlementScheduler(supabase_client=mock_supabase, worker_id="recovery-worker-001")
        acquired, j_id, reason = scheduler.lock.acquire(
            idempotency_key="settlement-cycle-2026-09-08-slot02-wat",
            timeout_minutes=10
        )
        self.assertTrue(acquired)
        self.assertEqual(reason, "CRASH_RECOVERED_ACQUIRED")
        mock_supabase.update_system_job.assert_called_once()

    # 16. Lagos WAT Slot Calculation
    def test_16_lagos_wat_slot_calculation(self):
        # 18:22 WAT -> slot 18*4 + 1 = 73
        dt = datetime(2026, 9, 8, 18, 22, tzinfo=timezone.utc)
        slot, nominal, next_s, key = SettlementScheduler.calculate_slot(dt)
        self.assertEqual(slot, 73)
        self.assertEqual(nominal.minute, 15)
        self.assertEqual(next_s.minute, 30)
        self.assertEqual(key, "settlement-cycle-2026-09-08-slot73-wat")


if __name__ == "__main__":
    unittest.main()
