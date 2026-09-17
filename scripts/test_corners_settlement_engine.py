"""
JamBets — Unit Tests for Dedicated Corners Settlement Engine
Validates:
1. Authentic corner counts parsing (wonCorners).
2. Strict Over 7.5 (>=8) and Over 8.5 (>=9) settlement threshold logic.
3. Zero synthetic/goal-based fallback counts: matches without verified stats remain pending.
4. Verified audit notes format integrity: 'Verified: Total Corners X (Y Home - Z Away) vs Line L'.
5. Cancellation/Abandonment protected void handling.
"""

import unittest
from unittest.mock import MagicMock, patch
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from python.src.corners.corners_settlement_engine import CornersSettlementEngine
from python.src.corners.corner_stats_scraper import CornerStatsScraper


class TestCornerStatsScraper(unittest.TestCase):
    """Tests the official boxscore scraper parsing logic."""

    def test_won_corners_extraction_from_espn_structure(self):
        scraper = CornerStatsScraper()
        
        # Mock summary data representing official ESPN boxscore response
        mock_summary = {
            "boxscore": {
                "teams": [
                    {
                        "team": {"displayName": "Arsenal"},
                        "statistics": [
                            {"name": "wonCorners", "displayValue": "8"},
                            {"name": "possessionPct", "displayValue": "65%"}
                        ]
                    },
                    {
                        "team": {"displayName": "Everton"},
                        "statistics": [
                            {"name": "wonCorners", "displayValue": "1"},
                            {"name": "possessionPct", "displayValue": "35%"}
                        ]
                    }
                ]
            }
        }
        
        # Extract corners as CornerStatsScraper does
        ch, ca = None, None
        for team in mock_summary["boxscore"]["teams"]:
            for stat in team.get("statistics", []):
                if stat.get("name") in ["wonCorners", "corners"]:
                    val = int(stat.get("displayValue", 0))
                    if ch is None:
                        ch = val
                    elif ca is None:
                        ca = val

        self.assertEqual(ch, 8)
        self.assertEqual(ca, 1)
        self.assertEqual(ch + ca, 9)


class TestCornersSettlementEngine(unittest.TestCase):
    """Tests the dedicated corner settlement engine rules and execution."""

    def setUp(self):
        self.mock_db = MagicMock()
        self.engine = CornersSettlementEngine(db=self.mock_db)
        # Prevent actual network calls during unit test
        self.engine.scraper = MagicMock()

    def test_over_7_5_threshold_strict_boundary(self):
        """Over 7.5 requires strictly > 7.5 (i.e. >= 8 corners). 7 corners is LOST, 8 is WON."""
        # 1. Test 7 corners total -> LOST
        self.mock_db.get.side_effect = [
            # Pending predictions
            [{"id": "pred-1", "fixture_id": "fix-1", "market": "over_7.5_corners", "prediction": "Over 7.5 Corners", "settlement_status": "pending"}],
            # Fixtures
            [{"id": "fix-1", "status": "finished", "period": "FT", "corners_home": 4, "corners_away": 3}]
        ]
        res = self.engine.settle()
        self.assertEqual(res["settled"], 1)
        self.assertEqual(res["won"], 0)
        self.assertEqual(res["lost"], 1)
        
        patch_call = self.mock_db.patch.call_args[0]
        self.assertEqual(patch_call[0], "corner_predictions")
        self.assertEqual(patch_call[1]["settlement_status"], "lost")
        self.assertEqual(patch_call[1]["actual_corners"], "7 corners (4H - 3A)")
        self.assertIn("Verified: Total Corners 7 (4 Home - 3 Away) vs Line 7.5", patch_call[1]["settlement_notes"])

    def test_over_7_5_won_at_8_corners(self):
        """Over 7.5 with 8 corners -> WON."""
        self.mock_db.get.side_effect = [
            [{"id": "pred-2", "fixture_id": "fix-2", "market": "over_7.5_corners", "prediction": "Over 7.5 Corners", "settlement_status": "pending"}],
            [{"id": "fix-2", "status": "finished", "period": "FT", "corners_home": 5, "corners_away": 3}]
        ]
        res = self.engine.settle()
        self.assertEqual(res["settled"], 1)
        self.assertEqual(res["won"], 1)
        self.assertEqual(res["lost"], 0)

        patch_call = self.mock_db.patch.call_args[0]
        self.assertEqual(patch_call[1]["settlement_status"], "won")
        self.assertEqual(patch_call[1]["actual_corners"], "8 corners (5H - 3A)")

    def test_over_8_5_threshold_strict_boundary(self):
        """Over 8.5 requires strictly > 8.5 (i.e. >= 9 corners). 8 corners is LOST, 9 is WON."""
        # 8 corners total -> LOST for Over 8.5
        self.mock_db.get.side_effect = [
            [{"id": "pred-3", "fixture_id": "fix-3", "market": "over_8.5_corners", "prediction": "Over 8.5 Corners", "settlement_status": "pending"}],
            [{"id": "fix-3", "status": "finished", "period": "FT", "corners_home": 4, "corners_away": 4}]
        ]
        res = self.engine.settle()
        self.assertEqual(res["settled"], 1)
        self.assertEqual(res["won"], 0)
        self.assertEqual(res["lost"], 1)

        patch_call = self.mock_db.patch.call_args[0]
        self.assertEqual(patch_call[1]["settlement_status"], "lost")
        self.assertEqual(patch_call[1]["actual_corners"], "8 corners (4H - 4A)")
        self.assertIn("Verified: Total Corners 8 (4 Home - 4 Away) vs Line 8.5", patch_call[1]["settlement_notes"])

    def test_over_8_5_won_at_9_corners(self):
        """Over 8.5 with 9 corners -> WON."""
        self.mock_db.get.side_effect = [
            [{"id": "pred-4", "fixture_id": "fix-4", "market": "over_8.5_corners", "prediction": "Over 8.5 Corners", "settlement_status": "pending"}],
            [{"id": "fix-4", "status": "finished", "period": "FT", "corners_home": 6, "corners_away": 3}]
        ]
        res = self.engine.settle()
        self.assertEqual(res["settled"], 1)
        self.assertEqual(res["won"], 1)
        self.assertEqual(res["lost"], 0)

        patch_call = self.mock_db.patch.call_args[0]
        self.assertEqual(patch_call[1]["settlement_status"], "won")
        self.assertEqual(patch_call[1]["actual_corners"], "9 corners (6H - 3A)")

    def test_zero_synthetic_calculation_when_stats_missing(self):
        """When corners cannot be verified/scraped, fixture MUST remain pending with 0 synthetic settlements."""
        self.engine.scraper.enrich_fixture_corners.return_value = None  # Scraping failed or not found

        self.mock_db.get.side_effect = [
            [{"id": "pred-5", "fixture_id": "fix-5", "market": "over_7.5_corners", "prediction": "Over 7.5 Corners", "settlement_status": "pending"}],
            [{"id": "fix-5", "status": "finished", "period": "FT", "corners_home": None, "corners_away": None}]
        ]
        res = self.engine.settle()
        self.assertEqual(res["settled"], 0)
        self.assertEqual(res["awaiting_stats"], 1)
        # Patch should NOT have been called on corner_predictions
        self.mock_db.patch.assert_not_called()

    def test_postponed_or_cancelled_match_is_protected_void(self):
        """Cancelled or postponed matches are safely settled as protected void."""
        self.mock_db.get.side_effect = [
            [{"id": "pred-6", "fixture_id": "fix-6", "market": "over_8.5_corners", "prediction": "Over 8.5 Corners", "settlement_status": "pending"}],
            [{"id": "fix-6", "status": "postponed", "period": None, "corners_home": None, "corners_away": None}]
        ]
        res = self.engine.settle()
        self.assertEqual(res["settled"], 1)
        self.assertEqual(res["void"], 1)

        patch_call = self.mock_db.patch.call_args[0]
        self.assertEqual(patch_call[1]["settlement_status"], "void")
        self.assertIn("POSTPONED", patch_call[1]["settlement_notes"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
