"""
Unit tests for Oddsbanta Autonomous Tennis Scraper & Surface Engine (Phase 2)
Invariant: Strict isolation from football tests and components. Uses standard unittest.
"""

import unittest
from src.tennis.cpi_registry import CpiRegistry, KNOWN_TOURNAMENT_PROFILES
from src.tennis.elo_engine import TennisEloEngine
from src.tennis.scraper.espn_feed import EspnTennisFeedScraper


class TestTennisScraperEngine(unittest.TestCase):

    def test_cpi_registry_known_tournaments(self):
        # Grand Slam
        wimbledon = CpiRegistry.resolve_tournament("The Championships Wimbledon", tour="GRAND_SLAM")
        self.assertEqual(wimbledon.surface, "grass")
        self.assertEqual(wimbledon.court_pace_index, 44.0)
        self.assertEqual(wimbledon.tour, "GRAND_SLAM")

        # Fast Clay (Madrid altitude)
        madrid = CpiRegistry.resolve_tournament("Mutua Madrid Open", tour="ATP")
        self.assertEqual(madrid.surface, "clay")
        self.assertEqual(madrid.court_pace_index, 32.5)
        self.assertEqual(madrid.altitude_m, 667)

        # Indoor Hard
        paris = CpiRegistry.resolve_tournament("Rolex Paris Masters", tour="ATP")
        self.assertEqual(paris.surface, "hard_indoor")
        self.assertEqual(paris.court_pace_index, 42.0)

    def test_cpi_registry_heuristics(self):
        # Unindexed tournament with clay in name
        unindexed_clay = CpiRegistry.resolve_tournament("Challenger de Red Clay", tour="CHALLENGER")
        self.assertEqual(unindexed_clay.surface, "clay")
        self.assertEqual(unindexed_clay.court_pace_index, 25.0)

    def test_tennis_elo_engine_surface_adjustments(self):
        # Carlos Alcaraz should receive clay boost
        alcaraz_elos = TennisEloEngine.get_surface_elos("carlos_alcaraz", rank=3)
        self.assertGreater(alcaraz_elos["clay_elo"], alcaraz_elos["hard_elo"])

        # Jannik Sinner should receive hard & indoor boost
        sinner_elos = TennisEloEngine.get_surface_elos("jannik_sinner", rank=1)
        self.assertGreater(sinner_elos["hard_elo"], sinner_elos["clay_elo"])
        self.assertGreater(sinner_elos["indoor_elo"], sinner_elos["clay_elo"])

    def test_tennis_elo_win_probability(self):
        prob_favorite = TennisEloEngine.calculate_surface_win_probability(
            p1_elo=2300.0,
            p2_elo=1800.0,
            cpi=38.0
        )
        self.assertGreater(prob_favorite, 0.90)

        prob_underdog = TennisEloEngine.calculate_surface_win_probability(
            p1_elo=1800.0,
            p2_elo=2300.0,
            cpi=38.0
        )
        self.assertLess(prob_underdog, 0.10)
        self.assertAlmostEqual(prob_favorite + prob_underdog, 1.0, places=3)

    def test_dominance_ratio_calculation(self):
        # Player holds 85% of service points, wins 32% return points
        dr = TennisEloEngine.calculate_dominance_ratio(serve_pts_won_pct=0.85, return_pts_won_pct=0.32)
        expected = 0.32 / (1.0 - 0.85)  # 0.32 / 0.15 = 2.133
        self.assertAlmostEqual(dr, expected, delta=0.01)
        self.assertGreater(dr, 1.30)  # Elite tier

    def test_espn_slugify(self):
        self.assertEqual(EspnTennisFeedScraper.slugify("Jannik Sinner"), "jannik_sinner")
        self.assertEqual(EspnTennisFeedScraper.slugify("Alex de Minaur"), "alex_de_minaur")
        self.assertEqual(EspnTennisFeedScraper.slugify("Petr Bar Biryukov"), "petr_bar_biryukov")

    def test_round_code_mapping(self):
        self.assertEqual(EspnTennisFeedScraper._map_round_code("Men's Singles Final"), "F")
        self.assertEqual(EspnTennisFeedScraper._map_round_code("Semifinals"), "SF")
        self.assertEqual(EspnTennisFeedScraper._map_round_code("Quarterfinals"), "QF")
        self.assertEqual(EspnTennisFeedScraper._map_round_code("Round of 16"), "R16")
        self.assertEqual(EspnTennisFeedScraper._map_round_code("Qualifying 1st Round"), "QUAL")


if __name__ == "__main__":
    unittest.main()
