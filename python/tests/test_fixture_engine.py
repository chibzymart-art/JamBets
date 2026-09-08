"""
JamBets — Phase 3: Football Fixture Engine & Four-Day Queue Test Suite
Tests fixture discovery, 4-day window gating, duplicate protection,
historical contamination prevention, postponement/cancellation lifecycle states,
source conflicts, stale data, and event ID integrity.
"""

import unittest
from datetime import datetime, timezone, timedelta, date

from python.src.football.models import (
    FixtureStatus,
    RawFixturePayload,
    CanonicalFixture,
    DataFreshnessState,
)
from python.src.football.fixture_engine import FixtureEngine
from python.src.football.identity import CanonicalIdentityResolver
from python.src.football.stale_checker import StaleDataChecker
from python.src.football.validator import MultiSourceValidator


class TestFixtureEngine(unittest.TestCase):

    def setUp(self):
        self.engine = FixtureEngine()
        self.identity = CanonicalIdentityResolver()
        self.stale_checker = StaleDataChecker()
        self.validator = MultiSourceValidator()
        self.now = datetime(2026, 9, 8, 12, 0, 0, tzinfo=timezone.utc)

    def test_01_current_fixture_today(self):
        """1. Current fixture (TODAY): enters queue with queue_day = 0."""
        kickoff = self.now + timedelta(hours=4)  # Today 16:00 UTC
        res = self.engine.compute_queue_window(kickoff, reference_time=self.now)

        self.assertTrue(res.is_eligible, "Today's upcoming fixture must be eligible")
        self.assertEqual(res.queue_day, 0, "Today's fixture must have queue_day = 0")
        self.assertIn("DAY_0", res.reason)

    def test_02_future_fixture_within_4_days(self):
        """2. Future fixtures (Day +1 to +4): enter queue with queue_day 1 to 4."""
        for offset_days in [1, 2, 3, 4]:
            kickoff = self.now + timedelta(days=offset_days, hours=2)
            res = self.engine.compute_queue_window(kickoff, reference_time=self.now)

            self.assertTrue(
                res.is_eligible,
                f"Fixture at +{offset_days} days must be eligible for queue",
            )
            self.assertEqual(
                res.queue_day,
                offset_days,
                f"Fixture at +{offset_days} days must have queue_day = {offset_days}",
            )

    def test_03_fixture_beyond_four_days(self):
        """3. Fixture beyond four days (+5 days, +7 days): strictly rejected from prediction queue."""
        beyond_kickoff_5 = self.now + timedelta(days=5, hours=1)
        beyond_kickoff_8 = self.now + timedelta(days=8)

        res_5 = self.engine.compute_queue_window(beyond_kickoff_5, reference_time=self.now)
        res_8 = self.engine.compute_queue_window(beyond_kickoff_8, reference_time=self.now)

        self.assertFalse(res_5.is_eligible, "Fixture at +5 days must be rejected from queue")
        self.assertIsNone(res_5.queue_day, "Queue day must be None when rejected")
        self.assertIn("EXCEEDS_FOUR_DAY_WINDOW", res_5.reason)

        self.assertFalse(res_8.is_eligible, "Fixture at +8 days must be rejected from queue")
        self.assertIsNone(res_8.queue_day)

    def test_04_duplicate_fixture_protection(self):
        """4. Duplicate fixture: identical real-world match ingested multiple times yields 1 canonical key."""
        kickoff = self.now + timedelta(days=1)
        payload1 = RawFixturePayload(
            source_name="espn",
            provider_event_id="espn_dup_100",
            league_code="ENG_PL",
            home_team_name="Arsenal FC",
            away_team_name="Chelsea FC",
            scheduled_kickoff=kickoff,
            status=FixtureStatus.SCHEDULED,
            retrieved_at=self.now,
        )
        payload2 = RawFixturePayload(
            source_name="livescore",
            provider_event_id="ls_dup_200",
            league_code="ENG_PL",
            home_team_name="Arsenal",
            away_team_name="Chelsea",
            scheduled_kickoff=kickoff,
            status=FixtureStatus.SCHEDULED,
            retrieved_at=self.now,
        )

        key1 = self.identity.generate_canonical_key(
            payload1.league_code, payload1.home_team_name, payload1.away_team_name, payload1.scheduled_kickoff
        )
        key2 = self.identity.generate_canonical_key(
            payload2.league_code, payload2.home_team_name, payload2.away_team_name, payload2.scheduled_kickoff
        )

        self.assertEqual(key1, key2, "Canonical keys must match exactly across providers")
        self.assertEqual(key1, "ENG_PL:arsenal:chelsea:20260909")

        # Process both: engine produces identical canonical identity without creating duplicate targets
        canon1, meta1 = self.engine.process_fixture(payload1, self.now)
        canon2, meta2 = self.engine.process_fixture(payload2, self.now)

        self.assertEqual(canon1.canonical_key, canon2.canonical_key)
        self.assertTrue(meta1["in_prediction_queue"])
        self.assertEqual(meta1["queue_day"], 1)

    def test_05_same_teams_different_dates_historical_isolation(self):
        """5. Historical contamination protection: same teams on different dates yield distinct identities."""
        historical_kickoff = datetime(2026, 4, 15, 15, 0, 0, tzinfo=timezone.utc)
        current_kickoff = datetime(2026, 9, 8, 19, 45, 0, tzinfo=timezone.utc)

        hist_key = self.identity.generate_canonical_key(
            "ENG_PL", "Arsenal", "Chelsea", historical_kickoff
        )
        curr_key = self.identity.generate_canonical_key(
            "ENG_PL", "Arsenal", "Chelsea", current_kickoff
        )

        self.assertNotEqual(hist_key, curr_key, "Keys on different dates must never collide")
        self.assertIn("20260415", hist_key)
        self.assertIn("20260908", curr_key)

        # Verification of historical isolation
        is_valid = self.engine.verify_historical_isolation(
            target_canonical_key=curr_key,
            target_kickoff=current_kickoff,
            candidate_event_date=historical_kickoff.date(),
            candidate_event_id="past_event_123",
        )
        self.assertFalse(is_valid, "Current fixture must NEVER associate with past match date")

        is_valid_curr = self.engine.verify_historical_isolation(
            target_canonical_key=curr_key,
            target_kickoff=current_kickoff,
            candidate_event_date=current_kickoff.date(),
            candidate_event_id="curr_event_999",
        )
        self.assertTrue(is_valid_curr, "Current fixture must associate only with exact match date")

    def test_06_postponed_fixture_detection(self):
        """6. Postponed fixture: detected, status transitioned to POSTPONED, removed from prediction queue."""
        kickoff = self.now + timedelta(days=2)
        payload = RawFixturePayload(
            source_name="espn",
            provider_event_id="espn_postponed_1",
            league_code="ENG_PL",
            home_team_name="Liverpool",
            away_team_name="Everton",
            scheduled_kickoff=kickoff,
            status=FixtureStatus.POSTPONED,
            retrieved_at=self.now,
        )

        canon, meta = self.engine.process_fixture(payload, self.now)

        self.assertEqual(canon.status, FixtureStatus.POSTPONED)
        self.assertFalse(meta["in_prediction_queue"], "Postponed fixture must NOT be in prediction queue")
        self.assertIsNone(meta["queue_day"], "Postponed fixture queue_day must be None")
        self.assertIsNotNone(meta["postponed_at"], "postponed_at timestamp must be recorded")

    def test_07_cancelled_fixture_detection(self):
        """7. Cancelled fixture: detected, status transitioned to CANCELLED, removed from prediction queue."""
        kickoff = self.now + timedelta(days=1)
        payload = RawFixturePayload(
            source_name="livescore",
            provider_event_id="ls_cancelled_2",
            league_code="ESP_LL",
            home_team_name="Real Madrid",
            away_team_name="Barcelona",
            scheduled_kickoff=kickoff,
            status=FixtureStatus.CANCELLED,
            retrieved_at=self.now,
        )

        canon, meta = self.engine.process_fixture(payload, self.now)

        self.assertEqual(canon.status, FixtureStatus.CANCELLED)
        self.assertFalse(meta["in_prediction_queue"], "Cancelled fixture must NOT be in prediction queue")
        self.assertIsNone(meta["queue_day"])
        self.assertIsNotNone(meta["cancelled_at"], "cancelled_at timestamp must be recorded")

    def test_08_source_conflict_detection(self):
        """8. Source conflict: contradictory source statuses flag CONFLICTING and hold from queue."""
        kickoff = self.now + timedelta(days=1)
        payload_a = RawFixturePayload(
            source_name="espn",
            provider_event_id="espn_conf_1",
            league_code="GER_BL",
            home_team_name="Bayern Munich",
            away_team_name="Borussia Dortmund",
            scheduled_kickoff=kickoff,
            status=FixtureStatus.SCHEDULED,
            retrieved_at=self.now,
        )
        payload_b = RawFixturePayload(
            source_name="livescore",
            provider_event_id="ls_conf_1",
            league_code="GER_BL",
            home_team_name="Bayern Munich",
            away_team_name="Borussia Dortmund",
            scheduled_kickoff=kickoff,
            status=FixtureStatus.POSTPONED,  # Conflict: ESPN says scheduled, LiveScore says postponed
            retrieved_at=self.now,
        )

        canon, is_valid, conflict_details = self.validator.validate_fixture_pair(payload_a, payload_b)

        self.assertFalse(is_valid, "Conflicting status feeds must fail validation")
        self.assertEqual(canon.freshness_state, DataFreshnessState.CONFLICTING)
        self.assertIsNotNone(conflict_details)
        self.assertEqual(conflict_details.get("type"), "status_conflict")

    def test_09_stale_data_rejection(self):
        """9. Stale data: payload with expired retrieval timestamp is rejected."""
        kickoff = self.now + timedelta(days=1)
        stale_time = self.now - timedelta(hours=10)  # 10 hours old (threshold is 6 hours for scheduled)

        stale_payload = RawFixturePayload(
            source_name="espn",
            provider_event_id="espn_stale_99",
            league_code="FRA_L1",
            home_team_name="PSG",
            away_team_name="Marseille",
            scheduled_kickoff=kickoff,
            status=FixtureStatus.SCHEDULED,
            retrieved_at=stale_time,
        )

        canon, meta = self.engine.process_fixture(stale_payload, reference_time=self.now)

        self.assertIsNone(canon, "Stale payload must produce no canonical fixture")
        self.assertEqual(meta["rejection_reason"], "STALE_DATA_PAYLOAD")

    def test_10_wrong_provider_event_id_mismatch(self):
        """10. Wrong provider event ID: identity attributes mismatch detection."""
        kickoff = self.now + timedelta(days=1)
        different_date = self.now + timedelta(days=15)

        canonical_key = self.identity.generate_canonical_key("ENG_PL", "Arsenal", "Chelsea", kickoff)

        # Candidate event claims to be the same provider event but occurs on a completely different date
        is_isolated = self.engine.verify_historical_isolation(
            target_canonical_key=canonical_key,
            target_kickoff=kickoff,
            candidate_event_date=different_date.date(),
            candidate_event_id="wrong_event_id_999",
        )
        self.assertFalse(is_isolated, "Candidate event with mismatching date must be rejected")


if __name__ == "__main__":
    unittest.main()
