"""
Unit tests for Oddsbanta Autonomous Tennis Settlement & Audit Engine (Phase 4)
Invariant: Pure isolated testing of tennis settlement rules. Zero football dependencies.
"""

import unittest
from src.tennis.settlement import TennisSettlementEngine


class TestTennisSettlementRules(unittest.TestCase):

    def setUp(self):
        self.fixture_base = {
            "id": "fix_test_123",
            "player1_id": "p1_id",
            "player2_id": "p2_id",
            "player1": {"display_name": "Jannik Sinner"},
            "player2": {"display_name": "Carlos Alcaraz"},
            "best_of_sets": 3,
        }

    def test_parse_total_games(self):
        scores = ["6-4", "3-6", "7-6(5)"]
        p1_g, p2_g, total = TennisSettlementEngine.parse_total_games(scores)
        self.assertEqual(p1_g, 16)
        self.assertEqual(p2_g, 16)
        self.assertEqual(total, 32)

    def test_finished_match_winner_won_and_lost(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 0,
            "set_scores": ["6-4", "6-2"]
        })

        # Predict Sinner Win -> WON
        status, notes, actual = TennisSettlementEngine.evaluate_prediction(
            market="match_winner",
            prediction_text="Jannik Sinner Win",
            fixture=fix
        )
        self.assertEqual(status, "won")
        self.assertIn("Jannik Sinner won 2-0", actual)

        # Predict Alcaraz Win -> LOST
        status_lost, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="match_winner",
            prediction_text="Carlos Alcaraz Win",
            fixture=fix
        )
        self.assertEqual(status_lost, "lost")

    def test_set_handicap_settlement(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 1,
            "set_scores": ["6-4", "4-6", "6-3"]
        })

        # Sinner -1.5 Sets (Needs 2-0, won 2-1) -> LOST
        status_minus, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="set_handicap",
            prediction_text="Jannik Sinner -1.5 Sets",
            fixture=fix
        )
        self.assertEqual(status_minus, "lost")

        # Alcaraz +1.5 Sets (Won 1 set) -> WON
        status_plus, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="set_handicap",
            prediction_text="Carlos Alcaraz +1.5 Sets",
            fixture=fix
        )
        self.assertEqual(status_plus, "won")

    def test_game_handicap_settlement(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 0,
            "set_scores": ["6-3", "6-4"]  # Sinner 12, Alcaraz 7 -> diff +5
        })

        status_cover, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="game_handicap",
            prediction_text="Jannik Sinner -3.5 Games",
            fixture=fix
        )
        self.assertEqual(status_cover, "won")

        status_fail, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="game_handicap",
            prediction_text="Carlos Alcaraz +3.5 Games",
            fixture=fix
        )
        self.assertEqual(status_fail, "lost")

    def test_total_games_over_under(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 0,
            "set_scores": ["6-4", "7-6"]  # 10 + 13 = 23 games
        })

        status_over, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="total_games_over_under",
            prediction_text="Over 21.5 Games",
            fixture=fix
        )
        self.assertEqual(status_over, "won")

        status_under, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="total_games_over_under",
            prediction_text="Under 21.5 Games",
            fixture=fix
        )
        self.assertEqual(status_under, "lost")

    def test_retirement_one_set_rule(self):
        # Case 1: Retired in set 1 (before completion) -> VOID
        fix_early = dict(self.fixture_base)
        fix_early.update({
            "status": "retired",
            "winner_id": "p1_id",
            "retired_player_id": "p2_id",
            "set_scores": ["3-2"]
        })
        st_early, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="match_winner",
            prediction_text="Jannik Sinner Win",
            fixture=fix_early
        )
        self.assertEqual(st_early, "void")

        # Case 2: Retired after set 1 completed -> WON for advancing player
        fix_late = dict(self.fixture_base)
        fix_late.update({
            "status": "retired",
            "winner_id": "p1_id",
            "retired_player_id": "p2_id",
            "set_scores": ["6-3", "2-1"]
        })
        st_late, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="match_winner",
            prediction_text="Jannik Sinner Win",
            fixture=fix_late
        )
        self.assertEqual(st_late, "won")

    def test_over_2_5_sets_settlement(self):
        fix_3sets = dict(self.fixture_base)
        fix_3sets.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 1,
            "set_scores": ["6-4", "4-6", "6-3"]
        })

        st_over, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="set_handicap",
            prediction_text="Over 2.5 Sets",
            fixture=fix_3sets
        )
        self.assertEqual(st_over, "won")

        st_under, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="set_handicap",
            prediction_text="Under 2.5 Sets",
            fixture=fix_3sets
        )
        self.assertEqual(st_under, "lost")

        # Straight sets 2-0 match
        fix_2sets = dict(self.fixture_base)
        fix_2sets.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 0,
            "set_scores": ["6-4", "6-3"]
        })
        st_over2, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="set_handicap",
            prediction_text="Over 2.5 Sets",
            fixture=fix_2sets
        )
        self.assertEqual(st_over2, "lost")

    def test_game_handicap_with_player1_numbered_name(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 0,
            "set_scores": ["6-2", "6-3"]  # P1: 12, P2: 5 -> diff +7
        })

        # Test with "Player 1 -4.5 Games" to ensure the '1' in Player 1 is not parsed as handicap
        status, notes, _ = TennisSettlementEngine.evaluate_prediction(
            market="game_handicap",
            prediction_text="Player 1 -4.5 Games",
            fixture=fix
        )
        self.assertEqual(status, "won")
        self.assertIn("Game handicap -4.5 covered", notes)

    def test_first_set_winner_settlement(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 1,
            "set_scores": ["4-6", "6-3", "6-2"]  # Alcaraz (P2) won 1st set 6-4
        })

        # Sinner 1st set -> lost
        st_sinner, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="first_set_winner",
            prediction_text="Jannik Sinner 1st Set",
            fixture=fix
        )
        self.assertEqual(st_sinner, "lost")

        # Alcaraz 1st set -> won
        st_alcaraz, _, _ = TennisSettlementEngine.evaluate_prediction(
            market="first_set_winner",
            prediction_text="Carlos Alcaraz 1st Set",
            fixture=fix
        )
        self.assertEqual(st_alcaraz, "won")

    def test_no_safe_banker_void(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 0,
            "set_scores": ["6-4", "6-3"]
        })

        status, notes, _ = TennisSettlementEngine.evaluate_prediction(
            market="NO_SAFE_BANKER",
            prediction_text="NO SAFE BANKER (High Volatility)",
            fixture=fix
        )
        self.assertEqual(status, "void")
        self.assertIn("non-wagering void", notes)

    def test_evaluate_secondary_predictions_all_markets(self):
        fix = dict(self.fixture_base)
        fix.update({
            "status": "finished",
            "winner_id": "p1_id",
            "score_p1_sets": 2,
            "score_p2_sets": 0,
            "set_scores": ["6-3", "6-4"]  # P1: 12, P2: 7 (total 19)
        })

        secs = [
            {"market": "game_handicap", "prediction": "Jannik Sinner -3.5 Games", "probability": 0.65},
            {"market": "first_set_winner", "prediction": "Jannik Sinner 1st Set", "probability": 0.72},
            {"market": "set_handicap", "prediction": "Jannik Sinner -1.5 Sets", "probability": 0.60},
            {"market": "total_games_over_under", "prediction": "Under 21.5 Games", "probability": 0.58}
        ]

        settled = TennisSettlementEngine.evaluate_secondary_predictions(secs, fix)
        self.assertEqual(len(settled), 4)

        # Spread: 12 - 7 = +5 -> covers -3.5 -> WON
        self.assertEqual(settled[0]["settlement_status"], "won")
        # 1st Set: 6-3 -> Sinner won -> WON
        self.assertEqual(settled[1]["settlement_status"], "won")
        # Set HC: 2-0 -> covers -1.5 -> WON
        self.assertEqual(settled[2]["settlement_status"], "won")
        # Total Games: 19 < 21.5 -> Under covered -> WON
        self.assertEqual(settled[3]["settlement_status"], "won")


if __name__ == "__main__":
    unittest.main()
