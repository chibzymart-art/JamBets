"""
JamBets — Phase 2 Football Data Acquisition Test Suite
Tests league registry, canonical identity, stale protection, multi-source validation,
and live Cloud Supabase database population.
"""

import os
import unittest
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv()

from python.src.config import LEAGUE_REGISTRY
from python.src.football.models import RawFixturePayload, FixtureStatus, DataFreshnessState
from python.src.football.identity import normalize_team_name, generate_canonical_key, build_canonical_fixture
from python.src.football.stale_checker import evaluate_freshness, StaleDataError, validate_not_stale
from python.src.football.validator import merge_and_validate_fixture
from python.src.db.supabase_client import SupabaseClient


class TestFootballDataAcquisition(unittest.TestCase):

    def test_01_minimum_25_leagues_configured(self):
        """Verify that at least 25 football competitions are configured."""
        self.assertGreaterEqual(len(LEAGUE_REGISTRY), 25, "Must have at least 25 configured leagues")
        # Verify major and smaller leagues exist
        codes = set(LEAGUE_REGISTRY.keys())
        self.assertIn("ENG_PL", codes, "Premier League must be configured")
        self.assertIn("ESP_LL", codes, "La Liga must be configured")
        self.assertIn("EUR_CL", codes, "Champions League must be configured")
        self.assertIn("NED_ED", codes, "Eredivisie must be configured")
        self.assertIn("USA_MLS", codes, "MLS must be configured")
        self.assertIn("SCO_PL", codes, "Scottish Premiership must be configured")

    def test_02_canonical_team_normalization(self):
        """Verify team name normalization and alias resolution."""
        self.assertEqual(normalize_team_name("Man City"), "manchester-city")
        self.assertEqual(normalize_team_name("Manchester City"), "manchester-city")
        self.assertEqual(normalize_team_name("Manchester City FC"), "manchester-city")
        self.assertEqual(normalize_team_name("Arsenal FC"), "arsenal")
        self.assertEqual(normalize_team_name("Bayern München"), "bayern-munich")
        self.assertEqual(normalize_team_name("Paris Saint-Germain"), "paris-saint-germain")

    def test_03_canonical_key_generation(self):
        """Verify deterministic canonical key format."""
        dt = datetime(2026, 9, 12, 14, 0, tzinfo=timezone.utc)
        key = generate_canonical_key("ENG_PL", "arsenal", "chelsea", dt)
        self.assertEqual(key, "ENG_PL:arsenal:chelsea:20260912")

    def test_04_stale_data_protection(self):
        """Verify that stale payloads are flagged and rejected."""
        now = datetime.now(timezone.utc)
        
        # Fresh payload
        fresh = RawFixturePayload(
            source_name="ESPN",
            provider_event_id="test-1",
            league_code="ENG_PL",
            season="2026",
            home_team_raw="Arsenal",
            away_team_raw="Chelsea",
            kickoff_time=now + timedelta(days=2),
            status=FixtureStatus.SCHEDULED,
            retrieved_at=now - timedelta(minutes=5)
        )
        state, _ = evaluate_freshness(fresh, now)
        self.assertEqual(state, DataFreshnessState.CURRENT)

        # Stale scheduled payload (retrieved 10 hours ago > 6h threshold)
        stale = RawFixturePayload(
            source_name="ESPN",
            provider_event_id="test-2",
            league_code="ENG_PL",
            season="2026",
            home_team_raw="Arsenal",
            away_team_raw="Chelsea",
            kickoff_time=now + timedelta(days=2),
            status=FixtureStatus.SCHEDULED,
            retrieved_at=now - timedelta(hours=10)
        )
        state_stale, reason = evaluate_freshness(stale, now)
        self.assertEqual(state_stale, DataFreshnessState.STALE)
        with self.assertRaises(StaleDataError):
            validate_not_stale(stale)

    def test_05_multi_source_agreement(self):
        """Verify that matching data from two sources produces VERIFIED state."""
        now = datetime.now(timezone.utc)
        kickoff = now + timedelta(days=2)

        raw_espn = RawFixturePayload(
            source_name="ESPN",
            provider_event_id="espn-101",
            league_code="ENG_PL",
            season="2026",
            home_team_raw="Arsenal",
            away_team_raw="Chelsea",
            kickoff_time=kickoff,
            status=FixtureStatus.SCHEDULED,
            retrieved_at=now
        )
        raw_livescore = RawFixturePayload(
            source_name="LiveScore",
            provider_event_id="ls-202",
            league_code="ENG_PL",
            season="2026",
            home_team_raw="Arsenal FC",
            away_team_raw="Chelsea FC",
            kickoff_time=kickoff + timedelta(minutes=5),  # within 30 min tolerance
            status=FixtureStatus.SCHEDULED,
            retrieved_at=now
        )

        canonical = build_canonical_fixture(raw_espn)
        merged = merge_and_validate_fixture(canonical, raw_livescore)

        self.assertFalse(merged.has_conflict)
        self.assertEqual(merged.freshness_state, DataFreshnessState.VERIFIED)
        self.assertEqual(merged.agreement_count, 2)
        self.assertEqual(len(merged.sources), 2)

    def test_06_multi_source_conflict_detection(self):
        """Verify that conflicting data between sources produces CONFLICT state."""
        now = datetime.now(timezone.utc)
        kickoff = now + timedelta(days=2)

        raw_espn = RawFixturePayload(
            source_name="ESPN",
            provider_event_id="espn-101",
            league_code="ENG_PL",
            season="2026",
            home_team_raw="Arsenal",
            away_team_raw="Chelsea",
            kickoff_time=kickoff,
            status=FixtureStatus.SCHEDULED,
            retrieved_at=now
        )
        # Disagreeing kickoff time (> 30 mins)
        raw_conflicting = RawFixturePayload(
            source_name="LiveScore",
            provider_event_id="ls-202",
            league_code="ENG_PL",
            season="2026",
            home_team_raw="Arsenal",
            away_team_raw="Chelsea",
            kickoff_time=kickoff + timedelta(hours=3),  # 3 hours off
            status=FixtureStatus.SCHEDULED,
            retrieved_at=now
        )

        canonical = build_canonical_fixture(raw_espn)
        merged = merge_and_validate_fixture(canonical, raw_conflicting)

        self.assertTrue(merged.has_conflict)
        self.assertEqual(merged.freshness_state, DataFreshnessState.CONFLICTING)
        self.assertIsNotNone(merged.conflict_details)
        self.assertEqual(merged.conflict_details["type"], "kickoff_time_conflict")

    def test_07_cloud_supabase_records(self):
        """Verify actual live records populated in Cloud Supabase."""
        client = SupabaseClient()

        # 1. Verify leagues count
        leagues = client.get("football_leagues", {"select": "id,code,name"})
        self.assertGreaterEqual(len(leagues), 25, "Must have >= 25 leagues populated in Cloud Supabase")

        # 2. Verify fixtures count
        fixtures = client.get("football_fixtures", {"select": "id,status,target_kickoff_at"})
        self.assertGreater(len(fixtures), 0, "Must have actual live fixtures in Cloud Supabase")

        # 3. Verify provenance records
        sources = client.get("football_fixture_sources", {"select": "id,provider_event_id,source_id"})
        self.assertGreater(len(sources), 0, "Must have source provenance records in Cloud Supabase")

        # 4. Verify teams count
        teams = client.get("football_teams", {"select": "id,name"})
        self.assertGreater(len(teams), 10, "Must have normalized teams in Cloud Supabase")

    def test_08_livescore_active_minute_mapping(self):
        """Verify that LiveScore elapsed minutes and stoppage times map strictly to FixtureStatus.LIVE."""
        from python.src.sources.livescore import LiveScoreAdapter
        adapter = LiveScoreAdapter()
        self.assertEqual(adapter._map_livescore_status("1H"), FixtureStatus.LIVE)
        self.assertEqual(adapter._map_livescore_status("HT"), FixtureStatus.LIVE)
        self.assertEqual(adapter._map_livescore_status("2H"), FixtureStatus.LIVE)
        self.assertEqual(adapter._map_livescore_status("35"), FixtureStatus.LIVE)
        self.assertEqual(adapter._map_livescore_status("45+2"), FixtureStatus.LIVE)
        self.assertEqual(adapter._map_livescore_status("78'"), FixtureStatus.LIVE)
        self.assertEqual(adapter._map_livescore_status("FT"), FixtureStatus.FINISHED)
        self.assertEqual(adapter._map_livescore_status("NS"), FixtureStatus.SCHEDULED)

    def test_09_flashscore_tournament_prefix_matching(self):
        """Verify that Flashscore localized tournament prefixes and aliases map to canonical league configs."""
        from python.src.sources.flashscore import FlashscoreAdapter
        from python.src.config import LEAGUE_REGISTRY
        adapter = FlashscoreAdapter()

        # Saudi Pro League localized in Malay/Indonesian feed
        sau_cfg = LEAGUE_REGISTRY["SAU_SPL"]
        sau_match = {
            "tournament": "ARAB SAUDI: Liga Profesional Saudi",
            "country": "Arab Saudi"
        }
        self.assertTrue(adapter._match_league_code(sau_cfg, sau_match))

        # J1 League localized in Japanese/Malay feed
        jpn_cfg = LEAGUE_REGISTRY["JPN_J1"]
        jpn_match = {
            "tournament": "JEPUN: Liga J1",
            "country": "Jepun"
        }
        self.assertTrue(adapter._match_league_code(jpn_cfg, jpn_match))


if __name__ == "__main__":
    unittest.main()
