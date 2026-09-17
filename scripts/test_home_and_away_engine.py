"""
JamBets — Unit Test Suite for Home & Away 1X2 Specialist Engine
Validates:
1. Dixon-Coles Bivariate Poisson 3-way distribution coherence (P(H) + P(D) + P(A) == 1.0).
2. Low-scoring correlation adjustment tau(x, y).
3. Dual signal emission: Home Win for home fortresses and Away Win for road titans.
4. Selective quality gates rejecting symmetric / low-margin fixtures.
5. Settlement rules for both Home Win and Away Win picks.
"""

import unittest
from unittest.mock import MagicMock
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from python.src.engines.home_and_away_engine import DixonColes1X2Model, HomeAndAwayEngine
from python.src.engines.specialist_settlements import SpecialistSettlementPipeline


class TestDixonColes1X2Model(unittest.TestCase):

    def test_probabilities_sum_to_one(self):
        """Validates that 3-way outcomes strictly sum to 1.0."""
        test_pairs = [(1.8, 0.9), (0.8, 1.9), (1.2, 1.2), (2.5, 1.1), (0.5, 2.2)]
        for lh, la in test_pairs:
            ph, pd, pa = DixonColes1X2Model.calculate_3way_probabilities(lh, la)
            total = ph + pd + pa
            self.assertAlmostEqual(total, 1.0, places=2)
            self.assertGreater(ph, 0.0)
            self.assertGreater(pd, 0.0)
            self.assertGreater(pa, 0.0)

    def test_tau_low_score_adjustment(self):
        """Tests that Dixon-Coles low-score interdependence function adjusts probabilities."""
        tau_00 = DixonColes1X2Model.tau(0, 0, 1.5, 1.0, rho=-0.08)
        self.assertGreater(tau_00, 1.0)  # negative rho increases 0-0 probability
        tau_22 = DixonColes1X2Model.tau(2, 2, 1.5, 1.0, rho=-0.08)
        self.assertEqual(tau_22, 1.0)    # scores > 1 have no tau adjustment


class TestHomeAndAwayEngine(unittest.TestCase):

    def setUp(self):
        self.mock_db = MagicMock()
        self.engine = HomeAndAwayEngine(db=self.mock_db)

    def test_home_fortress_pick_generation(self):
        """A strong host vs weak away team must qualify as a high-conviction Home Win."""
        strong_home = {
            "matches": 10, "home_matches": 6,
            "home_goals_for": 16.0, "home_goals_against": 3.0,
            "home_clean_sheets": 4
        }
        weak_away = {
            "matches": 10, "away_matches": 6,
            "away_goals_for": 4.0, "away_goals_against": 14.0,
            "away_clean_sheets": 0
        }

        res = self.engine.evaluate_matchup(strong_home, weak_away)
        self.assertIsNotNone(res)
        self.assertEqual(res["prediction"], "Home Win")
        self.assertEqual(res["market"], "home_win")
        self.assertGreaterEqual(res["probability"], 0.60)
        self.assertIn(res["dominance_tier"], ["FORTRESS_LOCK", "HIGH_DOMINANCE"])
        self.assertIn("Tactical fortress edge", res["tactical_rationale"])

    def test_away_titan_pick_generation(self):
        """A weak host vs strong road favorite must qualify as a high-conviction Away Win."""
        weak_home = {
            "matches": 10, "home_matches": 6,
            "home_goals_for": 4.0, "home_goals_against": 14.0,
            "home_clean_sheets": 0
        }
        strong_away = {
            "matches": 10, "away_matches": 6,
            "away_goals_for": 16.0, "away_goals_against": 3.0,
            "away_clean_sheets": 4
        }

        res = self.engine.evaluate_matchup(weak_home, strong_away)
        self.assertIsNotNone(res)
        self.assertEqual(res["prediction"], "Away Win")
        self.assertEqual(res["market"], "away_win")
        self.assertGreaterEqual(res["probability"], 0.44)
        self.assertIn(res["dominance_tier"], ["ROAD_TITAN", "COUNTER_AMBUSH", "VALUE_EDGE"])
        self.assertIn("Lethal road supremacy", res["tactical_rationale"])

    def test_symmetric_tight_match_rejected(self):
        """Equally matched teams must be rejected by the selective quality gates."""
        team_a = {
            "matches": 10, "home_matches": 5, "away_matches": 5,
            "home_goals_for": 6.0, "home_goals_against": 6.0, "away_goals_for": 5.0, "away_goals_against": 5.0,
            "home_clean_sheets": 1, "away_clean_sheets": 1
        }
        team_b = {
            "matches": 10, "home_matches": 5, "away_matches": 5,
            "home_goals_for": 6.0, "home_goals_against": 6.0, "away_goals_for": 5.0, "away_goals_against": 5.0,
            "home_clean_sheets": 1, "away_clean_sheets": 1
        }

        res = self.engine.evaluate_matchup(team_a, team_b)
        self.assertIsNone(res)  # Should reject tight match


class TestHomeAndAwaySettlement(unittest.TestCase):

    def setUp(self):
        self.mock_db = MagicMock()
        self.pipeline = SpecialistSettlementPipeline(db=self.mock_db)

    def test_home_win_settlement_rules(self):
        """Home Win pick wins if Home > Away, loses on Draw or Away Win."""
        # 1. 2-0 Home Win -> WON
        self.mock_db.get.side_effect = [
            [{"id": "p-1", "fixture_id": "f-1", "prediction": "Home Win", "market": "home_win"}],
            [{"id": "f-1", "status": "finished", "home_score": 2, "away_score": 0}]
        ]
        res = self.pipeline.settle_home_and_away()
        self.assertEqual(res["won"], 1)

        # 2. 1-1 Draw -> LOST
        self.mock_db.get.side_effect = [
            [{"id": "p-2", "fixture_id": "f-2", "prediction": "Home Win", "market": "home_win"}],
            [{"id": "f-2", "status": "finished", "home_score": 1, "away_score": 1}]
        ]
        res = self.pipeline.settle_home_and_away()
        self.assertEqual(res["lost"], 1)

    def test_away_win_settlement_rules(self):
        """Away Win pick wins if Away > Home, loses on Draw or Home Win."""
        # 1. 0-2 Away Win -> WON
        self.mock_db.get.side_effect = [
            [{"id": "p-3", "fixture_id": "f-3", "prediction": "Away Win", "market": "away_win"}],
            [{"id": "f-3", "status": "finished", "home_score": 0, "away_score": 2}]
        ]
        res = self.pipeline.settle_home_and_away()
        self.assertEqual(res["won"], 1)

        # 2. 2-1 Home Win -> LOST for Away Win pick
        self.mock_db.get.side_effect = [
            [{"id": "p-4", "fixture_id": "f-4", "prediction": "Away Win", "market": "away_win"}],
            [{"id": "f-4", "status": "finished", "home_score": 2, "away_score": 1}]
        ]
        res = self.pipeline.settle_home_and_away()
        self.assertEqual(res["lost"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
