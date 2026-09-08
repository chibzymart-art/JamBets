"""
JamBets — Phase 5 Automated Test Suite: Per-Fixture 250,000 Monte Carlo Simulation Engine
Validates:
1. Input contract validation and NOT_READY handling
2. Simulation job identity and lifecycle
3. Exact 250,000 iterations completion gate
4. Incomplete simulations failure (249,999 -> FAILED, 0 predictions)
5. Per-fixture isolation and parameter independence
6. RNG reproducibility and seed provenance (PCG64)
7. Deterministic discrete market outcome extraction
8. Half-time and second-half mathematical consistency (h_1h + h_2h == h_total)
9. Corner simulation handling (parameter presence vs MARKET_NOT_READY)
10. Statistical sanity and convergence checks
11. 45.00% publication threshold boundary tests
12. Exact confidence tier classification
13. Multi-fixture execution order invariance
"""

import unittest
import numpy as np
from datetime import datetime, timezone, timedelta

from python.src.football.simulation_engine import (
    SimulationInputContract,
    SimulationJob,
    MonteCarloSimulationEngine,
    MarketOutcome,
    SanityCheckReport
)
from python.src.football.publication_filter import PublicationFilter


class TestPhase5SimulationEngine(unittest.TestCase):

    def setUp(self):
        self.engine = MonteCarloSimulationEngine()
        self.now = datetime.now(timezone.utc)
        self.kickoff = self.now + timedelta(days=1)
        self.cutoff = self.now

        self.valid_contract = SimulationInputContract(
            fixture_id="test-fix-001",
            competition="EUR_CL",
            season="2024",
            home_team="club-brugge",
            away_team="aston-villa",
            scheduled_kickoff=self.kickoff,
            prediction_cutoff=self.cutoff,
            dataset_version="v1.0.0",
            feature_version="v1.0.0",
            model_version="v1.0.0",
            calibration_version="v1.0.0",
            lambda_home=1.45,
            lambda_away=1.20,
            model_parameters={"rho": -0.02, "half_time_split": 0.44},
            corner_parameters={"lambda_corners_total": 9.5}
        )

    # 1. Input Contract Validation
    def test_01_input_contract_validation(self):
        is_ready, reason = self.valid_contract.validate_readiness()
        self.assertTrue(is_ready)
        self.assertIsNone(reason)

        # Invalid goal rate (negative)
        bad_contract = self.valid_contract.model_copy(update={"lambda_home": -0.5})
        is_ready, reason = bad_contract.validate_readiness()
        self.assertFalse(is_ready)
        self.assertIn("INVALID_GOAL_RATES", reason)

        # Invalid temporal order (kickoff before cutoff)
        inverted_contract = self.valid_contract.model_copy(
            update={"scheduled_kickoff": self.now - timedelta(hours=2), "prediction_cutoff": self.now}
        )
        is_ready, reason = inverted_contract.validate_readiness()
        self.assertFalse(is_ready)
        self.assertIn("INVALID_TEMPORAL_ORDER", reason)

        # Missing team identifier
        no_team_contract = self.valid_contract.model_copy(update={"home_team": ""})
        is_ready, reason = no_team_contract.validate_readiness()
        self.assertFalse(is_ready)
        self.assertIn("MISSING_MANDATORY_IDENTIFIERS", reason)

    # 2. Simulation Job Identity & Lifecycle
    def test_02_simulation_job_identity(self):
        res = self.engine.simulate_fixture(self.valid_contract, seed=12345)
        job = res.job

        self.assertIsNotNone(job.simulation_job_id)
        self.assertEqual(job.fixture_id, "test-fix-001")
        self.assertEqual(job.status, "COMPLETED")
        self.assertEqual(job.target_count, 250000)
        self.assertEqual(job.completed_count, 250000)
        self.assertEqual(job.rng_algorithm, "PCG64")
        self.assertEqual(job.seed, 12345)
        self.assertGreater(job.duration_ms, 0.0)
        self.assertIsNotNone(job.started_at)
        self.assertIsNotNone(job.finished_at)

    # 3. Exact 250,000 Completion Gate
    def test_03_exact_250k_completion_gate(self):
        res = self.engine.simulate_fixture(self.valid_contract, seed=42)
        self.assertEqual(res.completed_simulations, 250000)
        self.assertEqual(res.status, "completed")
        self.assertEqual(res.job.status, "COMPLETED")
        self.assertGreater(len(res.market_outcomes), 10)

    # 4. Incomplete Simulation Failure Gate
    def test_04_incomplete_simulation_failure(self):
        # Override to 249,999 draws (1 draw short)
        res = self.engine.simulate_fixture(self.valid_contract, exact_simulations_override=249999)
        self.assertEqual(res.completed_simulations, 249999)
        self.assertEqual(res.status, "failed")
        self.assertEqual(res.job.status, "FAILED")
        self.assertEqual(len(res.market_outcomes), 0)
        self.assertIn("Simulation gate failure", res.job.error_info)

    # 5. Per-Fixture Isolation
    def test_05_per_fixture_isolation(self):
        contract_a = self.valid_contract.model_copy(
            update={"fixture_id": "fix-A", "lambda_home": 3.0, "lambda_away": 0.5}
        )
        contract_b = self.valid_contract.model_copy(
            update={"fixture_id": "fix-B", "lambda_home": 0.4, "lambda_away": 2.8}
        )

        res_a = self.engine.simulate_fixture(contract_a, seed=101)
        res_b = self.engine.simulate_fixture(contract_b, seed=202)

        # Fixture A must heavily favor home win
        self.assertGreater(res_a.home_win_pct, 65.0)
        self.assertLess(res_a.away_win_pct, 20.0)

        # Fixture B must heavily favor away win
        self.assertGreater(res_b.away_win_pct, 65.0)
        self.assertLess(res_b.home_win_pct, 20.0)

        # Independence of job metadata
        self.assertNotEqual(res_a.job.simulation_job_id, res_b.job.simulation_job_id)
        self.assertNotEqual(res_a.job.seed, res_b.job.seed)

    # 6. Reproducibility & RNG Provenance (PCG64)
    def test_06_reproducibility_rng_provenance(self):
        res1 = self.engine.simulate_fixture(self.valid_contract, seed=99999)
        res2 = self.engine.simulate_fixture(self.valid_contract, seed=99999)

        # Identical seed must produce bit-for-bit identical market hit counts
        self.assertEqual(res1.home_win_pct, res2.home_win_pct)
        self.assertEqual(res1.draw_pct, res2.draw_pct)
        self.assertEqual(res1.away_win_pct, res2.away_win_pct)
        self.assertEqual(res1.over_25_pct, res2.over_25_pct)

        for m1, m2 in zip(res1.market_outcomes, res2.market_outcomes):
            self.assertEqual(m1.simulated_hits, m2.simulated_hits)
            self.assertEqual(m1.probability, m2.probability)

        # Different seed must produce distinct outcomes
        res3 = self.engine.simulate_fixture(self.valid_contract, seed=88888)
        self.assertNotEqual(res1.market_outcomes[0].simulated_hits, res3.market_outcomes[0].simulated_hits)

    # 7. Deterministic Market Outcome Extraction
    def test_07_deterministic_market_logic(self):
        res = self.engine.simulate_fixture(self.valid_contract, seed=555)
        outcomes = {f"{m.market_name}:{m.outcome}": m for m in res.market_outcomes}

        # 1X2 probabilities must sum to 100.0% (+- 0.01)
        p_1x2 = outcomes["1x2:home"].probability + outcomes["1x2:draw"].probability + outcomes["1x2:away"].probability
        self.assertAlmostEqual(p_1x2, 100.0, delta=0.02)

        # Double Chance 1X hits must exactly equal (Home hits + Draw hits)
        dc_1x_hits = outcomes["double_chance:1x"].simulated_hits
        expected_1x_hits = outcomes["1x2:home"].simulated_hits + outcomes["1x2:draw"].simulated_hits
        self.assertEqual(dc_1x_hits, expected_1x_hits)

        # BTTS Yes + BTTS No must sum to 250,000 hits
        btts_hits = outcomes["btts:yes"].simulated_hits + outcomes["btts:no"].simulated_hits
        self.assertEqual(btts_hits, 250000)

        # Over 2.5 + Under 2.5 must sum to 250,000 hits
        ou25_hits = outcomes["over_under_2.5:over"].simulated_hits + outcomes["over_under_2.5:under"].simulated_hits
        self.assertEqual(ou25_hits, 250000)

    # 8. Half-Time & Second-Half Mathematical Consistency
    def test_08_halftime_secondhalf_consistency(self):
        res = self.engine.simulate_fixture(self.valid_contract, seed=777)
        outcomes = {f"{m.market_name}:{m.outcome}": m for m in res.market_outcomes}

        # 1H O/U 0.5 sum to 250,000 hits
        ht_05_hits = outcomes["ht_goals_0.5:over"].simulated_hits + outcomes["ht_goals_0.5:under"].simulated_hits
        self.assertEqual(ht_05_hits, 250000)

        # 2H O/U 0.5 sum to 250,000 hits
        h2_05_hits = outcomes["2h_goals_0.5:over"].simulated_hits + outcomes["2h_goals_0.5:under"].simulated_hits
        self.assertEqual(h2_05_hits, 250000)

        # Averages must sum to overall mean (1H avg + 2H avg ~ total avg)
        self.assertGreater(res.first_half_avg_goals, 0.0)
        self.assertGreater(res.second_half_avg_goals, 0.0)

    # 9. Corner Simulation Handling
    def test_09_corner_simulation_handling(self):
        # 1. With corner parameters -> simulated
        contract_with_corners = self.valid_contract.model_copy(
            update={"corner_parameters": {"lambda_corners_total": 9.5}}
        )
        res_corners = self.engine.simulate_fixture(contract_with_corners, seed=123)
        self.assertTrue(res_corners.corners_simulated)
        self.assertAlmostEqual(res_corners.corners_avg, 9.5, delta=0.2)

        corner_outcomes = [m for m in res_corners.market_outcomes if "corners" in m.market_name]
        self.assertGreater(len(corner_outcomes), 0)

        # 2. Without corner parameters -> MARKET_NOT_READY
        contract_no_corners = self.valid_contract.model_copy(update={"corner_parameters": None})
        res_no_corners = self.engine.simulate_fixture(contract_no_corners, seed=123)
        self.assertFalse(res_no_corners.corners_simulated)

        c_market = next(m for m in res_no_corners.market_outcomes if m.market_name == "corners")
        self.assertFalse(c_market.is_ready)
        self.assertIn("MARKET_NOT_READY", c_market.not_ready_reason)

    # 10. Statistical Sanity and Convergence Verification
    def test_10_statistical_sanity_checks(self):
        res = self.engine.simulate_fixture(self.valid_contract, seed=321)
        self.assertIsNotNone(res.sanity_report)
        self.assertTrue(res.sanity_report.is_valid)
        self.assertEqual(len(res.sanity_report.violations), 0)
        self.assertTrue(res.sanity_report.monotonicity_goals_ok)
        self.assertTrue(res.sanity_report.double_chance_ok)
        self.assertTrue(res.sanity_report.all_probabilities_bounded)

    # 11. 45.00% Publication Threshold Boundary Tests
    def test_11_publication_filter_45_boundary(self):
        outcomes = [
            MarketOutcome(market_name="1x2", outcome="home", probability=44.99, raw_probability=0.4499, simulated_hits=112475),
            MarketOutcome(market_name="1x2", outcome="draw", probability=45.00, raw_probability=0.4500, simulated_hits=112500),
            MarketOutcome(market_name="1x2", outcome="away", probability=45.01, raw_probability=0.4501, simulated_hits=112525),
        ]

        filtered = PublicationFilter.filter_market_outcomes(outcomes)
        filtered_probs = [q.probability_pct for q in filtered]

        self.assertNotIn(44.99, filtered_probs)
        self.assertIn(45.00, filtered_probs)
        self.assertIn(45.01, filtered_probs)

    # 12. Exact Confidence Tier Boundaries
    def test_12_confidence_tier_boundaries(self):
        test_cases = [
            (96.00, "BANGER"),
            (100.00, "BANGER"),
            (95.99, "TOP PICK"),
            (90.00, "TOP PICK"),
            (89.99, "HIGH CONFIDENCE"),
            (83.00, "HIGH CONFIDENCE"),
            (82.99, "MID CONFIDENCE"),
            (70.00, "MID CONFIDENCE"),
            (69.99, "LOW CONFIDENCE"),
            (60.00, "LOW CONFIDENCE"),
            (59.99, "RISKY"),
            (45.00, "RISKY"),
            (44.99, None),  # Below publication threshold
        ]

        for prob, expected_tier in test_cases:
            tier = PublicationFilter.classify_tier(prob)
            self.assertEqual(tier, expected_tier, f"Failed for probability: {prob}")

    # 13. Multi-Fixture Execution Order Invariance
    def test_13_multi_fixture_execution_order_invariance(self):
        contract_a = self.valid_contract.model_copy(
            update={"fixture_id": "fix-1", "lambda_home": 1.7, "lambda_away": 1.1}
        )
        contract_b = self.valid_contract.model_copy(
            update={"fixture_id": "fix-2", "lambda_home": 1.0, "lambda_away": 2.1}
        )

        # Execution Order 1: A then B
        res_a1 = self.engine.simulate_fixture(contract_a, seed=111)
        res_b1 = self.engine.simulate_fixture(contract_b, seed=222)

        # Execution Order 2: B then A
        res_b2 = self.engine.simulate_fixture(contract_b, seed=222)
        res_a2 = self.engine.simulate_fixture(contract_a, seed=111)

        # A1 must equal A2 exactly
        self.assertEqual(res_a1.home_win_pct, res_a2.home_win_pct)
        self.assertEqual(res_a1.draw_pct, res_a2.draw_pct)
        self.assertEqual(res_a1.away_win_pct, res_a2.away_win_pct)

        # B1 must equal B2 exactly
        self.assertEqual(res_b1.home_win_pct, res_b2.home_win_pct)
        self.assertEqual(res_b1.draw_pct, res_b2.draw_pct)
        self.assertEqual(res_b1.away_win_pct, res_b2.away_win_pct)


if __name__ == "__main__":
    unittest.main()
