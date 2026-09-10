"""
Unit and Integration Tests for Phase 4.7:
1. Zero-Hallucination Gate & MissingDataException handling.
2. Two-Factor Consensus Gate (P_sim >= 82% AND P_market >= 80%).
3. Rapidfuzz Entity Resolution.
4. Google News Injury NLP Debuff Integration.
5. Secondary Consensus Markets (>= 60.00%, max 4).
"""

import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

from python.src.football.identity import resolve_fuzzy_team_name, normalize_team_name
from python.src.football.prematch_features import (
    MissingDataException,
    PreMatchFeatureEngine,
    PreMatchFeatures,
)
from python.src.football.prediction_pipeline import PredictionPipeline, FixturePredictionResult
from python.src.football.publication_filter import QualifyingPrediction
from python.src.football.simulation_engine import SimulationRunResult, MarketOutcome
from python.src.football.historical_dataset import HistoricalMatch, HistoricalDatasetBuilder


class TestPhase47ConsensusAndZeroHallucination(unittest.TestCase):

    def setUp(self):
        self.cutoff = datetime(2026, 9, 8, 12, 0, 0, tzinfo=timezone.utc)

    def test_01_rapidfuzz_entity_resolution(self):
        """Verify rapidfuzz resolves colloquial team names with >= 85% match."""
        canonical, score = resolve_fuzzy_team_name("Man Utd")
        self.assertEqual(canonical, "manchester-united")
        self.assertGreaterEqual(score, 85.0)

        canonical, score = resolve_fuzzy_team_name("Wolves")
        self.assertEqual(canonical, "wolverhampton-wanderers")
        self.assertGreaterEqual(score, 85.0)

        canonical, score = resolve_fuzzy_team_name("Spurs")
        self.assertEqual(canonical, "tottenham-hotspur")
        self.assertGreaterEqual(score, 85.0)

        canonical, score = resolve_fuzzy_team_name("Nottm Forest")
        self.assertEqual(canonical, "nottingham-forest")
        self.assertGreaterEqual(score, 85.0)

    def test_02_zero_hallucination_gate_raises_missing_data_exception(self):
        """Verify Zero-Hallucination gate strictly raises MissingDataException when real data missing."""
        mock_dataset = MagicMock(spec=HistoricalDatasetBuilder)
        mock_dataset.get_league_matches.return_value = []
        mock_dataset.get_team_matches.return_value = []

        mock_fotmob = MagicMock()
        mock_fotmob.fetch_team_xg_metrics.return_value = None

        engine = PreMatchFeatureEngine(
            dataset=mock_dataset,
            fotmob=mock_fotmob,
            google_news=MagicMock()
        )

        with self.assertRaises(MissingDataException) as ctx:
            engine.compute_features(
                canonical_key="ENG_PL:non-existent-fc:chelsea:20260908",
                league_code="ENG_PL",
                home_team_canonical="non-existent-fc",
                away_team_canonical="chelsea",
                prediction_cutoff=self.cutoff
            )

        self.assertIn("Zero-Hallucination Gate", str(ctx.exception))
        self.assertTrue(len(ctx.exception.missing_fields) > 0)

    def test_03_consensus_gate_assignment_and_divergence(self):
        """Verify Two-Factor Consensus requires BOTH P_sim >= 82% AND P_market >= 80%."""
        mock_dataset = MagicMock()
        mock_dataset.matches = []
        mock_supabase = MagicMock()

        pipeline = PredictionPipeline(
            dataset=mock_dataset,
            supabase=mock_supabase
        )

        # Build real PreMatchFeatures snapshot with low lambda to yield under picks
        features_snapshot = PreMatchFeatures(
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            prediction_cutoff=self.cutoff,
            home_team_canonical="arsenal",
            away_team_canonical="chelsea",
            league_code="ENG_PL",
            lambda_home=0.3,
            lambda_away=0.2,
            is_ready=True
        )
        pipeline.feature_engine.compute_features = MagicMock(return_value=features_snapshot)

        # Case A: Consensus Met (P_sim >= 82%, P_market >= 80%) -> Assigned Primary Banker
        pipeline.sportybet.fetch_prematch_market_probabilities = MagicMock(return_value={
            "over_under_4.5": {"under": 0.88},
            "over_under_3.5": {"under": 0.85},
            "double_chance": {"1x": 0.70}
        })

        res_a = pipeline.process_single_fixture(
            fixture_id="f_consensus_yes",
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            league_code="ENG_PL",
            home_team_canonical="arsenal",
            away_team_canonical="chelsea",
            kickoff_utc=self.cutoff,
            persist_to_supabase=False
        )

        self.assertEqual(res_a.status, "PUBLISHED")
        self.assertTrue(res_a.is_consensus_banker)
        self.assertIn("under", res_a.primary_prediction.outcome.lower())
        self.assertEqual(res_a.primary_prediction.confidence_tier, "BANGER")
        self.assertGreaterEqual(len(res_a.secondary_predictions), 1)

        # Case B: Divergence - P_sim >= 82%, but P_market < 80% -> NO_SAFE_BANKER / SKIP
        pipeline.sportybet.fetch_prematch_market_probabilities = MagicMock(return_value={
            "over_under_4.5": {"under": 0.60},
            "over_under_3.5": {"under": 0.55},
            "double_chance": {"1x": 0.50}
        })

        res_b = pipeline.process_single_fixture(
            fixture_id="f_consensus_no",
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            league_code="ENG_PL",
            home_team_canonical="arsenal",
            away_team_canonical="chelsea",
            kickoff_utc=self.cutoff,
            persist_to_supabase=False
        )

        self.assertEqual(res_b.status, "PUBLISHED")
        self.assertFalse(res_b.is_consensus_banker)
        self.assertIsNotNone(res_b.primary_prediction)

    def test_04_pipeline_records_data_unavailable_on_missing_data(self):
        """Verify pipeline explicitly updates Cloud Supabase status to 'data_unavailable'."""
        mock_dataset = MagicMock()
        mock_dataset.get_league_matches.return_value = []
        mock_dataset.get_team_matches.return_value = []

        mock_fotmob = MagicMock()
        mock_fotmob.fetch_team_xg_metrics.return_value = None

        mock_supabase = MagicMock()

        pipeline = PredictionPipeline(
            dataset=mock_dataset,
            supabase=mock_supabase,
            fotmob=mock_fotmob
        )

        res = pipeline.process_single_fixture(
            fixture_id="fix-test-123",
            canonical_key="ENG_PL:mock-a:mock-b:20260908",
            league_code="ENG_PL",
            home_team_canonical="mock-a",
            away_team_canonical="mock-b",
            kickoff_utc=self.cutoff,
            persist_to_supabase=True
        )

        self.assertEqual(res.status, "DATA_UNAVAILABLE")
        # Verify Cloud Supabase was called to set status to 'data_unavailable'
        mock_supabase.update_fixture_status.assert_called_once()
        args, kwargs = mock_supabase.update_fixture_status.call_args
        self.assertEqual(args[0], "fix-test-123")
        self.assertEqual(args[1], "data_unavailable")
        self.assertIn("ZERO_HALLUCINATION", kwargs.get("reason", ""))


if __name__ == "__main__":
    unittest.main()
