"""
Unit tests for Oddsbanta Autonomous Tennis Prediction & Markov Simulation Engine (Phase 3)
Invariant: Pure isolated mathematical testing. Zero dependencies on football code.
"""

import unittest
from src.tennis.markov import TennisMarkovModel
from src.tennis.simulation import TennisMonteCarloSimulator
from src.tennis.prediction_engine import TennisPredictionEngine


class TestTennisPredictionEngine(unittest.TestCase):

    def test_markov_game_hold_monotonicity(self):
        # Higher serve point win probability must yield strictly higher game hold probability
        p_low = TennisMarkovModel.game_hold_probability(0.55)
        p_med = TennisMarkovModel.game_hold_probability(0.65)
        p_high = TennisMarkovModel.game_hold_probability(0.75)

        self.assertLess(p_low, p_med)
        self.assertLess(p_med, p_high)
        self.assertGreater(p_med, 0.80)  # Standard ATP server holds >80%

    def test_markov_tiebreak_symmetry(self):
        # Equal players should have exactly ~50% chance of winning tiebreak
        tb_50 = TennisMarkovModel.tiebreak_win_probability(p1_serve_pt=0.65, p2_serve_pt=0.65)
        self.assertAlmostEqual(tb_50, 0.50, places=2)

        # Dominant server should win majority of tiebreaks
        tb_dom = TennisMarkovModel.tiebreak_win_probability(p1_serve_pt=0.72, p2_serve_pt=0.58)
        self.assertGreater(tb_dom, 0.70)

    def test_markov_set_distribution_sum(self):
        # Sum of set score probabilities must equal exactly 1.0
        set_res = TennisMarkovModel.set_outcome_probabilities(p1_serve_pt=0.66, p2_serve_pt=0.63)
        prob_sum = sum(set_res["score_distribution"].values())
        self.assertAlmostEqual(prob_sum, 1.0, places=2)
        self.assertGreater(set_res["expected_set_games"], 8.5)
        self.assertLess(set_res["expected_set_games"], 12.0)

    def test_monte_carlo_convergence(self):
        # Run 50,000 simulations and compare with Markov analytical probability
        p1_pt, p2_pt = 0.67, 0.62
        markov_res = TennisMarkovModel.match_probabilities(p1_pt, p2_pt, best_of_sets=3)
        sim = TennisMonteCarloSimulator(default_simulations=50000)
        sim_res = sim.simulate_match(p1_pt, p2_pt, best_of_sets=3, num_simulations=50000)

        # Difference between Markov analytical and Monte Carlo empirical should be < 1.5%
        self.assertAlmostEqual(markov_res["p1_win_match"], sim_res.p1_win_prob, delta=0.015)
        self.assertEqual(sim_res.simulations_count, 50000)
        self.assertIn("-2.5", sim_res.game_handicaps)
        self.assertIn("21.5", sim_res.total_games_over)

    def test_zero_hallucination_banker_filter(self):
        # When favorite probability is low (<60%), must classify as NO_SAFE_BANKER
        engine = TennisPredictionEngine()
        sim_res = engine.simulator.simulate_match(p1_serve_pt=0.62, p2_serve_pt=0.61, num_simulations=5000)
        p1 = {"display_name": "Player A"}
        p2 = {"display_name": "Player B"}

        market, label, prob, tier = engine._select_best_market_and_tier(
            player1=p1, player2=p2, sim_res=sim_res, elo_diff=5.0
        )
        self.assertEqual(tier, "NO_SAFE_BANKER")
        self.assertEqual(market, "NO_SAFE_BANKER")
        self.assertEqual(prob, 0.5000)


if __name__ == "__main__":
    unittest.main()
