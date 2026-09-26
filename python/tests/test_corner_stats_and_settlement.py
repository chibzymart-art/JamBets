"""
JamBets — Unit Tests for Corner Statistics Scraper and Settlement Engine
Tests multi-platform scraping, 0-0 unrecorded telemetry protection, and void handling.
"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../..')))

from python.src.corners.corner_stats_scraper import CornerStatsScraper
from python.src.corners.corners_settlement_engine import CornersSettlementEngine


class TestCornerStatsScraper(unittest.TestCase):

    def setUp(self):
        self.scraper = CornerStatsScraper()

    def test_normalize_name(self):
        self.assertEqual(self.scraper.normalize_name("Cambridge United FC"), "cambridge united")
        self.assertEqual(self.scraper.normalize_name("AFC Wimbledon"), "wimbledon")
        self.assertEqual(self.scraper.normalize_name("Grêmio FBPA"), "gremio fbpa")
        self.assertEqual(self.scraper.normalize_name("Paris Saint-Germain"), "paris saint germain")

    @patch.object(CornerStatsScraper, '_fetch_espn_corners')
    @patch.object(CornerStatsScraper, '_fetch_livescore_corners')
    def test_fetch_match_corners_falls_back_to_livescore(self, mock_livescore, mock_espn):
        # ESPN has no corners
        mock_espn.return_value = None
        # LiveScore has genuine corners
        mock_livescore.return_value = (7, 4)

        kickoff = datetime.now(timezone.utc)
        result = self.scraper.fetch_match_corners("Cambridge United", "AFC Wimbledon", kickoff, "ENG_L1")

        self.assertEqual(result, (7, 4))
        mock_espn.assert_called_once()
        mock_livescore.assert_called_once()

    def test_enrich_fixture_corners_ignores_0_0_and_scrapes(self):
        # Fixture with unrecorded 0-0 corners
        fixture = {
            "id": "fix-123",
            "home_team_id": "team-h",
            "away_team_id": "team-a",
            "league_id": "lg-1",
            "target_kickoff_at": "2026-09-26T15:00:00Z",
            "corners_home": 0,
            "corners_away": 0
        }

        mock_db = MagicMock()
        mock_db.get.side_effect = lambda table, params: (
            [{"name": "Cambridge United"}] if table == "football_teams" and "team-h" in params.get("id", "")
            else [{"name": "AFC Wimbledon"}] if table == "football_teams" and "team-a" in params.get("id", "")
            else [{"code": "ENG_L1"}] if table == "football_leagues"
            else []
        )

        with patch.object(self.scraper, 'fetch_match_corners', return_value=(8, 1)) as mock_fetch:
            result = self.scraper.enrich_fixture_corners(fixture, mock_db)
            self.assertEqual(result, (8, 1))
            mock_fetch.assert_called_once()
            # Verify DB was patched with authentic corners
            mock_db.patch.assert_called_once_with(
                "football_fixtures",
                {"corners_home": 8, "corners_away": 1},
                {"id": "eq.fix-123"}
            )


class TestCornersSettlementEngine(unittest.TestCase):

    def test_unrecorded_telemetry_voided_not_lost(self):
        """
        Critical test: Fixtures where telemetry providers do NOT track corners
        must NEVER be settled as 0-0 losses. They must be protected as void.
        """
        mock_db = MagicMock()
        engine = CornersSettlementEngine(db=mock_db)

        # Finished match from 4 hours ago with 0-0 unrecorded telemetry
        past_kickoff = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
        mock_fixture = {
            "id": "fix-national-league",
            "status": "finished",
            "period": "FT",
            "target_kickoff_at": past_kickoff,
            "corners_home": 0,
            "corners_away": 0
        }

        mock_pred = {
            "id": "pred-456",
            "fixture_id": "fix-national-league",
            "market": "Over 8.5 Corners",
            "prediction": "Over 8.5 Corners",
            "settlement_status": "pending"
        }

        mock_db.get.side_effect = lambda table, params: (
            [mock_pred] if table == "corner_predictions"
            else [mock_fixture] if table == "football_fixtures"
            else []
        )

        # Scraper also returns None (no telemetry available for this league)
        with patch.object(engine.scraper, 'enrich_fixture_corners', return_value=None):
            result = engine.settle()

            self.assertEqual(result.get("void"), 1)
            self.assertEqual(result.get("lost"), 0)
            self.assertEqual(result.get("won"), 0)

            # Check corner_predictions patch
            mock_db.patch.assert_called_with(
                "corner_predictions",
                {
                    "settlement_status": "void",
                    "actual_corners": "Unrecorded",
                    "settled_at": unittest.mock.ANY,
                    "settlement_notes": unittest.mock.ANY
                },
                {"id": "eq.pred-456"}
            )

    def test_verified_corners_settle_accurately(self):
        """
        Fixtures with authentic corners settle won/lost correctly.
        """
        mock_db = MagicMock()
        engine = CornersSettlementEngine(db=mock_db)

        past_kickoff = (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
        mock_fixture = {
            "id": "fix-epl",
            "status": "finished",
            "period": "FT",
            "target_kickoff_at": past_kickoff,
            "corners_home": 6,
            "corners_away": 4
        }

        mock_pred = {
            "id": "pred-789",
            "fixture_id": "fix-epl",
            "market": "Over 8.5 Corners",
            "prediction": "Over 8.5 Corners",
            "settlement_status": "pending"
        }

        mock_db.get.side_effect = lambda table, params: (
            [mock_pred] if table == "corner_predictions"
            else [mock_fixture] if table == "football_fixtures"
            else []
        )

        result = engine.settle()
        self.assertEqual(result.get("won"), 1)
        self.assertEqual(result.get("lost"), 0)
        self.assertEqual(result.get("void"), 0)

        mock_db.patch.assert_called_with(
            "corner_predictions",
            {
                "settlement_status": "won",
                "actual_corners": "10 corners (6H - 4A)",
                "settled_at": unittest.mock.ANY,
                "settlement_notes": "Verified: Total Corners 10 (6 Home - 4 Away) vs Line 8.5"
            },
            {"id": "eq.pred-789"}
        )


if __name__ == "__main__":
    unittest.main()
