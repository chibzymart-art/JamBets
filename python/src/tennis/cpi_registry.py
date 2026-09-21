"""
Oddsbanta — Autonomous Tennis Court Pace Index (CPI) & Surface Registry
Phase 2: Independent Dynamic Live Tennis Scraper Daemon

Court Pace Index (CPI) reference scale:
- Slow: 20-29 (Heavy Clay, slow outdoor hard courts like Indian Wells)
- Medium-Slow: 30-34 (Faster clay e.g. Madrid, medium outdoor hard)
- Medium: 35-39 (Standard hard outdoor e.g. US Open, Australian Open, Chengdu)
- Medium-Fast: 40-44 (Indoor hard, Cincinnati, fast hard)
- Fast: 45+ (Wimbledon grass, Halle grass, fast carpet)

Invariant: 100% dedicated to tennis surface mechanics. Zero football dependencies.
"""

import re
from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass
class TournamentProfile:
    name: str
    tour: str  # ATP, WTA, GRAND_SLAM, CHALLENGER, ITF
    category: str  # GS, 1000, 500, 250, CH, ITF
    surface: str  # hard_outdoor, hard_indoor, clay, grass, carpet
    court_pace_index: float  # CPI scale
    altitude_m: int  # Altitude in meters (affects ball speed & bounce)
    city: Optional[str] = None
    country: Optional[str] = None


# Authoritative Database of Premier Tennis Tournaments & Specific Court Speeds
KNOWN_TOURNAMENT_PROFILES = {
    # Grand Slams
    "australian open": TournamentProfile(
        name="Australian Open", tour="GRAND_SLAM", category="GS", surface="hard_outdoor",
        court_pace_index=41.5, altitude_m=31, city="Melbourne", country="Australia"
    ),
    "roland garros": TournamentProfile(
        name="Roland Garros", tour="GRAND_SLAM", category="GS", surface="clay",
        court_pace_index=24.0, altitude_m=35, city="Paris", country="France"
    ),
    "french open": TournamentProfile(
        name="Roland Garros", tour="GRAND_SLAM", category="GS", surface="clay",
        court_pace_index=24.0, altitude_m=35, city="Paris", country="France"
    ),
    "wimbledon": TournamentProfile(
        name="Wimbledon", tour="GRAND_SLAM", category="GS", surface="grass",
        court_pace_index=44.0, altitude_m=40, city="London", country="United Kingdom"
    ),
    "us open": TournamentProfile(
        name="US Open", tour="GRAND_SLAM", category="GS", surface="hard_outdoor",
        court_pace_index=41.0, altitude_m=10, city="New York", country="United States"
    ),

    # ATP / WTA 1000 Masters
    "indian wells": TournamentProfile(
        name="BNP Paribas Open", tour="ATP", category="1000", surface="hard_outdoor",
        court_pace_index=28.5, altitude_m=26, city="Indian Wells", country="United States"
    ),
    "miami open": TournamentProfile(
        name="Miami Open", tour="ATP", category="1000", surface="hard_outdoor",
        court_pace_index=35.5, altitude_m=2, city="Miami", country="United States"
    ),
    "monte carlo": TournamentProfile(
        name="Monte-Carlo Masters", tour="ATP", category="1000", surface="clay",
        court_pace_index=23.0, altitude_m=15, city="Roquebrune-Cap-Martin", country="Monaco"
    ),
    "madrid open": TournamentProfile(
        name="Mutua Madrid Open", tour="ATP", category="1000", surface="clay",
        court_pace_index=32.5, altitude_m=667, city="Madrid", country="Spain"  # High altitude fast clay
    ),
    "mutua madrid": TournamentProfile(
        name="Mutua Madrid Open", tour="ATP", category="1000", surface="clay",
        court_pace_index=32.5, altitude_m=667, city="Madrid", country="Spain"
    ),
    "rome": TournamentProfile(
        name="Internazionali BNL d'Italia", tour="ATP", category="1000", surface="clay",
        court_pace_index=24.5, altitude_m=21, city="Rome", country="Italy"
    ),
    "internazionali bnl d'italia": TournamentProfile(
        name="Internazionali BNL d'Italia", tour="ATP", category="1000", surface="clay",
        court_pace_index=24.5, altitude_m=21, city="Rome", country="Italy"
    ),
    "italian open": TournamentProfile(
        name="Internazionali BNL d'Italia", tour="ATP", category="1000", surface="clay",
        court_pace_index=24.5, altitude_m=21, city="Rome", country="Italy"
    ),
    "canada open": TournamentProfile(
        name="National Bank Open", tour="ATP", category="1000", surface="hard_outdoor",
        court_pace_index=39.0, altitude_m=104, city="Montreal/Toronto", country="Canada"
    ),
    "national bank open": TournamentProfile(
        name="National Bank Open", tour="ATP", category="1000", surface="hard_outdoor",
        court_pace_index=39.0, altitude_m=104, city="Montreal/Toronto", country="Canada"
    ),
    "cincinnati": TournamentProfile(
        name="Cincinnati Open", tour="ATP", category="1000", surface="hard_outdoor",
        court_pace_index=43.0, altitude_m=228, city="Mason", country="United States"
    ),
    "shanghai": TournamentProfile(
        name="Shanghai Masters", tour="ATP", category="1000", surface="hard_outdoor",
        court_pace_index=41.5, altitude_m=4, city="Shanghai", country="China"
    ),
    "paris masters": TournamentProfile(
        name="Rolex Paris Masters", tour="ATP", category="1000", surface="hard_indoor",
        court_pace_index=42.0, altitude_m=33, city="Paris", country="France"
    ),

    # Asia Swing & Autumn Tournaments
    "chengdu": TournamentProfile(
        name="Chengdu Open", tour="ATP", category="250", surface="hard_outdoor",
        court_pace_index=37.0, altitude_m=500, city="Chengdu", country="China"
    ),
    "hangzhou": TournamentProfile(
        name="AITO Hangzhou Open", tour="ATP", category="250", surface="hard_outdoor",
        court_pace_index=38.0, altitude_m=19, city="Hangzhou", country="China"
    ),
    "korea open": TournamentProfile(
        name="Korea Open", tour="WTA", category="500", surface="hard_outdoor",
        court_pace_index=36.0, altitude_m=38, city="Seoul", country="South Korea"
    ),
    "seoul": TournamentProfile(
        name="Korea Open", tour="WTA", category="500", surface="hard_outdoor",
        court_pace_index=36.0, altitude_m=38, city="Seoul", country="South Korea"
    ),
    "beijing": TournamentProfile(
        name="China Open", tour="ATP", category="500", surface="hard_outdoor",
        court_pace_index=37.5, altitude_m=43, city="Beijing", country="China"
    ),
    "china open": TournamentProfile(
        name="China Open", tour="ATP", category="500", surface="hard_outdoor",
        court_pace_index=37.5, altitude_m=43, city="Beijing", country="China"
    ),
    "japan open": TournamentProfile(
        name="Japan Open", tour="ATP", category="500", surface="hard_outdoor",
        court_pace_index=39.0, altitude_m=25, city="Tokyo", country="Japan"
    ),
    "tokyo": TournamentProfile(
        name="Toray Pan Pacific Open", tour="WTA", category="500", surface="hard_outdoor",
        court_pace_index=38.5, altitude_m=25, city="Tokyo", country="Japan"
    ),
    "singapore": TournamentProfile(
        name="Singapore Tennis Open", tour="WTA", category="250", surface="hard_indoor",
        court_pace_index=39.0, altitude_m=15, city="Singapore", country="Singapore"
    ),
    "sp open": TournamentProfile(
        name="SP Open", tour="WTA", category="250", surface="clay",
        court_pace_index=26.0, altitude_m=760, city="Sao Paulo", country="Brazil"
    ),
    "sao paulo": TournamentProfile(
        name="SP Open", tour="WTA", category="250", surface="clay",
        court_pace_index=26.0, altitude_m=760, city="Sao Paulo", country="Brazil"
    ),
    "porto open": TournamentProfile(
        name="Porto Open", tour="WTA", category="CH", surface="hard_outdoor",
        court_pace_index=37.5, altitude_m=85, city="Porto", country="Portugal"
    ),
    "ankara": TournamentProfile(
        name="Ankara Open", tour="WTA", category="CH", surface="hard_indoor",
        court_pace_index=40.5, altitude_m=938, city="Ankara", country="Turkey"
    ),
    "tolentino": TournamentProfile(
        name="Delta Motors Tolentino Open", tour="WTA", category="CH", surface="clay",
        court_pace_index=25.0, altitude_m=230, city="Tolentino", country="Italy"
    ),

    # ATP Finals & Year End
    "atp finals": TournamentProfile(
        name="Nitto ATP Finals", tour="ATP", category="1000", surface="hard_indoor",
        court_pace_index=43.5, altitude_m=239, city="Turin", country="Italy"
    ),
    "wta finals": TournamentProfile(
        name="WTA Finals", tour="WTA", category="1000", surface="hard_indoor",
        court_pace_index=39.0, altitude_m=612, city="Riyadh", country="Saudi Arabia"
    )
}


class CpiRegistry:
    """
    Intelligent surface, court pace, and environmental condition resolver.
    """

    @classmethod
    def resolve_tournament(cls, raw_name: str, tour: str = "ATP") -> TournamentProfile:
        norm = raw_name.lower().strip()

        # 1. Exact or substring match in profile database
        for key, profile in KNOWN_TOURNAMENT_PROFILES.items():
            if key in norm or norm in key:
                # Override tour if explicitly provided and not Grand Slam
                effective_tour = profile.tour if profile.tour == "GRAND_SLAM" else tour
                return TournamentProfile(
                    name=profile.name,
                    tour=effective_tour,
                    category=profile.category,
                    surface=profile.surface,
                    court_pace_index=profile.court_pace_index,
                    altitude_m=profile.altitude_m,
                    city=profile.city,
                    country=profile.country
                )

        # 2. Heuristic Surface Classifier for unindexed Challenger / ITF / regional tourneys
        surface = "hard_outdoor"
        cpi = 35.0
        altitude = 50

        if any(term in norm for term in ["clay", "roche", "tierra", "terra", "red"]):
            surface = "clay"
            cpi = 25.0
        elif any(term in norm for term in ["grass", "lawn", "herbe", "cesped"]):
            surface = "grass"
            cpi = 43.0
        elif any(term in norm for term in ["indoor", "hallen", "couvert", "carpet"]):
            surface = "hard_indoor"
            cpi = 41.0

        # Heuristic Category
        category = "250"
        if "1000" in norm or "masters" in norm:
            category = "1000"
        elif "500" in norm:
            category = "500"
        elif "challenger" in norm or "open" in norm and ("ch" in norm or "itf" in norm):
            category = "CH"

        return TournamentProfile(
            name=raw_name.strip(),
            tour=tour,
            category=category,
            surface=surface,
            court_pace_index=cpi,
            altitude_m=altitude
        )
