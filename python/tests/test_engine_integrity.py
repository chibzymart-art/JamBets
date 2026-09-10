"""
JamBets Production Football Simulation & Prediction Engine
Integrity, Calibration, Ensemble, Convergence, and Abstention Verification Suite.

Tests strictly enforce:
1. Competition anti-contamination (no youth/reserve/cross-country pollution)
2. Temporal cutoff enforcement (zero data leakage)
3. Zero-fabrication / zero-hallucination gate (MissingDataException)
4. Empirical Bayesian shrinkage & parameter uncertainty
5. Multi-model ensemble consensus & disagreement variance
6. Exact 250,000 Monte Carlo simulation invariant & failure gate
7. Convergence checkpoints (25k, 50k, 100k, 150k, 200k, 250k) and stability
8. Analytical vs. Monte Carlo distribution consistency
9. Dedicated Negative Binomial corner overdispersion
10. Abstention gating (uncertainty > 0.50, high model disagreement)
11. UI eligibility invariants (zero internal states exposed)
"""

import math
import unittest
import numpy as np
from datetime import datetime, timezone, timedelta, date
from typing import List, Dict, Any

from python.src.football.historical_dataset import HistoricalMatch, HistoricalDatasetBuilder
from python.src.football.team_strength import TeamStrengthEstimator, TeamStrengthProfile
from python.src.football.prediction_models import (
    DixonColesModel,
    NegativeBinomialScoringModel,
    ExpectedGoalsModel,
    DynamicEloModel,
    DedicatedCornerModel,
    MultiModelEnsemble
)
from python.src.football.simulation_engine import (
    MonteCarloSimulationEngine,
    SimulationInputContract,
    SimulationRunResult
)
from python.src.football.publication_filter import PublicationFilter, QualifyingPrediction
from python.src.football.market_calibrator import MarketCalibrator, MarketSelectionResult
from python.src.football.prematch_features import (
    PreMatchFeatureEngine,
    PreMatchFeatures,
    MissingDataException
)


def make_match(
    event_id: str,
    league: str,
    dt: datetime,
    home_team: str,
    away_team: str,
    home_score: int,
    away_score: int
) -> HistoricalMatch:
    return HistoricalMatch(
        provider_event_id=event_id,
        league_code=league,
        season="2024",
        match_date=dt.date(),
        scheduled_kickoff=dt,
        actual_played_date=dt.date(),
        home_team_raw=home_team,
        away_team_raw=away_team,
        home_team_canonical=home_team,
        away_team_canonical=away_team,
        home_score=home_score,
        away_score=away_score,
        final_status="STATUS_FINAL",
        result="HOME_WIN" if home_score > away_score else ("DRAW" if home_score == away_score else "AWAY_WIN")
    )


class TestCompetitionAntiContamination(unittest.TestCase):
    """Ensures cross-competition and youth/reserve teams never contaminate senior models."""

    def test_reserve_and_youth_team_isolation(self):
        estimator = TeamStrengthEstimator()
        senior_match = make_match(
            "senior_1", "ENG_PL",
            datetime(2024, 8, 17, 14, 0, tzinfo=timezone.utc),
            "arsenal", "chelsea", 2, 1
        )
        u21_match = make_match(
            "u21_1", "ENG_U21",
            datetime(2024, 8, 18, 14, 0, tzinfo=timezone.utc),
            "arsenal-u21", "chelsea-u21", 0, 4
        )
        all_matches = [senior_match, u21_match]
        cutoff = datetime(2024, 8, 20, tzinfo=timezone.utc)

        senior_prof = estimator.estimate_team_strength("arsenal", "ENG_PL", all_matches, cutoff)
        u21_prof = estimator.estimate_team_strength("arsenal-u21", "ENG_U21", all_matches, cutoff)

        self.assertEqual(senior_prof.team_canonical, "arsenal")
        self.assertEqual(senior_prof.competition_code, "ENG_PL")
        self.assertEqual(u21_prof.team_canonical, "arsenal-u21")
        self.assertEqual(u21_prof.competition_code, "ENG_U21")
        # Arsenal senior never inherits arsenal-u21 matches
        self.assertEqual(senior_prof.matches_analyzed, 1)
        self.assertEqual(u21_prof.matches_analyzed, 1)


class TestTemporalCutoffZeroLeakage(unittest.TestCase):
    """Ensures feature calculation strictly enforces kickoff cutoff (zero lookahead)."""

    def test_matches_after_cutoff_are_excluded(self):
        cutoff = datetime(2024, 9, 1, 12, 0, tzinfo=timezone.utc)
        valid_match = make_match(
            "m_valid", "ENG_PL",
            cutoff - timedelta(days=2),
            "liverpool", "everton", 2, 0
        )
        leaked_match = make_match(
            "m_future", "ENG_PL",
            cutoff + timedelta(hours=2),
            "liverpool", "manchester-city", 5, 0
        )

        estimator = TeamStrengthEstimator()
        prof = estimator.estimate_team_strength(
            "liverpool", "ENG_PL",
            [valid_match, leaked_match],
            cutoff
        )

        # The leaked match after cutoff must NOT be analyzed
        self.assertEqual(prof.matches_analyzed, 1)


class TestZeroFabricationIntegrity(unittest.TestCase):
    """Verifies that missing real data raises MissingDataException and forbids synthetic fallbacks."""

    def test_missing_data_raises_exception(self):
        engine = PreMatchFeatureEngine(dataset=HistoricalDatasetBuilder(), supabase=None)
        with self.assertRaises(MissingDataException) as exc_ctx:
            engine.compute_features(
                canonical_key="UNKNOWN_LEAGUE:fake-fc:ghost-united:20260910",
                league_code="UNKNOWN_LEAGUE",
                home_team_canonical="fake-fc",
                away_team_canonical="ghost-united",
                prediction_cutoff=datetime.now(timezone.utc)
            )
        self.assertGreater(len(exc_ctx.exception.missing_fields), 0)


class TestEmpiricalBayesianShrinkage(unittest.TestCase):
    """Validates shrinkage factor K=4.0 and uncertainty estimation."""

    def test_small_sample_flags_insufficient_history(self):
        estimator = TeamStrengthEstimator()
        cutoff = datetime(2024, 8, 20, tzinfo=timezone.utc)
        m1 = make_match(
            "m1", "ESP_LL",
            datetime(2024, 8, 1, tzinfo=timezone.utc),
            "real-madrid", "mallorca", 5, 0
        )
        prof = estimator.estimate_team_strength("real-madrid", "ESP_LL", [m1], cutoff)

        self.assertEqual(prof.matches_analyzed, 1)
        # N=1 < 3 -> has_sufficient_history is False, strength is shrunken to baseline 1.00
        self.assertFalse(prof.has_sufficient_history)
        self.assertEqual(prof.attack_strength, 1.0)
        # Uncertainty U = 1 / sqrt(1 + 1) = 0.707
        self.assertGreater(prof.uncertainty, 0.65)

    def test_sufficient_sample_shrinks_with_prior_k(self):
        estimator = TeamStrengthEstimator()
        cutoff = datetime(2024, 8, 20, tzinfo=timezone.utc)
        matches = []
        base_dt = datetime(2024, 6, 1, tzinfo=timezone.utc)
        for i in range(10):
            matches.append(
                make_match(
                    f"m_{i}", "ENG_PL",
                    base_dt + timedelta(days=i * 5),
                    "manchester-city", "opponent", 3, 1
                )
            )
        prof = estimator.estimate_team_strength("manchester-city", "ENG_PL", matches, cutoff)

        self.assertEqual(prof.matches_analyzed, 10)
        self.assertTrue(prof.has_sufficient_history)
        # Uncertainty U = 1 / sqrt(10 + 1) = 0.302
        self.assertLess(prof.uncertainty, 0.35)
        # Attack strength is elevated but shrunken
        self.assertGreater(prof.attack_strength, 1.15)


class TestMultiModelEnsemble(unittest.TestCase):
    """Verifies consensus blending, Model A/B/C/D integration, and disagreement variance."""

    def test_ensemble_consensus_and_disagreement_calculation(self):
        ensemble = MultiModelEnsemble()
        out = ensemble.evaluate_fixture(
            lambda_h=1.45,
            lambda_a=1.20,
            home_team="arsenal",
            away_team="chelsea",
            uncertainty=0.18
        )

        self.assertEqual(out.ensemble_version, "v2.0.0-ensemble")
        self.assertGreaterEqual(len(out.candidate_models), 2)
        s1x2 = out.p_home_win + out.p_draw + out.p_away_win
        self.assertAlmostEqual(s1x2, 1.00, delta=0.01)
        self.assertLess(out.disagreement_variance_1x2, 0.05)
        self.assertIsInstance(out.is_high_disagreement, bool)


class TestMonteCarloSimulationExact250k(unittest.TestCase):
    """Verifies that exactly 250,000 iterations are run and incomplete runs are rejected."""

    def test_simulation_exact_250k_completion(self):
        engine = MonteCarloSimulationEngine()
        result = engine.simulate_fixture(
            lambda_home=1.70,
            lambda_away=1.05,
            canonical_key="ENG_PL:arsenal:chelsea:20260910"
        )
        self.assertEqual(result.status, "completed")
        self.assertEqual(result.completed_simulations, 250000)
        self.assertEqual(result.job.completed_count, 250000)
        self.assertEqual(result.job.status, "COMPLETED")

    def test_simulation_rejects_incomplete_draws(self):
        engine = MonteCarloSimulationEngine()
        result = engine.simulate_fixture(
            lambda_home=1.70,
            lambda_away=1.05,
            exact_simulations_override=100000
        )
        self.assertEqual(result.status, "failed")
        self.assertEqual(result.completed_simulations, 100000)
        self.assertEqual(result.job.status, "FAILED")
        self.assertIn("Simulation gate failure", str(result.job.error_info))


class TestConvergenceAndAnalyticalConsistency(unittest.TestCase):
    """Verifies convergence checkpoints (25k-250k) and analytical Dixon-Coles agreement."""

    def test_convergence_checkpoints_and_stability(self):
        engine = MonteCarloSimulationEngine()
        result = engine.simulate_fixture(
            lambda_home=1.55,
            lambda_away=1.15
        )
        report = result.sanity_report
        self.assertIsNotNone(report)
        self.assertTrue(report.is_valid)

        cps = result.convergence_checkpoints
        for target_n in [25000, 50000, 100000, 150000, 200000, 250000]:
            self.assertIn(target_n, cps)

        self.assertTrue(report.convergence_stable)
        self.assertLessEqual(report.convergence_delta, 0.50)
        self.assertTrue(report.analytical_agreement_ok)
        self.assertLessEqual(report.max_analytical_discrepancy, 0.015)


class TestDedicatedNegativeBinomialCornerModel(unittest.TestCase):
    """Verifies overdispersed corner model and sampling."""

    def test_corner_model_probabilities(self):
        corner_model = DedicatedCornerModel(dispersion_r=8.0)
        res = corner_model.predict_corners(home_corner_rate=5.5, away_corner_rate=4.5)
        self.assertEqual(res["expected_corners"], 10.0)
        self.assertGreaterEqual(res["over_8_5"], 0.0)
        self.assertLessEqual(res["over_8_5"], 1.0)
        self.assertAlmostEqual(res["over_8_5"] + res["under_8_5"], 1.0, delta=0.01)

    def test_corner_simulation_vectorized(self):
        engine = MonteCarloSimulationEngine()
        res = engine.simulate_fixture(
            lambda_home=1.5,
            lambda_away=1.0,
            corner_parameters={"lambda_corners_total": 9.5, "corner_r": 8.0}
        )
        self.assertTrue(res.corners_simulated)
        self.assertIsNotNone(res.corners_avg)
        self.assertGreaterEqual(res.corners_avg, 7.0)
        self.assertLessEqual(res.corners_avg, 12.0)


class TestAbstentionGating(unittest.TestCase):
    """Verifies that high uncertainty and high disagreement trigger true abstention."""

    def test_high_uncertainty_forces_skip(self):
        candidates = [
            QualifyingPrediction(
                market_name="1x2",
                outcome="home",
                probability_pct=85.0,
                raw_probability=0.85,
                confidence_tier="VERY_HIGH",
                publication_status="published",
                tier_required="free",
                is_qualifying=True
            )
        ]
        decision = MarketCalibrator.select_primary_banker(
            candidate_predictions=candidates,
            uncertainty=0.55
        )
        self.assertEqual(decision.status, "NO_QUALIFYING_MARKET")
        self.assertEqual(decision.market_name, "NO_SAFE_BANKER")
        self.assertEqual(decision.outcome, "SKIP")
        self.assertIn("Excessive parameter uncertainty", str(decision.rejection_reason))

    def test_high_disagreement_penalizes_confidence(self):
        candidates = [
            QualifyingPrediction(
                market_name="1x2",
                outcome="home",
                probability_pct=78.0,
                raw_probability=0.78,
                confidence_tier="VERY_HIGH",
                publication_status="published",
                tier_required="free",
                is_qualifying=True
            )
        ]
        decision = MarketCalibrator.select_primary_banker(
            candidate_predictions=candidates,
            uncertainty=0.20,
            is_high_disagreement=True
        )
        if decision.status == "QUALIFIED":
            # Confidence tier must be demoted and cannot remain VERY_HIGH
            self.assertNotEqual(decision.confidence_tier, "VERY_HIGH")
            self.assertIn(decision.confidence_tier, ("HIGH", "MEDIUM", "LOW"))


class TestUIEligibilityInvariants(unittest.TestCase):
    """Verifies that internal states (NOT_READY, QUARANTINED, etc.) are never published."""

    FORBIDDEN_STATES = {
        "NOT_READY", "NOT READY", "PENDING PREDICTION", "AWAITING PREDICTION",
        "UNPREDICTED", "PROCESSING", "NO PREDICTION", "INSUFFICIENT DATA",
        "QUARANTINED", "CONFLICT", "HOLD"
    }

    def test_no_forbidden_status_in_published_outcomes(self):
        engine = MonteCarloSimulationEngine()
        res = engine.simulate_fixture(lambda_home=1.60, lambda_away=1.20)
        for outcome in res.market_outcomes:
            self.assertNotIn(outcome.outcome.upper(), self.FORBIDDEN_STATES)
            self.assertNotIn(outcome.market_name.upper(), self.FORBIDDEN_STATES)


if __name__ == "__main__":
    unittest.main()
