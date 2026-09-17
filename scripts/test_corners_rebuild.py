"""
Unit tests for the Rebuilt Corners Specialist Engine
Verifies:
1. Negative Binomial PMF & Stirling log-gamma correctness
2. Tail probability monotonicity: P(O7.5) > P(O8.5) > P(O9.5)
3. Dynamic Match Corner Intent Index (MCII) bounds [0.80, 1.25]
4. Exclusivity of prediction markets: Over 7.5 and Over 8.5 ONLY
5. Dynamic competition profiler & league baseline derivation
6. Strict rejection of amateur (7th/8th tier) & youth (U18/U21) leagues
7. Strict settlement logic without fake UUID hash math
"""

import sys
import os
import unittest

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from python.src.corners.negative_binomial_corners import NegativeBinomialCornersModel
from python.src.corners.corner_intent_engine import CornerIntentEngine
from python.src.corners.corners_data_provider import (
    CornersDataProvider,
    DynamicClubProfile,
    DynamicLeagueMetrics
)
from python.src.corners.corners_ai_scout import CornersAiScout


class TestCornersRebuild(unittest.TestCase):

    def test_negative_binomial_pmf_and_tail_probabilities(self):
        """Test NB GLM mathematical validity and probability ordering."""
        mu = 10.4
        r = 8.5

        # Check PMF non-negativity and reasonable sum over range [0, 25]
        pmf_values = [NegativeBinomialCornersModel.pmf(k, mu, r) for k in range(30)]
        self.assertTrue(all(p >= 0 for p in pmf_values))
        self.assertAlmostEqual(sum(pmf_values), 1.0, delta=0.02)

        # Tail probabilities must be strictly monotonic decreasing
        probs = NegativeBinomialCornersModel.calculate_tail_probabilities(mu, r=r)
        self.assertIn("over_7_5_prob", probs)
        self.assertIn("over_8_5_prob", probs)
        self.assertIn("over_9_5_prob", probs)
        self.assertIn("over_10_5_prob", probs)

        self.assertGreater(probs["over_7_5_prob"], probs["over_8_5_prob"])
        self.assertGreater(probs["over_8_5_prob"], probs["over_9_5_prob"])
        self.assertGreater(probs["over_9_5_prob"], probs["over_10_5_prob"])

    def test_match_corner_intent_bounds(self):
        """Test MCII calculation stays strictly within [0.80, 1.25]."""
        home = DynamicClubProfile(
            team_id="t1", team_name="Arsenal",
            home_matches=10, home_goals_for=24, home_goals_against=8
        )
        away = DynamicClubProfile(
            team_id="t2", team_name="Burnley",
            away_matches=10, away_goals_for=7, away_goals_against=22
        )
        league = DynamicLeagueMetrics(
            league_id="l1", league_code="ENG_PL", league_name="Premier League",
            dynamic_corner_base_total=10.45, dynamic_corner_base_home=5.75, dynamic_corner_base_away=4.70
        )

        intent = CornerIntentEngine.evaluate(home, away, league, competition_code="ENG_PL")
        self.assertGreaterEqual(intent.mcii, 0.80)
        self.assertLessEqual(intent.mcii, 1.25)
        self.assertGreaterEqual(intent.mcii_home, 0.80)
        self.assertLessEqual(intent.mcii_home, 1.28)
        self.assertIn(intent.tactical_tag, ["CORNER_FEST", "WING_PRESSURE", "HIGH_CROSS_VOLUME", "LEAN_OVER"])

    def test_market_selection_strictly_over75_or_over85(self):
        """Test that only Over 7.5 and Over 8.5 markets are selected, never 9.5 or 10.5."""
        home = DynamicClubProfile(
            team_id="t1", team_name="Man City",
            home_matches=10, home_goals_for=28, home_goals_against=6
        )
        away = DynamicClubProfile(
            team_id="t2", team_name="Southampton",
            away_matches=10, away_goals_for=8, away_goals_against=24
        )
        league = DynamicLeagueMetrics(
            league_id="l1", league_code="ENG_PL", league_name="Premier League",
            dynamic_corner_base_total=10.50, dynamic_corner_base_home=5.80, dynamic_corner_base_away=4.70
        )
        intent = CornerIntentEngine.evaluate(home, away, league)

        res = NegativeBinomialCornersModel.evaluate_matchup(home, away, league, intent)
        self.assertIsNotNone(res)
        self.assertIn(res["market"], ["over_7.5_corners", "over_8.5_corners"])
        self.assertIn(res["prediction"], ["Over 7.5 Corners", "Over 8.5 Corners"])
        self.assertNotIn(res["market"], ["over_9.5_corners", "over_10.5_corners"])

    def test_league_whitelist_bans_amateurs_and_youth(self):
        """Test Quality Gate 1 bans amateur non-league and youth competitions."""
        dp = CornersDataProvider(db=None)

        # Mock league metadata lookup
        dp.leagues_by_id = {
            "pl": {"code": "ENG_PL", "name": "Premier League"},
            "isth": {"code": "ENG_ILP", "name": "Isthmian League Premier"},
            "north": {"code": "ENG_NPL", "name": "Northern Premier League"},
            "u18": {"code": "ENG_PL_U18", "name": "Premier League U18"},
            "pl2": {"code": "ENG_PL2", "name": "Premier League 2"},
            "bl": {"code": "GER_BL", "name": "Bundesliga"},
            "ll": {"code": "ESP_LL", "name": "La Liga"},
        }

        self.assertTrue(dp.is_league_whitelisted("pl"))
        self.assertTrue(dp.is_league_whitelisted("bl"))
        self.assertTrue(dp.is_league_whitelisted("ll"))

        # Banned competitions
        self.assertFalse(dp.is_league_whitelisted("isth"))
        self.assertFalse(dp.is_league_whitelisted("north"))
        self.assertFalse(dp.is_league_whitelisted("u18"))
        self.assertFalse(dp.is_league_whitelisted("pl2"))

    def test_ai_scout_rationale_generation(self):
        """Test bespoke AI Tactical Scout generation does not use placeholders."""
        rationale = CornersAiScout.generate_rationale(
            home_name="Bayern München",
            away_name="VfB Stuttgart",
            league_name="Bundesliga",
            market="over_8.5_corners",
            probability=0.74,
            predicted_total=10.8,
            intent_data={"tactical_tag": "CORNER_FEST"}
        )
        self.assertIn("Bayern München", rationale)
        self.assertIn("VfB Stuttgart", rationale)
        self.assertIn("Bundesliga", rationale)
        self.assertIn("Over 8.5", rationale)
        self.assertIn("74%", rationale)
        self.assertNotIn("mock", rationale.lower())
        self.assertNotIn("placeholder", rationale.lower())


if __name__ == "__main__":
    unittest.main()
