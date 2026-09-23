"""
Oddsbanta — Autonomous Basketball Entity & Identity Resolver
Phase 2: Canonical Team Normalization & Deterministic Key Generation

Invariant: Zero touchpoints with football/tennis normalizers.
"""

import re
import unicodedata
from datetime import datetime
from typing import Dict, Optional, Tuple


# Comprehensive team alias registry
BASKETBALL_TEAM_ALIASES: Dict[str, str] = {
    # NBA Eastern Conference - Atlantic
    "boston celtics": "Boston Celtics",
    "celtics": "Boston Celtics",
    "bos": "Boston Celtics",
    "brooklyn nets": "Brooklyn Nets",
    "nets": "Brooklyn Nets",
    "bkn": "Brooklyn Nets",
    "new york knicks": "New York Knicks",
    "knicks": "New York Knicks",
    "nyk": "New York Knicks",
    "philadelphia 76ers": "Philadelphia 76ers",
    "76ers": "Philadelphia 76ers",
    "sixers": "Philadelphia 76ers",
    "phi": "Philadelphia 76ers",
    "toronto raptors": "Toronto Raptors",
    "raptors": "Toronto Raptors",
    "tor": "Toronto Raptors",

    # NBA Eastern Conference - Central
    "chicago bulls": "Chicago Bulls",
    "bulls": "Chicago Bulls",
    "chi": "Chicago Bulls",
    "cleveland cavaliers": "Cleveland Cavaliers",
    "cavaliers": "Cleveland Cavaliers",
    "cavs": "Cleveland Cavaliers",
    "cle": "Cleveland Cavaliers",
    "detroit pistons": "Detroit Pistons",
    "pistons": "Detroit Pistons",
    "det": "Detroit Pistons",
    "indiana pacers": "Indiana Pacers",
    "pacers": "Indiana Pacers",
    "ind": "Indiana Pacers",
    "milwaukee bucks": "Milwaukee Bucks",
    "bucks": "Milwaukee Bucks",
    "mil": "Milwaukee Bucks",

    # NBA Eastern Conference - Southeast
    "atlanta hawks": "Atlanta Hawks",
    "hawks": "Atlanta Hawks",
    "atl": "Atlanta Hawks",
    "charlotte hornets": "Charlotte Hornets",
    "hornets": "Charlotte Hornets",
    "cha": "Charlotte Hornets",
    "miami heat": "Miami Heat",
    "heat": "Miami Heat",
    "mia": "Miami Heat",
    "orlando magic": "Orlando Magic",
    "magic": "Orlando Magic",
    "orl": "Orlando Magic",
    "washington wizards": "Washington Wizards",
    "wizards": "Washington Wizards",
    "was": "Washington Wizards",

    # NBA Western Conference - Northwest
    "denver nuggets": "Denver Nuggets",
    "nuggets": "Denver Nuggets",
    "den": "Denver Nuggets",
    "minnesota timberwolves": "Minnesota Timberwolves",
    "timberwolves": "Minnesota Timberwolves",
    "wolves": "Minnesota Timberwolves",
    "min": "Minnesota Timberwolves",
    "oklahoma city thunder": "Oklahoma City Thunder",
    "okc thunder": "Oklahoma City Thunder",
    "thunder": "Oklahoma City Thunder",
    "okc": "Oklahoma City Thunder",
    "portland trail blazers": "Portland Trail Blazers",
    "trail blazers": "Portland Trail Blazers",
    "blazers": "Portland Trail Blazers",
    "por": "Portland Trail Blazers",
    "utah jazz": "Utah Jazz",
    "jazz": "Utah Jazz",
    "uta": "Utah Jazz",

    # NBA Western Conference - Pacific
    "golden state warriors": "Golden State Warriors",
    "warriors": "Golden State Warriors",
    "gsw": "Golden State Warriors",
    "la clippers": "LA Clippers",
    "los angeles clippers": "LA Clippers",
    "clippers": "LA Clippers",
    "lac": "LA Clippers",
    "los angeles lakers": "Los Angeles Lakers",
    "la lakers": "Los Angeles Lakers",
    "lakers": "Los Angeles Lakers",
    "lal": "Los Angeles Lakers",
    "phoenix suns": "Phoenix Suns",
    "suns": "Phoenix Suns",
    "phx": "Phoenix Suns",
    "sacramento kings": "Sacramento Kings",
    "kings": "Sacramento Kings",
    "sac": "Sacramento Kings",

    # NBA Western Conference - Southwest
    "dallas mavericks": "Dallas Mavericks",
    "mavericks": "Dallas Mavericks",
    "mavs": "Dallas Mavericks",
    "dal": "Dallas Mavericks",
    "houston rockets": "Houston Rockets",
    "rockets": "Houston Rockets",
    "hou": "Houston Rockets",
    "memphis grizzlies": "Memphis Grizzlies",
    "grizzlies": "Memphis Grizzlies",
    "mem": "Memphis Grizzlies",
    "new orleans pelicans": "New Orleans Pelicans",
    "pelicans": "New Orleans Pelicans",
    "nop": "New Orleans Pelicans",
    "san antonio spurs": "San Antonio Spurs",
    "spurs": "San Antonio Spurs",
    "sas": "San Antonio Spurs",

    # WNBA
    "atlanta dream": "Atlanta Dream",
    "dream": "Atlanta Dream",
    "chicago sky": "Chicago Sky",
    "sky": "Chicago Sky",
    "connecticut sun": "Connecticut Sun",
    "sun": "Connecticut Sun",
    "dallas wings": "Dallas Wings",
    "wings": "Dallas Wings",
    "indiana fever": "Indiana Fever",
    "fever": "Indiana Fever",
    "las vegas aces": "Las Vegas Aces",
    "aces": "Las Vegas Aces",
    "los angeles sparks": "Los Angeles Sparks",
    "sparks": "Los Angeles Sparks",
    "minnesota lynx": "Minnesota Lynx",
    "lynx": "Minnesota Lynx",
    "new york liberty": "New York Liberty",
    "liberty": "New York Liberty",
    "phoenix mercury": "Phoenix Mercury",
    "mercury": "Phoenix Mercury",
    "seattle storm": "Seattle Storm",
    "storm": "Seattle Storm",
    "washington mystics": "Washington Mystics",
    "mystics": "Washington Mystics",

    # EuroLeague
    "real madrid": "Real Madrid Baloncesto",
    "real madrid baloncesto": "Real Madrid Baloncesto",
    "fc barcelona": "FC Barcelona Basquet",
    "barcelona": "FC Barcelona Basquet",
    "olympiacos": "Olympiacos Piraeus",
    "olympiacos piraeus": "Olympiacos Piraeus",
    "panathinaikos": "Panathinaikos AKTOR",
    "panathinaikos aktor": "Panathinaikos AKTOR",
    "fenerbahce": "Fenerbahce Beko",
    "fenerbahce beko": "Fenerbahce Beko",
    "anadolu efes": "Anadolu Efes",
    "as monaco": "AS Monaco Basket",
    "monaco": "AS Monaco Basket",
    "maccabi tel aviv": "Maccabi Playtika Tel Aviv",
    "partizan": "Partizan Mozzart Bet",
    "crvena zvezda": "Crvena Zvezda Meridianbet",
    "virtus bologna": "Virtus Segafredo Bologna",
    "ea7 emporio armani milan": "Olimpia Milano",
    "olimpia milano": "Olimpia Milano",
    "zalgiris": "Zalgiris Kaunas",
    "zalgiris kaunas": "Zalgiris Kaunas",
    "baskonia": "Baskonia Vitoria-Gasteiz",
    "bayern munich": "FC Bayern Munich Basketball",
    "alba berlin": "ALBA Berlin",
    "asvel": "LDLC ASVEL Villeurbanne",
    "paris basketball": "Paris Basketball",
}

# 3-Letter acronym lookup for key teams
TEAM_SLUGS: Dict[str, str] = {
    "Boston Celtics": "BOS",
    "Brooklyn Nets": "BKN",
    "New York Knicks": "NYK",
    "Philadelphia 76ers": "PHI",
    "Toronto Raptors": "TOR",
    "Chicago Bulls": "CHI",
    "Cleveland Cavaliers": "CLE",
    "Detroit Pistons": "DET",
    "Indiana Pacers": "IND",
    "Milwaukee Bucks": "MIL",
    "Atlanta Hawks": "ATL",
    "Charlotte Hornets": "CHA",
    "Miami Heat": "MIA",
    "Orlando Magic": "ORL",
    "Washington Wizards": "WAS",
    "Denver Nuggets": "DEN",
    "Minnesota Timberwolves": "MIN",
    "Oklahoma City Thunder": "OKC",
    "Portland Trail Blazers": "POR",
    "Utah Jazz": "UTA",
    "Golden State Warriors": "GSW",
    "LA Clippers": "LAC",
    "Los Angeles Lakers": "LAL",
    "Phoenix Suns": "PHX",
    "Sacramento Kings": "SAC",
    "Dallas Mavericks": "DAL",
    "Houston Rockets": "HOU",
    "Memphis Grizzlies": "MEM",
    "New Orleans Pelicans": "NOP",
    "San Antonio Spurs": "SAS",
    "Atlanta Dream": "ATL",
    "Chicago Sky": "CHI",
    "Connecticut Sun": "CON",
    "Dallas Wings": "DAL",
    "Indiana Fever": "IND",
    "Las Vegas Aces": "LVA",
    "Los Angeles Sparks": "LAS",
    "Minnesota Lynx": "MIN",
    "New York Liberty": "NYL",
    "Phoenix Mercury": "PHX",
    "Seattle Storm": "SEA",
    "Washington Mystics": "WAS",
    "Real Madrid Baloncesto": "RMB",
    "FC Barcelona Basquet": "FCB",
    "Olympiacos Piraeus": "OLY",
    "Panathinaikos AKTOR": "PAO",
    "Fenerbahce Beko": "FEN",
    "Anadolu Efes": "EFS",
    "AS Monaco Basket": "MON",
    "Maccabi Playtika Tel Aviv": "MAC",
    "Partizan Mozzart Bet": "PAR",
    "Crvena Zvezda Meridianbet": "CZV",
    "Virtus Segafredo Bologna": "VIR",
    "Olimpia Milano": "MIL",
    "Zalgiris Kaunas": "ZAL",
    "Baskonia Vitoria-Gasteiz": "BKN",
    "FC Bayern Munich Basketball": "BAY",
    "ALBA Berlin": "ALB",
    "LDLC ASVEL Villeurbanne": "ASV",
    "Paris Basketball": "PAR",
}


def clean_string(raw: str) -> str:
    """Normalize string, remove accents, extra spaces, and common noise."""
    if not raw:
        return ""
    # Unicode normalize
    norm = unicodedata.normalize("NFKD", raw)
    cleaned = "".join(c for c in norm if not unicodedata.combining(c))
    cleaned = cleaned.lower()
    cleaned = re.sub(r"[^\w\s]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def normalize_team_name(raw_name: str) -> str:
    """Resolves raw team name string into its canonical display name."""
    if not raw_name:
        return "Unknown Team"
    
    cleaned = clean_string(raw_name)
    if cleaned in BASKETBALL_TEAM_ALIASES:
        return BASKETBALL_TEAM_ALIASES[cleaned]
    
    # Try partial matching for compound names
    for alias, canonical in BASKETBALL_TEAM_ALIASES.items():
        if len(alias) >= 4 and alias in cleaned:
            return canonical

    # Fallback to Title Case of cleaned name
    words = [w.capitalize() for w in cleaned.split()]
    return " ".join(words) if words else raw_name.strip()


def get_team_slug(canonical_name: str) -> str:
    """Returns a short 3-4 letter uppercase identifier."""
    if canonical_name in TEAM_SLUGS:
        return TEAM_SLUGS[canonical_name]
    
    # Fallback: take initials or first 3 letters
    words = canonical_name.split()
    if len(words) >= 2:
        return (words[0][:2] + words[1][:1]).upper()
    return canonical_name[:3].upper()


def generate_canonical_key(league_code: str, home_team: str, away_team: str, target_kickoff_at: datetime) -> str:
    """
    Constructs a deterministic canonical key for a basketball fixture:
    Format: {LEAGUE}:{HOME_SLUG}-{AWAY_SLUG}:{YYYYMMDD}
    Example: NBA:BOS-NYK:20261022
    """
    home_canonical = normalize_team_name(home_team)
    away_canonical = normalize_team_name(away_team)
    home_slug = get_team_slug(home_canonical)
    away_slug = get_team_slug(away_canonical)
    date_str = target_kickoff_at.strftime("%Y%m%d")
    return f"{league_code.upper()}:{home_slug}-{away_slug}:{date_str}"
