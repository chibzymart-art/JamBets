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
    ),

    # Team Cups & International Competitions
    "laver cup": TournamentProfile(
        name="Laver Cup", tour="TEAM", category="CUP", surface="hard_indoor",
        court_pace_index=41.0, altitude_m=200, city="Berlin", country="Germany"
    ),
    "davis cup": TournamentProfile(
        name="Davis Cup", tour="TEAM", category="CUP", surface="hard_indoor",
        court_pace_index=40.0, altitude_m=100
    ),
    "billie jean king": TournamentProfile(
        name="Billie Jean King Cup", tour="TEAM", category="CUP", surface="hard_indoor",
        court_pace_index=39.0, altitude_m=100
    ),

    # ATP Challenger Tour & WTA 125s
    "buenos aires": TournamentProfile(
        name="Buenos Aires Challenger", tour="ATP", category="CH", surface="clay",
        court_pace_index=23.5, altitude_m=25, city="Buenos Aires", country="Argentina"
    ),
    "san diego": TournamentProfile(
        name="San Diego Open", tour="ATP", category="CH", surface="hard_outdoor",
        court_pace_index=36.5, altitude_m=20, city="San Diego", country="USA"
    ),
    "st. tropez": TournamentProfile(
        name="Saint-Tropez Open", tour="ATP", category="CH", surface="hard_outdoor",
        court_pace_index=37.0, altitude_m=15, city="Saint-Tropez", country="France"
    ),
    "saint-tropez": TournamentProfile(
        name="Saint-Tropez Open", tour="ATP", category="CH", surface="hard_outdoor",
        court_pace_index=37.0, altitude_m=15, city="Saint-Tropez", country="France"
    ),
    "genoa": TournamentProfile(
        name="Genoa Open Challenger", tour="ATP", category="CH", surface="clay",
        court_pace_index=24.0, altitude_m=19, city="Genoa", country="Italy"
    ),
    "plovdiv": TournamentProfile(
        name="Plovdiv Open", tour="ATP", category="CH", surface="clay",
        court_pace_index=25.0, altitude_m=160, city="Plovdiv", country="Bulgaria"
    ),
    "sibiu": TournamentProfile(
        name="Sibiu Open", tour="ATP", category="CH", surface="clay",
        court_pace_index=24.5, altitude_m=430, city="Sibiu", country="Romania"
    ),
    "bad waltersdorf": TournamentProfile(
        name="Bad Waltersdorf Trophy", tour="ATP", category="CH", surface="clay",
        court_pace_index=25.0, altitude_m=290, city="Bad Waltersdorf", country="Austria"
    ),
    "tiburon": TournamentProfile(
        name="Tiburon Challenger", tour="ATP", category="CH", surface="hard_outdoor",
        court_pace_index=37.5, altitude_m=5, city="Tiburon", country="USA"
    ),
    "alicante": TournamentProfile(
        name="Alicante Ferrero Challenger", tour="ATP", category="CH", surface="hard_outdoor",
        court_pace_index=38.0, altitude_m=80, city="Alicante", country="Spain"
    ),
    "almaty": TournamentProfile(
        name="Almaty Open", tour="ATP", category="250", surface="hard_indoor",
        court_pace_index=41.5, altitude_m=780, city="Almaty", country="Kazakhstan"
    ),
    "stockholm": TournamentProfile(
        name="BNP Paribas Nordic Open", tour="ATP", category="250", surface="hard_indoor",
        court_pace_index=42.0, altitude_m=28, city="Stockholm", country="Sweden"
    ),
    "antwerp": TournamentProfile(
        name="European Open", tour="ATP", category="250", surface="hard_indoor",
        court_pace_index=41.5, altitude_m=10, city="Antwerp", country="Belgium"
    ),
    "basel": TournamentProfile(
        name="Swiss Indoors Basel", tour="ATP", category="500", surface="hard_indoor",
        court_pace_index=43.0, altitude_m=260, city="Basel", country="Switzerland"
    ),
    "vienna": TournamentProfile(
        name="Erste Bank Open", tour="ATP", category="500", surface="hard_indoor",
        court_pace_index=42.5, altitude_m=170, city="Vienna", country="Austria"
    ),
    "wuhan": TournamentProfile(
        name="Wuhan Open", tour="WTA", category="1000", surface="hard_outdoor",
        court_pace_index=38.5, altitude_m=30, city="Wuhan", country="China"
    ),
    "ningbo": TournamentProfile(
        name="Ningbo Open", tour="WTA", category="500", surface="hard_outdoor",
        court_pace_index=37.5, altitude_m=20, city="Ningbo", country="China"
    ),
    "guangzhou": TournamentProfile(
        name="Guangzhou Open", tour="WTA", category="250", surface="hard_outdoor",
        court_pace_index=38.0, altitude_m=21, city="Guangzhou", country="China"
    ),
    "jiujiang": TournamentProfile(
        name="Jiangxi Open", tour="WTA", category="250", surface="hard_outdoor",
        court_pace_index=37.5, altitude_m=32, city="Jiujiang", country="China"
    ),
    "hong kong": TournamentProfile(
        name="Hong Kong Tennis Open", tour="WTA", category="250", surface="hard_outdoor",
        court_pace_index=38.5, altitude_m=10, city="Hong Kong", country="Hong Kong"
    )
}


class CpiRegistry:
    """
    Intelligent surface, court pace, and environmental condition resolver.
    """

    @classmethod
    def resolve_tournament(cls, raw_name: str, tour: str = "ATP", category: Optional[str] = None) -> TournamentProfile:
        norm = raw_name.lower().strip()

        # 1. Exact or substring match in profile database
        for key, profile in KNOWN_TOURNAMENT_PROFILES.items():
            if key in norm or norm in key:
                # Override tour if explicitly provided and not Grand Slam
                effective_tour = profile.tour if profile.tour in ("GRAND_SLAM", "TEAM") else tour
                effective_category = category or profile.category
                return TournamentProfile(
                    name=profile.name,
                    tour=effective_tour,
                    category=effective_category,
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
        resolved_category = category or "250"
        if not category:
            if "1000" in norm or "masters" in norm:
                resolved_category = "1000"
            elif "500" in norm:
                resolved_category = "500"
            elif "challenger" in norm or ("ch" in norm or "itf" in norm):
                resolved_category = "CH"

        return TournamentProfile(
            name=raw_name.strip(),
            tour=tour,
            category=resolved_category,
            surface=surface,
            court_pace_index=cpi,
            altitude_m=altitude
        )

