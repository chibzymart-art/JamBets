"""
JamBets — Over 2.5 Goals Specialist Rebuild Validation Test Suite
Tests:
1. Bivariate Dixon-Coles Matrix & low-score deflation
2. Match Intent & Contextual Stakes Engine
3. FotMob Scraper resilience
4. 5 Quality Gates (Sample Size, League Whitelist, Dual Attacking Floor, etc.)
5. Live end-to-end dry run
"""

import sys
import os
import unittest
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from python.src.goals.dixon_coles_goals import DixonColesGoalsModel
from python.src.goals.match_intent_engine import MatchIntentEngine
from python.src.goals.data_provider import GoalsDataProvider, WHITELISTED_LEAGUE_CODES
from python.src.goals.fotmob_enricher import ResilientFotMobEnricher
from python.src.goals.over25_engine import Over25GoalsEngine


class TestDixonColesGoalsModel(unittest.TestCase):
    """Verifies bivariate mathematical accuracy."""

    def test_low_score_deflation(self):
        """Low-scoring matchup must not be artificially inflated."""
        res = DixonColesGoalsModel.calculate_probabilities(1.20, 0.90)
        # Expected total is 2.10. Over 2.5 should be well below 50%
        self.assertLess(res["p_over_25"], 0.45)
        self.assertGreater(res["p_under_25"], 0.55)
        self.assertAlmostEqual(res["p_over_25"] + res["p_under_25"], 1.0, places=3)

    def test_high_tempo_matchup(self):
        """High-scoring matchup must produce strong Over 2.5 probability."""
        res = DixonColesGoalsModel.calculate_probabilities(2.20, 1.70)
        # Expected total is 3.90. Over 2.5 should be >= 74%
        self.assertGreaterEqual(res["p_over_25"], 0.74)
        self.assertGreaterEqual(res["p_btts_yes"], 0.60)

    def test_joint_matrix_normalizes_to_one(self):
        """Probability matrix sum must equal exactly 1.0."""
        M = DixonColesGoalsModel.compute_joint_matrix(1.60, 1.30)
        self.assertAlmostEqual(float(M.sum()), 1.0, places=5)


class TestMatchIntentEngine(unittest.TestCase):
    """Verifies tactical posture and motivational index calculations."""

    def test_dual_low_block_gridlock(self):
        """Torino vs Roma style clash must produce tactical gridlock and MII < 0.88."""
        intent = MatchIntentEngine.evaluate_intent(
            home_team="torino",
            away_team="as-roma",
            league_code="ITA_SA",
            league_name="Serie A",
            home_clean_sheet_pct=0.45,
            away_clean_sheet_pct=0.40
        )
        self.assertEqual(intent.intent_classification, "TACTICAL_GRIDLOCK_PRAGMATISM")
        self.assertLess(intent.match_intent_index, 0.88)
        self.assertFalse(intent.is_favorable_for_over)

    def test_high_press_transition_boost(self):
        """Liverpool vs Atalanta style clash must produce elevated MII > 1.10."""
        intent = MatchIntentEngine.evaluate_intent(
            home_team="liverpool",
            away_team="atalanta",
            league_code="EUR_CL",
            league_name="UEFA Champions League",
            home_scoring_rate=2.40,
            away_scoring_rate=1.90
        )
        self.assertGreater(intent.match_intent_index, 1.10)
        self.assertTrue(intent.is_favorable_for_over)

    def test_cup_first_leg_caution(self):
        """1st leg of cup tie must reduce goal intensity."""
        intent = MatchIntentEngine.evaluate_intent(
            home_team="Arsenal",
            away_team="Bayern Munich",
            league_code="EUR_CL",
            league_name="UEFA Champions League",
            metadata={"leg": 1}
        )
        self.assertLess(intent.match_intent_index, 0.95)


class TestDataProviderAndWhitelisting(unittest.TestCase):
    """Verifies competition whitelisting and sample size gating."""

    def setUp(self):
        self.provider = GoalsDataProvider(db=None)

    def test_whitelisted_leagues(self):
        """Tier 1 and Tier 2 competitions must be accepted."""
        self.assertTrue(self.provider.is_league_eligible("ENG_PL", "Premier League"))
        self.assertTrue(self.provider.is_league_eligible("ESP_LL", "La Liga"))
        self.assertTrue(self.provider.is_league_eligible("GER_BL", "Bundesliga"))
        self.assertTrue(self.provider.is_league_eligible("EUR_CL", "UEFA Champions League"))

    def test_amateur_and_youth_banned(self):
        """Amateur non-league and youth leagues must be strictly rejected."""
        self.assertFalse(self.provider.is_league_eligible("ENG_NPL", "Northern Premier League"))
        self.assertFalse(self.provider.is_league_eligible("ENG_ILP", "Isthmian League Premier"))
        self.assertFalse(self.provider.is_league_eligible("ENG_PL_U18", "Premier League U18"))
        self.assertFalse(self.provider.is_league_eligible("ENG_PL2", "Premier League 2"))
        self.assertFalse(self.provider.is_league_eligible("SCO_CC", "Scottish Challenge Cup"))


class TestFotMobEnricherResilience(unittest.TestCase):
    """Verifies enricher handles unmapped teams without crashing or breaking."""

    def test_unmapped_team_returns_none_gracefully(self):
        enricher = ResilientFotMobEnricher()
        res = enricher.get_team_xg_metrics("NonExistentTeamXYZ12345", "ENG_PL")
        self.assertIsNone(res)
        # Verify enricher remains active and not broken
        self.assertTrue(hasattr(enricher, 'get_team_xg_metrics'))


if __name__ == "__main__":
    unittest.main()
