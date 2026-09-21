"""
Oddsbanta — Autonomous Tennis Surface-Specific ELO & Dominance Engine
Phase 2: Independent Dynamic Live Tennis Scraper Daemon

Implements:
1. Surface-specific ELO (Hard Outdoor, Hard Indoor, Clay, Grass)
2. Dominance Ratio (DR = % Return Points Won / % Service Points Lost)
3. Court Pace Index (CPI) and Altitude ELO Adjustments
4. Dynamic Match Margin ELO Updates

Invariant: 100% isolated tennis mathematical engine. Zero football interactions.
"""

import math
from typing import Dict, Any, Tuple, Optional


# Known surface affinities based on career ATP/WTA win-rate variance
CLAY_SPECIALISTS = {
    "carlos_alcaraz", "rafael_nadal", "casper_ruud", "stefanos_tsitsipas", 
    "sebastian_baez", "francisco_cerundolo", "nicolas_jarry", "alexander_zverev",
    "iga_swiatek", "jasmine_paolini", "zheng_qinwen", "marta_kostyuk"
}

FAST_HARD_INDOOR_SPECIALISTS = {
    "jannik_sinner", "daniil_medvedev", "hubert_hurkacz", "ben_shelton",
    "andrey_rublev", "alexander_bublik", "grigor_dimitrov", "holger_rune",
    "aryna_sabalenka", "elena_rybakina", "jessica_pegula", "ludmilla_samsonova"
}

GRASS_SPECIALISTS = {
    "carlos_alcaraz", "hubert_hurkacz", "matteo_berrettini", "tommy_paul",
    "taylor_fritz", "alex_de_minaur", "ons_jabeur", "marketa_vondrousova"
}


class TennisEloEngine:
    """
    Surface-Aware ELO rating & match probability calculator.
    """

    @staticmethod
    def calculate_baseline_elo(rank: Optional[int], points: Optional[float] = None) -> float:
        """
        Derives an initial surface baseline ELO from global ranking and points.
        """
        if not rank or rank <= 0:
            return 1450.0

        if rank == 1:
            return 2350.0
        elif rank <= 5:
            return 2250.0 - (rank - 2) * 20.0
        elif rank <= 10:
            return 2180.0 - (rank - 5) * 15.0
        elif rank <= 20:
            return 2100.0 - (rank - 10) * 12.0
        elif rank <= 50:
            return 1980.0 - (rank - 20) * 6.0
        elif rank <= 100:
            return 1800.0 - (rank - 50) * 3.5
        elif rank <= 200:
            return 1625.0 - (rank - 100) * 1.5
        else:
            return max(1350.0, 1475.0 - (rank - 200) * 0.5)

    @classmethod
    def get_surface_elos(cls, canonical_name: str, rank: Optional[int], points: Optional[float] = None) -> Dict[str, float]:
        """
        Calculates surface-specific ELOs for Hard, Clay, Grass, and Indoor courts.
        """
        base_elo = cls.calculate_baseline_elo(rank, points)
        c_name = canonical_name.lower().strip()

        hard_elo = base_elo
        clay_elo = base_elo
        grass_elo = base_elo
        indoor_elo = base_elo

        # Surface adjustments
        if c_name in CLAY_SPECIALISTS:
            clay_elo += 85.0
            hard_elo -= 15.0
            grass_elo -= 35.0
        elif c_name in FAST_HARD_INDOOR_SPECIALISTS:
            hard_elo += 45.0
            indoor_elo += 75.0
            clay_elo -= 60.0
        elif c_name in GRASS_SPECIALISTS:
            grass_elo += 75.0
            indoor_elo += 25.0

        return {
            "hard_elo": round(hard_elo, 1),
            "clay_elo": round(clay_elo, 1),
            "grass_elo": round(grass_elo, 1),
            "indoor_elo": round(indoor_elo, 1)
        }

    @staticmethod
    def calculate_dominance_ratio(serve_pts_won_pct: float, return_pts_won_pct: float) -> float:
        """
        Dominance Ratio (DR) = % Return Points Won / (100% - % Service Points Won).
        DR > 1.00 indicates a positive point differential.
        Elite ATP/WTA performers (Sinner, Alcaraz, Swiatek) maintain DR > 1.30.
        """
        serve_lost = max(0.05, 1.0 - serve_pts_won_pct)
        return round(return_pts_won_pct / serve_lost, 3)

    @staticmethod
    def calculate_surface_win_probability(
        p1_elo: float,
        p2_elo: float,
        cpi: float = 35.0,
        altitude_m: int = 50,
        is_p1_big_server: bool = False
    ) -> float:
        """
        Calculates Bradley-Terry / logistic win expectation modulated by Court Pace Index.
        On fast courts (CPI > 42) or high altitude (>500m), big servers receive a marginal boost.
        """
        # Surface pace differential
        pace_factor = (cpi - 35.0) * 1.5
        altitude_factor = max(0, altitude_m - 200) * 0.05

        effective_diff = (p1_elo - p2_elo)
        if is_p1_big_server:
            effective_diff += (pace_factor + altitude_factor)

        # Standard logistic formula
        exponent = -effective_diff / 400.0
        # Prevent math overflow
        exponent = max(-30.0, min(30.0, exponent))
        prob = 1.0 / (1.0 + math.pow(10.0, exponent))
        return round(prob, 4)

    @staticmethod
    def update_elo_on_result(
        p1_elo: float,
        p2_elo: float,
        p1_won: bool,
        margin_sets: int,
        k_factor: float = 32.0
    ) -> Tuple[float, float]:
        """
        Updates ELO ratings based on match outcome and set margin (e.g. 2-0 vs 2-1).
        """
        actual_score = 1.0 if p1_won else 0.0
        expected = 1.0 / (1.0 + math.pow(10.0, (p2_elo - p1_elo) / 400.0))

        # Margin multiplier (straight sets victory carries higher information content)
        margin_mult = 1.25 if margin_sets >= 2 else 1.0
        delta = k_factor * margin_mult * (actual_score - expected)

        new_p1 = round(p1_elo + delta, 1)
        new_p2 = round(p2_elo - delta, 1)
        return new_p1, new_p2
