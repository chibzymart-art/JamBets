"""
JamBets — Unit Test Suite for Standalone 1H Over 0.5 Goals Blitz Engine
Validates:
1. HalfTimeDixonColesModel matrix normalization and probability precision.
2. Exponential survival hazard model for expected first-goal minute.
3. FirstHalfIntentEngine classification, FHTI bounds, and tactical urgency.
4. League whitelisting and Quality Gate filtering logic.
"""

import unittest
import numpy as np
import sys
import os

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from python.src.goals.ht_dixon_coles import HalfTimeDixonColesModel
from python.src.goals.first_half_intent_engine import FirstHalfIntentEngine
from python.src.goals.data_provider import GoalsDataProvider, WHITELISTED_LEAGUE_CODES


class TestHtOver05Rebuild(unittest.TestCase):

    def test_ht_dixon_coles_normalization(self):
        """Validates that 5x5 joint probability matrix sums exactly to 1.0."""
        res = HalfTimeDixonColesModel.calculate_probabilities(0.85, 0.65)
        self.assertIn("p_ht_over05", res)
        self.assertIn("p_ht_under05", res)
        self.assertAlmostEqual(res["p_ht_over05"] + res["p_ht_under05"], 1.0, places=3)

    def test_ht_over05_probability_low_scoring(self):
        """Verifies that low goal expectation produces calibrated low 1H probabilities."""
        # Low scoring clash: lambda_h = 0.40, lambda_a = 0.30
        res = HalfTimeDixonColesModel.calculate_probabilities(0.40, 0.30)
        self.assertLess(res["p_ht_over05"], 0.55)
        self.assertGreater(res["p_ht_under05"], 0.45)
        # Expected first goal minute should be delayed (around 28-34 mins)
        self.assertGreaterEqual(res["expected_first_goal_minute"], 26)

    def test_ht_over05_probability_high_tempo(self):
        """Verifies that high goal expectation produces high 1H probabilities."""
        # High scoring clash: lambda_h = 1.10, lambda_a = 0.90
        res = HalfTimeDixonColesModel.calculate_probabilities(1.10, 0.90)
        self.assertGreaterEqual(res["p_ht_over05"], 0.83)
        # Expected first goal minute should be early (around 16-22 mins)
        self.assertLessEqual(res["expected_first_goal_minute"], 22)

    def test_first_goal_minute_hazard(self):
        """Validates that higher lambda directly accelerates expected first goal minute."""
        res_fast = HalfTimeDixonColesModel.calculate_probabilities(1.20, 1.00)
        res_slow = HalfTimeDixonColesModel.calculate_probabilities(0.40, 0.35)
        self.assertLess(res_fast["expected_first_goal_minute"], res_slow["expected_first_goal_minute"])

    def test_first_half_intent_derby_caution(self):
        """Verifies that high-tension derbies have pragmatic early-feeling-out penalties."""
        intent = FirstHalfIntentEngine.evaluate_first_half_intent(
            home_team="Arsenal",
            away_team="Tottenham Hotspur North London Derby",
            league_code="ENG_PL",
            league_name="Premier League"
        )
        self.assertEqual(intent.early_strike_tempo, "PRAGMATIC_FEELING_OUT")
        self.assertLessEqual(intent.first_half_intent_index, 0.90)

    def test_first_half_intent_blitz_press(self):
        """Verifies that high-scoring offensive sides trigger BLITZ_HIGH_PRESS."""
        intent = FirstHalfIntentEngine.evaluate_first_half_intent(
            home_team="Bayern Munich",
            away_team="Borussia Dortmund",
            league_code="GER_BL",
            league_name="Bundesliga",
            home_scoring_rate=2.40,
            away_scoring_rate=1.80,
            home_clean_sheet_pct=0.10,
            away_clean_sheet_pct=0.10
        )
        self.assertEqual(intent.early_strike_tempo, "BLITZ_HIGH_PRESS")
        self.assertGreaterEqual(intent.first_half_intent_index, 1.10)
        self.assertTrue(intent.is_favorable_for_ht05)

    def test_first_half_intent_cup_first_leg(self):
        """Verifies that two-legged knockout 1st legs have cageyness discount."""
        intent = FirstHalfIntentEngine.evaluate_first_half_intent(
            home_team="Real Madrid",
            away_team="Manchester City",
            league_code="EUR_CL",
            league_name="Champions League",
            competition_stage="Semi Final 1st Leg"
        )
        self.assertEqual(intent.early_strike_tempo, "KNOCKOUT_CAUTION")
        self.assertLessEqual(intent.first_half_intent_index, 0.88)

    def test_first_half_intent_cup_second_leg(self):
        """Verifies that two-legged knockout 2nd leg decider triggers urgency boost."""
        intent = FirstHalfIntentEngine.evaluate_first_half_intent(
            home_team="Real Madrid",
            away_team="Manchester City",
            league_code="EUR_CL",
            league_name="Champions League",
            competition_stage="Semi Final 2nd Leg"
        )
        self.assertEqual(intent.early_strike_tempo, "BLITZ_HIGH_PRESS")
        self.assertGreaterEqual(intent.first_half_intent_index, 1.15)

    def test_league_whitelist_enforcement(self):
        """Validates that Tier 1/2 leagues are whitelisted and amateur leagues are rejected."""
        provider = GoalsDataProvider(db=None)
        # Whitelisted
        self.assertTrue(provider.is_league_eligible("ENG_PL"))
        self.assertTrue(provider.is_league_eligible("GER_BL"))
        self.assertTrue(provider.is_league_eligible("ESP_LL"))
        self.assertTrue(provider.is_league_eligible("ENG_L1"))
        # Banned amateur / youth
        self.assertFalse(provider.is_league_eligible("ENG_ILP"))  # Isthmian
        self.assertFalse(provider.is_league_eligible("ENG_NPL"))  # Northern Premier
        self.assertFalse(provider.is_league_eligible("ENG_U18"))  # U18


if __name__ == "__main__":
    unittest.main()
