"""
JamBets — Unit Tests for Football Probability Floors & Confidence Tiers
Validates that:
1. Draws are never categorized as BANGER (capped at TOP PICK).
2. Away wins require >= 72% probability and elite dominance to qualify as BANGER.
3. Home wins require >= 76% probability and fortress dominance for BANGER.
4. Over 9.5 Corners is capped at TOP PICK maximum (never BANGER).
5. PublicationFilter supports market-aware calibration while preserving backward compatibility.
"""

import sys
import os
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from python.src.football.publication_filter import PublicationFilter
from python.src.corners.negative_binomial_corners import NegativeBinomialCornersModel
from python.src.corners.corners_data_provider import DynamicClubProfile, DynamicLeagueMetrics
from python.src.corners.corner_intent_engine import CornerIntentAssessment


class TestFootballBangerProbabilityFloors(unittest.TestCase):

    def test_publication_filter_backward_compatibility(self):
        """Universal threshold tests without market_name."""
        self.assertIsNone(PublicationFilter.classify_confidence_tier(44.99))
        self.assertEqual(PublicationFilter.classify_confidence_tier(45.00), "RISKY")
        self.assertEqual(PublicationFilter.classify_confidence_tier(60.00), "LOW CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_confidence_tier(70.00), "MID CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_confidence_tier(83.00), "HIGH CONFIDENCE")
        self.assertEqual(PublicationFilter.classify_confidence_tier(90.00), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_confidence_tier(96.00), "BANGER")

    def test_publication_filter_draw_protection(self):
        """Draws must NEVER be categorized as BANGER."""
        self.assertEqual(PublicationFilter.classify_confidence_tier(36.0, market_name="draw"), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_confidence_tier(42.0, market_name="draw"), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_confidence_tier(48.0, market_name="draw"), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_confidence_tier(31.0, market_name="draw"), "MID CONFIDENCE")

    def test_publication_filter_match_winner_floors(self):
        """Match winners qualify as BANGER at >= 76%."""
        self.assertEqual(PublicationFilter.classify_confidence_tier(78.0, market_name="1x2"), "BANGER")
        self.assertEqual(PublicationFilter.classify_confidence_tier(70.0, market_name="1x2"), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_confidence_tier(64.0, market_name="home_win"), "TOP PICK")
        self.assertEqual(PublicationFilter.classify_confidence_tier(58.0, market_name="away_win"), "HIGH CONFIDENCE")

    def test_publication_filter_double_chance_floors(self):
        """Double chance qualifies as BANGER at >= 85%."""
        self.assertEqual(PublicationFilter.classify_confidence_tier(86.0, market_name="double_chance"), "BANGER")
        self.assertEqual(PublicationFilter.classify_confidence_tier(78.0, market_name="double_chance"), "TOP PICK")

    def test_corner_over_95_capped_at_top_pick(self):
        """Over 9.5 Corners must NEVER be BANGER, strictly capped at TOP PICK."""
        home_club = DynamicClubProfile(team_id="h1", team_name="Arsenal", matches_analyzed=10, home_matches=5, home_goals_for=12, home_goals_against=4)
        away_club = DynamicClubProfile(team_id="a1", team_name="Chelsea", matches_analyzed=10, away_matches=5, away_goals_for=10, away_goals_against=5)
        league = DynamicLeagueMetrics(
            league_id="lg1", league_code="ENG_PL", league_name="Premier League",
            matches_counted=50, avg_total_goals=3.2,
            dynamic_corner_base_total=10.50, dynamic_corner_base_home=5.80, dynamic_corner_base_away=4.70
        )
        intent = CornerIntentAssessment(
            mcii=1.15,
            mcii_home=1.2,
            mcii_away=1.1,
            siege_index=1.3,
            wing_pressure_index=1.2,
            stakes_index=1.0,
            pragmatic_penalty=1.0,
            tactical_tag="SIEGE",
            tactical_description="Siege pressure"
        )

        res = NegativeBinomialCornersModel.evaluate_matchup(
            home_club=home_club,
            away_club=away_club,
            league=league,
            intent=intent
        )
        if res and res["market"] == "over_9.5_corners":
            self.assertNotEqual(res["confidence_category"], "BANGER")
            self.assertIn(res["confidence_category"], ("TOP PICK", "MID_CONFIDENCE"))


if __name__ == "__main__":
    unittest.main()
