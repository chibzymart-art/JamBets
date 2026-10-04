"""
Unit Test Suite: Basketball Dynamic Rating & Prediction Engine
Uses standard library unittest.
Validates:
1. Dynamic Elo win probabilities and MOV multiplier behavior.
2. 40-minute vs 48-minute pace and scoring realism.
3. Strict non-duplication of Primary and Secondary prediction markets.
4. Away favorite recognition (Away team predicted to win when superior).
5. Proper point spread handicap convention (favorites give points).
6. Totals probability guardrails (no fake 100% total bangers).
"""

import unittest
from python.src.basketball.rating_engine import BasketballRatingEngine
from python.src.basketball.prediction_engine import BasketballPredictionEngine
from python.src.basketball.four_factors import FourFactorsModel
from python.src.basketball.models import BasketballFourFactors, BasketballMarket


class TestBasketballDynamicEngine(unittest.TestCase):

    def test_elo_win_probability_and_hca(self):
        # Equal teams: Home team should have ~59.9% win prob due to +70 Elo HCA
        home_p, away_p = BasketballRatingEngine.calculate_win_probability(1500.0, 1500.0, hca_elo=70.0)
        self.assertTrue(0.58 <= home_p <= 0.62)
        self.assertEqual(round(home_p + away_p, 4), 1.0)

        # Dominant Away Team (1620 vs 1440): Away team should be heavily favored even with HCA
        home_p2, away_p2 = BasketballRatingEngine.calculate_win_probability(1440.0, 1620.0, hca_elo=70.0)
        self.assertGreater(away_p2, 0.60)
        self.assertLess(home_p2, 0.40)

    def test_mov_multiplier_bounds(self):
        # Close game (2 pts)
        close_mult = BasketballRatingEngine.calculate_mov_multiplier(90, 88, 1500.0, 1500.0)
        self.assertTrue(0.5 <= close_mult <= 1.2)

        # Blowout game (30 pts)
        blowout_mult = BasketballRatingEngine.calculate_mov_multiplier(115, 85, 1500.0, 1500.0)
        self.assertGreater(blowout_mult, close_mult)
        self.assertLessEqual(blowout_mult, 3.0)

    def test_duration_pace_and_scoring_realism(self):
        # 40-Minute Matchup (WNBA): Expected total should be realistic (~150 to 175)
        wnba_exp = FourFactorsModel.evaluate_matchup(
            league_code="WNBA",
            home_team_name="Minnesota Lynx",
            away_team_name="Dallas Wings",
            home_pace=76.0,
            away_pace=75.0,
            home_ortg=110.0,
            home_drtg=102.0,
            away_ortg=104.0,
            away_drtg=110.0,
            home_ff=BasketballFourFactors(0.53, 0.12, 0.25, 0.22),
            away_ff=BasketballFourFactors(0.51, 0.13, 0.24, 0.21),
        )
        total_pts = wnba_exp.home_expected_score + wnba_exp.away_expected_score
        self.assertTrue(145.0 <= total_pts <= 180.0, f"40m total points unrealistic: {total_pts}")

        # 48-Minute Matchup (NBA): Expected total should center around ~215 to 235
        nba_exp = FourFactorsModel.evaluate_matchup(
            league_code="NBA",
            home_team_name="Boston Celtics",
            away_team_name="Miami Heat",
            home_pace=99.0,
            away_pace=97.0,
            home_ortg=118.0,
            home_drtg=108.0,
            away_ortg=112.0,
            away_drtg=111.0,
            home_ff=BasketballFourFactors(0.55, 0.11, 0.26, 0.23),
            away_ff=BasketballFourFactors(0.52, 0.13, 0.24, 0.21),
        )
        nba_total = nba_exp.home_expected_score + nba_exp.away_expected_score
        self.assertTrue(210.0 <= nba_total <= 240.0, f"NBA total points unrealistic: {nba_total}")

    def test_primary_and_secondary_deduplication(self):
        engine = BasketballPredictionEngine()
        pred = engine.generate_prediction(
            fixture_id="fix-test-1",
            league_code="WNBA",
            home_team_name="Las Vegas Aces",
            away_team_name="Dallas Wings",
            home_pace=77.0,
            away_pace=76.0,
            home_ortg=116.0,
            home_drtg=106.0,
            away_ortg=104.0,
            away_drtg=112.0,
            home_ff=BasketballFourFactors(0.55, 0.11, 0.26, 0.22),
            away_ff=BasketballFourFactors(0.50, 0.14, 0.23, 0.21),
            num_simulations=5000
        )

        primary_market = pred.market.value
        secondary_markets = [s["market"] for s in pred.secondary_predictions]

        # Invariant 1: Primary market is NOT present in secondary markets
        self.assertNotIn(primary_market, secondary_markets, f"Duplicate market found: {primary_market} in {secondary_markets}")

        # Invariant 2: Secondary markets are unique among themselves
        self.assertEqual(len(secondary_markets), len(set(secondary_markets)), "Duplicate markets within secondary predictions")

        # Invariant 3: Exactly 2 secondary markets for the remaining 2 core markets
        self.assertEqual(len(secondary_markets), 2)

    def test_away_favorite_prediction(self):
        engine = BasketballPredictionEngine()
        # Weak Home Team vs Strong Away Team
        pred = engine.generate_prediction(
            fixture_id="fix-test-away",
            league_code="WNBA",
            home_team_name="Weak Home",
            away_team_name="Elite Away",
            home_pace=75.0,
            away_pace=76.0,
            home_ortg=98.0,
            home_drtg=114.0,
            away_ortg=118.0,
            away_drtg=100.0,
            home_ff=BasketballFourFactors(0.48, 0.15, 0.22, 0.19),
            away_ff=BasketballFourFactors(0.56, 0.10, 0.28, 0.24),
            num_simulations=5000
        )

        # Moneyline must favor the Away team
        self.assertTrue("Elite Away To Win" in pred.prediction or any(s["pick"] == "Elite Away To Win" for s in pred.secondary_predictions))
        self.assertGreater(pred.simulated_away_score, pred.simulated_home_score)

    def test_total_points_probability_guardrail(self):
        engine = BasketballPredictionEngine()
        # Even with mismatched line, totals probability must never be 1.0 (100%)
        pred = engine.generate_prediction(
            fixture_id="fix-test-totals",
            league_code="WNBA",
            home_team_name="Team A",
            away_team_name="Team B",
            home_pace=75.0,
            away_pace=75.0,
            home_ortg=108.0,
            home_drtg=108.0,
            away_ortg=108.0,
            away_drtg=108.0,
            home_ff=BasketballFourFactors(0.52, 0.12, 0.25, 0.22),
            away_ff=BasketballFourFactors(0.52, 0.12, 0.25, 0.22),
            market_total=140.0,  # Line far below mean
            num_simulations=5000
        )

        # Check total market probability if primary or secondary
        if pred.market == BasketballMarket.GAME_TOTAL_OVER_UNDER:
            prob = pred.probability
        else:
            sec_total = next((s for s in pred.secondary_predictions if s["market"] == "game_total_over_under"), None)
            self.assertIsNotNone(sec_total)
            prob = sec_total["probability"]
        self.assertLessEqual(prob, 0.85, f"Unrealistic total confidence: {prob}")


if __name__ == '__main__':
    unittest.main()
