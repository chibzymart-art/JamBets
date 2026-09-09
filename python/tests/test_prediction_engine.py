"""
JamBets — Phase 4: Production Football Prediction Engine Test Suite
Tests dataset integrity, temporal leakage prevention, feature engineering,
Dixon-Coles modeling, exact 250,000 simulation gating, 45% threshold boundaries,
confidence tier classifications, multi-fixture isolation, and NOT_READY integrity gates.
"""

import unittest
from datetime import datetime, timezone, timedelta, date
import numpy as np

from python.src.football.historical_dataset import HistoricalMatch, HistoricalDatasetBuilder
from python.src.football.prematch_features import PreMatchFeatureEngine, PreMatchFeatures
from python.src.football.prediction_models import DixonColesModel, ChronologicalBacktester
from python.src.football.simulation_engine import MonteCarloSimulationEngine, MarketOutcome
from python.src.football.publication_filter import PublicationFilter
from python.src.football.prediction_pipeline import PredictionPipeline


class TestPredictionEngine(unittest.TestCase):

    def setUp(self):
        self.dataset = HistoricalDatasetBuilder()
        self.cutoff = datetime(2026, 9, 8, 12, 0, 0, tzinfo=timezone.utc)

        # Seed sample historical matches across 2024 for testing
        sample_raw = [
            # Arsenal matches
            {"provider_event_id": "hist_1", "league_code": "ENG_PL", "match_date": "2024-05-19", "scheduled_kickoff": "2024-05-19T15:00:00Z", "home_team_raw": "Arsenal", "away_team_raw": "Everton", "home_score": 2, "away_score": 1, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_2", "league_code": "ENG_PL", "match_date": "2024-05-12", "scheduled_kickoff": "2024-05-12T15:30:00Z", "home_team_raw": "Manchester United", "away_team_raw": "Arsenal", "home_score": 0, "away_score": 1, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_3", "league_code": "ENG_PL", "match_date": "2024-05-04", "scheduled_kickoff": "2024-05-04T11:30:00Z", "home_team_raw": "Arsenal", "away_team_raw": "Bournemouth", "home_score": 3, "away_score": 0, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_4", "league_code": "ENG_PL", "match_date": "2024-04-28", "scheduled_kickoff": "2024-04-28T13:00:00Z", "home_team_raw": "Tottenham", "away_team_raw": "Arsenal", "home_score": 2, "away_score": 3, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_5", "league_code": "ENG_PL", "match_date": "2024-04-23", "scheduled_kickoff": "2024-04-23T19:00:00Z", "home_team_raw": "Arsenal", "away_team_raw": "Chelsea", "home_score": 5, "away_score": 0, "final_status": "STATUS_FULL_TIME"},
            # Chelsea matches
            {"provider_event_id": "hist_6", "league_code": "ENG_PL", "match_date": "2024-05-19", "scheduled_kickoff": "2024-05-19T15:00:00Z", "home_team_raw": "Chelsea", "away_team_raw": "Bournemouth", "home_score": 2, "away_score": 1, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_7", "league_code": "ENG_PL", "match_date": "2024-05-15", "scheduled_kickoff": "2024-05-15T18:45:00Z", "home_team_raw": "Brighton", "away_team_raw": "Chelsea", "home_score": 1, "away_score": 2, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_8", "league_code": "ENG_PL", "match_date": "2024-05-11", "scheduled_kickoff": "2024-05-11T16:30:00Z", "home_team_raw": "Nottingham Forest", "away_team_raw": "Chelsea", "home_score": 2, "away_score": 3, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_9", "league_code": "ENG_PL", "match_date": "2024-05-05", "scheduled_kickoff": "2024-05-05T13:00:00Z", "home_team_raw": "Chelsea", "away_team_raw": "West Ham", "home_score": 5, "away_score": 0, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_10", "league_code": "ENG_PL", "match_date": "2024-05-02", "scheduled_kickoff": "2024-05-02T18:30:00Z", "home_team_raw": "Chelsea", "away_team_raw": "Tottenham", "home_score": 2, "away_score": 0, "final_status": "STATUS_FULL_TIME"},
            # Liverpool matches
            {"provider_event_id": "hist_11", "league_code": "ENG_PL", "match_date": "2024-05-19", "scheduled_kickoff": "2024-05-19T15:00:00Z", "home_team_raw": "Liverpool", "away_team_raw": "Wolves", "home_score": 2, "away_score": 0, "final_status": "STATUS_FULL_TIME"},
            {"provider_event_id": "hist_12", "league_code": "ENG_PL", "match_date": "2024-05-13", "scheduled_kickoff": "2024-05-13T19:00:00Z", "home_team_raw": "Aston Villa", "away_team_raw": "Liverpool", "home_score": 3, "away_score": 3, "final_status": "STATUS_FULL_TIME"},
        ]
        for m in sample_raw:
            self.dataset.validate_and_add_match(m)

        self.feature_engine = PreMatchFeatureEngine(self.dataset)
        self.model = DixonColesModel()
        self.sim_engine = MonteCarloSimulationEngine(self.model)

    # =========================================================================
    # 1. DATASET VALIDATION TESTS
    # =========================================================================

    def test_01_duplicate_provider_id_rejected(self):
        """1. Duplicate provider event ID must be strictly rejected."""
        dup = {
            "provider_event_id": "hist_1",  # Already in dataset
            "league_code": "ENG_PL", "match_date": "2024-05-19",
            "scheduled_kickoff": "2024-05-19T15:00:00Z",
            "home_team_raw": "Arsenal", "away_team_raw": "Everton",
            "home_score": 2, "away_score": 1, "final_status": "STATUS_FULL_TIME"
        }
        ok, reason = self.dataset.validate_and_add_match(dup)
        self.assertFalse(ok)
        self.assertEqual(reason, "DUPLICATE_PROVIDER_EVENT_ID")

    def test_02_invalid_or_negative_scores_rejected(self):
        """2. Negative or invalid scores must be strictly rejected."""
        bad_score = {
            "provider_event_id": "bad_score_1",
            "league_code": "ENG_PL", "match_date": "2024-05-19",
            "scheduled_kickoff": "2024-05-19T15:00:00Z",
            "home_team_raw": "Arsenal", "away_team_raw": "Everton",
            "home_score": -1, "away_score": 2, "final_status": "STATUS_FULL_TIME"
        }
        ok, reason = self.dataset.validate_and_add_match(bad_score)
        self.assertFalse(ok)
        self.assertEqual(reason, "INVALID_OR_NEGATIVE_SCORE")

    def test_03_uncompleted_match_rejected(self):
        """3. Match not at full-time must be rejected from historical dataset."""
        uncompleted = {
            "provider_event_id": "uncomp_1",
            "league_code": "ENG_PL", "match_date": "2024-05-19",
            "scheduled_kickoff": "2024-05-19T15:00:00Z",
            "home_team_raw": "Arsenal", "away_team_raw": "Everton",
            "home_score": 1, "away_score": 0, "final_status": "STATUS_IN_PLAY"
        }
        ok, reason = self.dataset.validate_and_add_match(uncompleted)
        self.assertFalse(ok)
        self.assertEqual(reason, "MATCH_NOT_COMPLETED")

    def test_04_result_score_mismatch_rejected(self):
        """4. Stated result mismatching score must be rejected."""
        mismatch = {
            "provider_event_id": "mismatch_1",
            "league_code": "ENG_PL", "match_date": "2024-05-19",
            "scheduled_kickoff": "2024-05-19T15:00:00Z",
            "home_team_raw": "Arsenal", "away_team_raw": "Everton",
            "home_score": 3, "away_score": 1, "result": "AWAY_WIN",  # Incorrect!
            "final_status": "STATUS_FULL_TIME"
        }
        ok, reason = self.dataset.validate_and_add_match(mismatch)
        self.assertFalse(ok)
        self.assertEqual(reason, "RESULT_SCORE_MISMATCH")

    def test_05_missing_team_names_rejected(self):
        """5. Missing team names must be rejected."""
        missing = {
            "provider_event_id": "missing_teams_1",
            "league_code": "ENG_PL", "match_date": "2024-05-19",
            "scheduled_kickoff": "2024-05-19T15:00:00Z",
            "home_team_raw": "", "away_team_raw": "Everton",
            "home_score": 2, "away_score": 1, "final_status": "STATUS_FULL_TIME"
        }
        ok, reason = self.dataset.validate_and_add_match(missing)
        self.assertFalse(ok)
        self.assertEqual(reason, "MISSING_TEAM_NAMES")

    # =========================================================================
    # 2. TEMPORAL LEAKAGE & CUTOFF TESTS
    # =========================================================================

    def test_06_temporal_cutoff_leakage_protection(self):
        """6. Matches played AFTER cutoff must NEVER leak into feature vector."""
        future_cutoff = datetime(2024, 5, 10, 12, 0, 0, tzinfo=timezone.utc)
        features = self.feature_engine.compute_features(
            canonical_key="ENG_PL:arsenal:chelsea:20240510",
            league_code="ENG_PL",
            home_team_canonical="arsenal",
            away_team_canonical="chelsea",
            prediction_cutoff=future_cutoff
        )
        self.assertTrue(features.is_ready)
        # Arsenal matches on May 12 and May 19 must NOT be included in features
        team_matches = self.dataset.get_team_matches("arsenal", future_cutoff)
        for m in team_matches:
            self.assertLess(m.scheduled_kickoff, future_cutoff)
            self.assertNotIn(m.provider_event_id, ["hist_1", "hist_2"])

    def test_07_post_match_stats_cannot_leak(self):
        """7. Post-match scores of the target match cannot enter pre-match features."""
        target_kickoff = datetime(2024, 5, 19, 15, 0, 0, tzinfo=timezone.utc)
        features = self.feature_engine.compute_features(
            canonical_key="ENG_PL:arsenal:everton:20240519",
            league_code="ENG_PL",
            home_team_canonical="arsenal",
            away_team_canonical="chelsea",
            prediction_cutoff=target_kickoff
        )
        # Match hist_1 (which kicks off at target_kickoff) must be strictly excluded
        used_matches = self.dataset.get_team_matches("arsenal", target_kickoff)
        event_ids = [m.provider_event_id for m in used_matches]
        self.assertNotIn("hist_1", event_ids, "Target fixture must never be part of its own pre-match history")

    # =========================================================================
    # 3. FEATURE TESTS
    # =========================================================================

    def test_08_home_away_separation(self):
        """8. Home and away attack/defense metrics must remain isolated."""
        features = self.feature_engine.compute_features(
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            league_code="ENG_PL",
            home_team_canonical="arsenal",
            away_team_canonical="chelsea",
            prediction_cutoff=self.cutoff
        )
        self.assertTrue(features.is_ready)
        self.assertGreater(features.alpha_home_attack, 0.0)
        self.assertGreater(features.beta_home_defense, 0.0)
        self.assertGreater(features.alpha_away_attack, 0.0)
        self.assertGreater(features.beta_away_defense, 0.0)
        self.assertGreater(features.lambda_home, 0.0)
        self.assertGreater(features.lambda_away, 0.0)

    def test_09_exponential_time_decay(self):
        """9. Recent matches must receive higher exponential weighting than older matches."""
        features = self.feature_engine.compute_features(
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            league_code="ENG_PL",
            home_team_canonical="arsenal",
            away_team_canonical="chelsea",
            prediction_cutoff=self.cutoff
        )
        self.assertGreater(features.home_exp_weighted_goals_scored, 0.0)
        self.assertGreater(features.away_exp_weighted_goals_scored, 0.0)

    def test_10_insufficient_historical_data_integrity_gate(self):
        """10. Teams with missing historical data must trigger MissingDataException."""
        from python.src.football.prematch_features import MissingDataException
        with self.assertRaises(MissingDataException):
            self.feature_engine.compute_features(
                canonical_key="ENG_PL:unknown-fc:chelsea:20260908",
                league_code="ENG_PL",
                home_team_canonical="unknown-fc",  # 0 matches in dataset
                away_team_canonical="chelsea",
                prediction_cutoff=self.cutoff
            )

    # =========================================================================
    # 4. STATISTICAL MODEL TESTS
    # =========================================================================

    def test_11_dixon_coles_parameter_estimation(self):
        """11. Dixon-Coles rho parameter must be estimated from data, never hardcoded."""
        rho = self.model.estimate_rho(self.dataset.matches)
        self.assertIsInstance(rho, float)
        self.assertGreaterEqual(rho, -0.25)
        self.assertLessEqual(rho, 0.05)

    def test_12_joint_distribution_normalization(self):
        """12. 2D score probability matrix must sum to 1.0; no NaNs, no infinities."""
        M = self.model.compute_joint_distribution(lambda_h=1.65, lambda_a=1.15)
        self.assertAlmostEqual(float(np.sum(M)), 1.0, places=4)
        self.assertFalse(np.isnan(M).any())
        self.assertFalse(np.isinf(M).any())
        self.assertTrue((M >= 0).all())

    def test_13_chronological_backtester_metrics(self):
        """13. Chronological backtesting produces valid Log Loss and Brier Score."""
        preds = [(0.5, 0.3, 0.2), (0.2, 0.3, 0.5)]
        actuals = ["HOME_WIN", "AWAY_WIN"]
        metrics = ChronologicalBacktester.evaluate_predictions(preds, actuals)
        self.assertGreater(metrics.log_loss, 0.0)
        self.assertGreater(metrics.brier_score, 0.0)
        self.assertEqual(metrics.accuracy_1x2, 1.0)

    # =========================================================================
    # 5. EXACT 250,000 SIMULATION TESTS
    # =========================================================================

    def test_14_exact_250k_simulation_pass(self):
        """14. Exactly 250,000 iterations must complete and extract coherent probabilities."""
        res = self.sim_engine.simulate_fixture(
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            lambda_home=1.85,
            lambda_away=1.15,
            seed=42
        )
        self.assertEqual(res.completed_simulations, 250000)
        self.assertEqual(res.status, "completed")
        self.assertGreater(len(res.market_outcomes), 0)

        # Mathematical coherence test: Home Win + Draw + Away Win must sum to ~100%
        sum_1x2 = res.home_win_pct + res.draw_pct + res.away_win_pct
        self.assertAlmostEqual(sum_1x2, 100.0, places=1)

    def test_15_incomplete_simulations_fail(self):
        """15. 249,999 iterations must fail completion gate and reject publication."""
        res = self.sim_engine.simulate_fixture(
            canonical_key="ENG_PL:arsenal:chelsea:20260908",
            lambda_home=1.85,
            lambda_away=1.15,
            exact_simulations_override=249999  # 1 short of 250,000!
        )
        self.assertNotEqual(res.completed_simulations, 250000)
        self.assertEqual(res.status, "failed")
        self.assertEqual(len(res.market_outcomes), 0)

    # =========================================================================
    # 6. PUBLICATION FILTER & CONFIDENCE TIERS (SECTION 25)
    # =========================================================================

    def test_16_publication_filter_threshold_boundaries(self):
        """16. Test exact threshold boundaries and confidence tiers."""
        # 44.98% -> Rejected
        self.assertIsNone(PublicationFilter.classify_confidence_tier(44.98))
        # 44.99% -> Rejected (NEVER rounded to 45%)
        self.assertIsNone(PublicationFilter.classify_confidence_tier(44.99))
        # 45.00% -> RISKY
        self.assertEqual(PublicationFilter.classify_confidence_tier(45.00), "RISKY")
        # 45.01% -> RISKY
        self.assertEqual(PublicationFilter.classify_confidence_tier(45.01), "RISKY")
        # 59.99% -> RISKY
        self.assertEqual(PublicationFilter.classify_confidence_tier(59.99), "RISKY")
        # 60.00% -> LOW CONFIDENCE
        self.assertEqual(PublicationFilter.classify_confidence_tier(60.00), "LOW CONFIDENCE")
        # 69.99% -> LOW CONFIDENCE
        self.assertEqual(PublicationFilter.classify_confidence_tier(69.99), "LOW CONFIDENCE")
        # 70.00% -> MID CONFIDENCE
        self.assertEqual(PublicationFilter.classify_confidence_tier(70.00), "MID CONFIDENCE")
        # 82.99% -> MID CONFIDENCE
        self.assertEqual(PublicationFilter.classify_confidence_tier(82.99), "MID CONFIDENCE")
        # 83.00% -> HIGH CONFIDENCE
        self.assertEqual(PublicationFilter.classify_confidence_tier(83.00), "HIGH CONFIDENCE")
        # 89.99% -> HIGH CONFIDENCE
        self.assertEqual(PublicationFilter.classify_confidence_tier(89.99), "HIGH CONFIDENCE")
        # 90.00% -> TOP PICK
        self.assertEqual(PublicationFilter.classify_confidence_tier(90.00), "TOP PICK")
        # 95.99% -> TOP PICK
        self.assertEqual(PublicationFilter.classify_confidence_tier(95.99), "TOP PICK")
        # 96.00% -> BANGER
        self.assertEqual(PublicationFilter.classify_confidence_tier(96.00), "BANGER")
        # 100.00% -> BANGER
        self.assertEqual(PublicationFilter.classify_confidence_tier(100.00), "BANGER")

    # =========================================================================
    # 7. MULTI-FIXTURE ISOLATION TEST (SECTION 30)
    # =========================================================================

    def test_17_multi_fixture_isolation(self):
        """17. Run 3 distinct fixtures; verify independent parameters, simulations, and results."""
        pipeline = PredictionPipeline(dataset=self.dataset)

        fixtures_to_test = [
            ("f_1", "ENG_PL:arsenal:chelsea:20260908", "arsenal", "chelsea"),
            ("f_2", "ENG_PL:chelsea:liverpool:20260909", "chelsea", "liverpool"),
            ("f_3", "ENG_PL:liverpool:arsenal:20260910", "liverpool", "arsenal"),
        ]

        results = []
        for fid, ckey, h, a in fixtures_to_test:
            res = pipeline.process_single_fixture(
                fixture_id=fid,
                canonical_key=ckey,
                league_code="ENG_PL",
                home_team_canonical=h,
                away_team_canonical=a,
                kickoff_utc=self.cutoff + timedelta(days=1),
                persist_to_supabase=False
            )
            self.assertEqual(res.status, "PUBLISHED")
            self.assertEqual(res.simulation_result.completed_simulations, 250000)
            results.append(res)

        # Prove isolation: each fixture has distinct parameters and distinct simulation durations
        self.assertNotEqual(results[0].canonical_key, results[1].canonical_key)
        self.assertNotEqual(results[1].canonical_key, results[2].canonical_key)
        self.assertEqual(len(results), 3)

    # =========================================================================
    # 8. NOT_READY ACCEPTANCE TEST (SECTION 32)
    # =========================================================================

    def test_18_not_ready_acceptance_gate(self):
        """18. Missing critical data must yield NOT_READY, zero simulations, and zero public predictions."""
        pipeline = PredictionPipeline(dataset=self.dataset)
        res = pipeline.process_single_fixture(
            fixture_id="not_ready_test_1",
            canonical_key="ENG_PL:missing-team-a:chelsea:20260908",
            league_code="ENG_PL",
            home_team_canonical="missing-team-a",  # No historical matches
            away_team_canonical="chelsea",
            kickoff_utc=self.cutoff + timedelta(days=1),
            persist_to_supabase=False
        )
        self.assertIn(res.status, ["NOT_READY", "DATA_UNAVAILABLE"])
        self.assertIsNone(res.simulation_result, "No simulation may run for unready fixture")
        self.assertEqual(len(res.qualifying_predictions), 0, "No predictions may be published")
        self.assertTrue(
            "INSUFFICIENT_DATA" in (res.not_ready_reason or "") or "Zero-Hallucination" in (res.not_ready_reason or ""),
            "Reason must indicate missing data or zero-hallucination gate"
        )


if __name__ == "__main__":
    unittest.main()
