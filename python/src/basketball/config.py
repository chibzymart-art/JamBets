"""
Oddsbanta — Autonomous Basketball Engine Configuration & League Registry
Phase 2: Data Acquisition & Canonical League Parameters

Invariant: Completely independent from football/tennis configs.
"""

from dataclasses import dataclass
from typing import Dict, Any, Optional, List


@dataclass(frozen=True)
class BasketballLeagueConfig:
    code: str
    name: str
    country: str
    quarter_minutes: int
    periods_count: int
    default_pace: float
    avg_offensive_rating: float
    espn_slug: Optional[str]
    livescore_keyword: Optional[str]
    hca_points: float = 2.85


# Official League Registry
LEAGUE_REGISTRY: Dict[str, BasketballLeagueConfig] = {
    "NBA": BasketballLeagueConfig(
        code="NBA",
        name="National Basketball Association",
        country="USA",
        quarter_minutes=12,
        periods_count=4,
        default_pace=99.5,
        avg_offensive_rating=115.0,
        espn_slug="nba",
        livescore_keyword="nba",
        hca_points=2.85,
    ),
    "WNBA": BasketballLeagueConfig(
        code="WNBA",
        name="Women's National Basketball Association",
        country="USA",
        quarter_minutes=10,
        periods_count=4,
        default_pace=80.5,
        avg_offensive_rating=104.0,
        espn_slug="wnba",
        livescore_keyword="wnba",
        hca_points=2.50,
    ),
    "NCAA_M": BasketballLeagueConfig(
        code="NCAA_M",
        name="NCAA Men's College Basketball",
        country="USA",
        quarter_minutes=20,
        periods_count=2,
        default_pace=68.5,
        avg_offensive_rating=105.0,
        espn_slug="mens-college-basketball",
        livescore_keyword="ncaa",
        hca_points=3.20,
    ),
    "EUROLEAGUE": BasketballLeagueConfig(
        code="EUROLEAGUE",
        name="Turkish Airlines EuroLeague",
        country="International",
        quarter_minutes=10,
        periods_count=4,
        default_pace=72.0,
        avg_offensive_rating=110.0,
        espn_slug=None,
        livescore_keyword="euroleague",
        hca_points=3.50,
    ),
    "ESP_ACB": BasketballLeagueConfig(
        code="ESP_ACB",
        name="Liga Endesa (ACB)",
        country="Spain",
        quarter_minutes=10,
        periods_count=4,
        default_pace=74.0,
        avg_offensive_rating=108.0,
        espn_slug=None,
        livescore_keyword="acb",
        hca_points=3.00,
    ),
    "AUS_NBL": BasketballLeagueConfig(
        code="AUS_NBL",
        name="National Basketball League (NBL)",
        country="Australia",
        quarter_minutes=10,
        periods_count=4,
        default_pace=86.0,
        avg_offensive_rating=110.0,
        espn_slug=None,
        livescore_keyword="nbl",
        hca_points=2.75,
    ),
    "ITA_LBA": BasketballLeagueConfig(
        code="ITA_LBA",
        name="Lega Basket Serie A",
        country="Italy",
        quarter_minutes=10,
        periods_count=4,
        default_pace=75.0,
        avg_offensive_rating=107.0,
        espn_slug=None,
        livescore_keyword="serie a",
        hca_points=2.90,
    ),
    "TUR_BSL": BasketballLeagueConfig(
        code="TUR_BSL",
        name="Basketbol Super Ligi",
        country="Turkey",
        quarter_minutes=10,
        periods_count=4,
        default_pace=76.0,
        avg_offensive_rating=109.0,
        espn_slug=None,
        livescore_keyword="super ligi",
        hca_points=3.20,
    ),
    "GER_BBL": BasketballLeagueConfig(
        code="GER_BBL",
        name="Basketball Bundesliga (BBL)",
        country="Germany",
        quarter_minutes=10,
        periods_count=4,
        default_pace=75.5,
        avg_offensive_rating=108.0,
        espn_slug=None,
        livescore_keyword="bbl",
        hca_points=2.80,
    ),
}

# Altitude Venues (Elevation Fatigue Bonus in Net Rating)
ALTITUDE_VENUES: Dict[str, float] = {
    "denver nuggets": 4.15,      # Ball Arena, Denver (~5,280 ft)
    "utah jazz": 3.90,           # Delta Center, Salt Lake City (~4,226 ft)
    "crvena zvezda": 3.80,       # Stark Arena, Belgrade (Hostile Atmosphere)
    "partizan": 3.80,            # Stark Arena, Belgrade (Hostile Atmosphere)
    "panathinaikos": 3.80,       # OAKA Altion, Athens (Hostile Atmosphere)
    "olympiacos": 3.80,          # Peace and Friendship Stadium, Piraeus
}

# Schedule Rest & Fatigue Modifiers
FATIGUE_MODIFIERS: Dict[str, float] = {
    "B2B_PENALTY": -2.80,           # Net rating drag on zero days rest
    "THREE_IN_FOUR_PENALTY": -3.60, # Net rating drag on 3 games in 4 nights
    "REST_ADVANTAGE_PER_DAY": 1.60, # Bonus per day of rest advantage
    "MAX_REST_ADVANTAGE": 4.50,     # Max cap on rest advantage differential
}
