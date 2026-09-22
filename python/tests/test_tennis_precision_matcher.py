"""
Unit tests for Tennis Precision Matcher and Settlement Feed Extraction (Phase 1)
Tests:
- Exact ESPN competition ID matching
- Canonical player matching (both normal and reversed orders)
- Temporal guardrails (rejection of old/prior-day or distant matches)
- Tournament identity validation
- Inverted scoreline and winner alignment
- Robust set score swapping including tiebreaks
"""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "python") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "python"))

import unittest
from datetime import datetime, timezone

from python.src.tennis.scraper.espn_feed import EspnTennisFeedScraper, TennisFixtureMatcher


class TestTennisPrecisionMatcher(unittest.TestCase):

    def setUp(self):
        self.fixture = {
            "id": "fix-uuid-12345",
            "canonical_key": "WTA:korea_open:renata_zarazua-anna_bondar:20260922",
            "tour": "WTA",
            "player1_id": "p1-uuid-zarazua",
            "player2_id": "p2-uuid-bondar",
            "target_kickoff_at": "2026-09-22T04:30:00+00:00",
            "player1": {"canonical_name": "renata_zarazua", "display_name": "Renata Zarazua"},
            "player2": {"canonical_name": "anna_bondar", "display_name": "Anna Bondar"},
            "tournament": {"name": "Korea Open", "tour": "WTA"},
            "metadata": {
                "espn_competition_id": "184033"
            }
        }

    def test_exact_competition_id_match(self):
        comp = {
            "espn_competition_id": "184033",
            "tour": "WTA",
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "target_kickoff_at": "2026-09-22T04:30:00+00:00",
            "tournament_slug": "korea_open"
        }
        self.assertTrue(TennisFixtureMatcher.match(self.fixture, comp))

    def test_match_without_id_using_players_and_date(self):
        fix_no_id = dict(self.fixture)
        fix_no_id["metadata"] = {}

        comp = {
            "espn_competition_id": "999999",
            "tour": "WTA",
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "target_kickoff_at": "2026-09-22T05:15:00+00:00",  # 45 mins court delay on same day
            "tournament_slug": "korea_open"
        }
        self.assertTrue(TennisFixtureMatcher.match(fix_no_id, comp))

    def test_match_with_inverted_player_order(self):
        fix_no_id = dict(self.fixture)
        fix_no_id["metadata"] = {}

        comp = {
            "espn_competition_id": "999999",
            "tour": "WTA",
            "player1": {"canonical_name": "anna_bondar"},  # Inverted order
            "player2": {"canonical_name": "renata_zarazua"},
            "target_kickoff_at": "2026-09-22T04:30:00+00:00",
            "tournament_slug": "korea_open"
        }
        self.assertTrue(TennisFixtureMatcher.match(fix_no_id, comp))

    def test_reject_old_prior_day_fixture(self):
        """Strict requirement: Must NEVER match a match from 2 days ago or different round."""
        fix_no_id = dict(self.fixture)
        fix_no_id["metadata"] = {}

        # Same players played 2 days ago in qualifications or previous tournament
        old_comp = {
            "espn_competition_id": "old_123",
            "tour": "WTA",
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "target_kickoff_at": "2026-09-20T04:30:00+00:00",  # 2 days prior
            "tournament_slug": "korea_open"
        }
        self.assertFalse(TennisFixtureMatcher.match(fix_no_id, old_comp))

    def test_reject_future_distant_fixture(self):
        fix_no_id = dict(self.fixture)
        fix_no_id["metadata"] = {}

        future_comp = {
            "espn_competition_id": "future_123",
            "tour": "WTA",
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "target_kickoff_at": "2026-09-25T04:30:00+00:00",  # 3 days ahead
            "tournament_slug": "korea_open"
        }
        self.assertFalse(TennisFixtureMatcher.match(fix_no_id, future_comp))

    def test_reject_different_tournament(self):
        fix_no_id = dict(self.fixture)
        fix_no_id["metadata"] = {}

        wrong_tourn_comp = {
            "espn_competition_id": "diff_tourn",
            "tour": "WTA",
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "target_kickoff_at": "2026-09-22T04:30:00+00:00",
            "tournament_slug": "turk_telekom_ankara_open"  # Different tournament
        }
        self.assertFalse(TennisFixtureMatcher.match(fix_no_id, wrong_tourn_comp))

    def test_reject_different_tour(self):
        fix_no_id = dict(self.fixture)
        fix_no_id["metadata"] = {}

        wrong_tour_comp = {
            "espn_competition_id": "diff_tour",
            "tour": "ATP",  # ATP instead of WTA
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "target_kickoff_at": "2026-09-22T04:30:00+00:00",
            "tournament_slug": "korea_open"
        }
        self.assertFalse(TennisFixtureMatcher.match(fix_no_id, wrong_tour_comp))

    def test_swap_set_score_utility(self):
        self.assertEqual(TennisFixtureMatcher.swap_set_score("6-4"), "4-6")
        self.assertEqual(TennisFixtureMatcher.swap_set_score("7-6(5)"), "6(5)-7")
        self.assertEqual(TennisFixtureMatcher.swap_set_score("6(3)-7"), "7-6(3)")
        self.assertEqual(TennisFixtureMatcher.swap_set_score("6-0"), "0-6")

    def test_align_scores_normal_order(self):
        comp = {
            "espn_competition_id": "184033",
            "status": "finished",
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "score_p1_sets": 1,
            "score_p2_sets": 2,
            "set_scores": ["6-2", "3-6", "1-6"],
            "winner_canonical": "anna_bondar",
            "was_retired": False,
            "was_walkover": False
        }
        aligned = TennisFixtureMatcher.align_scores(self.fixture, comp)
        self.assertEqual(aligned["score_p1_sets"], 1)
        self.assertEqual(aligned["score_p2_sets"], 2)
        self.assertEqual(aligned["set_scores"], ["6-2", "3-6", "1-6"])
        self.assertEqual(aligned["winner_id"], "p2-uuid-bondar")
        self.assertEqual(aligned["espn_competition_id"], "184033")

    def test_align_scores_inverted_order(self):
        """If ESPN lists Anna Bondar as player 1 and Renata Zarazua as player 2."""
        comp = {
            "espn_competition_id": "184033",
            "status": "finished",
            "player1": {"canonical_name": "anna_bondar"},
            "player2": {"canonical_name": "renata_zarazua"},
            "score_p1_sets": 2,  # Bondar won 2 sets
            "score_p2_sets": 1,  # Zarazua won 1 set
            "set_scores": ["2-6", "6-3", "6-1"],  # from Bondar's perspective
            "winner_canonical": "anna_bondar",
            "was_retired": False,
            "was_walkover": False
        }
        aligned = TennisFixtureMatcher.align_scores(self.fixture, comp)
        # Fixture player1 is Zarazua (1 set), player2 is Bondar (2 sets)
        self.assertEqual(aligned["score_p1_sets"], 1)
        self.assertEqual(aligned["score_p2_sets"], 2)
        # set scores must be oriented Zarazua vs Bondar
        self.assertEqual(aligned["set_scores"], ["6-2", "3-6", "1-6"])
        self.assertEqual(aligned["winner_id"], "p2-uuid-bondar")

    def test_align_scores_retired_match(self):
        comp = {
            "espn_competition_id": "184033",
            "status": "retired",
            "player1": {"canonical_name": "renata_zarazua"},
            "player2": {"canonical_name": "anna_bondar"},
            "score_p1_sets": 0,
            "score_p2_sets": 1,
            "set_scores": ["4-6", "0-2"],
            "winner_canonical": "anna_bondar",
            "retired_player_canonical": "renata_zarazua",
            "was_retired": True,
            "was_walkover": False
        }
        aligned = TennisFixtureMatcher.align_scores(self.fixture, comp)
        self.assertEqual(aligned["status"], "retired")
        self.assertTrue(aligned["was_retired"])
        self.assertEqual(aligned["winner_id"], "p2-uuid-bondar")
        self.assertEqual(aligned["retired_player_id"], "p1-uuid-zarazua")


if __name__ == "__main__":
    unittest.main()
