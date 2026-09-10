"""
JamBets — Canonical Event Identity Resolver
Resolves multi-source event representations into canonical entities using
sport, competition, canonical team mappings, UTC scheduled date, and provider event IDs.
"""

import re
import unicodedata
from datetime import datetime, timezone
from typing import Dict, Tuple, Optional, Any
from python.src.football.models import RawFixturePayload, CanonicalFixture, FixtureStatus

# Canonical alias mapping table for cross-provider standardization
TEAM_ALIASES: Dict[str, str] = {
    # English Premier League
    "arsenal": "arsenal",
    "arsenal fc": "arsenal",
    "chelsea": "chelsea",
    "chelsea fc": "chelsea",
    "liverpool": "liverpool",
    "liverpool fc": "liverpool",
    "manchester city": "manchester-city",
    "man city": "manchester-city",
    "mancity": "manchester-city",
    "manchester united": "manchester-united",
    "man united": "manchester-united",
    "man utd": "manchester-united",
    "tottenham hotspur": "tottenham-hotspur",
    "tottenham": "tottenham-hotspur",
    "spurs": "tottenham-hotspur",
    "aston villa": "aston-villa",
    "newcastle united": "newcastle-united",
    "newcastle": "newcastle-united",
    "brentford": "brentford",
    "afc bournemouth": "afc-bournemouth",
    "bournemouth": "afc-bournemouth",
    "crystal palace": "crystal-palace",
    "fulham": "fulham",
    "everton": "everton",
    "nottingham forest": "nottingham-forest",
    "nottm forest": "nottingham-forest",
    "west ham united": "west-ham-united",
    "west ham": "west-ham-united",
    "wolverhampton wanderers": "wolverhampton-wanderers",
    "wolves": "wolverhampton-wanderers",
    "brighton & hove albion": "brighton-and-hove-albion",
    "brighton": "brighton-and-hove-albion",
    "leicester city": "leicester-city",
    "leicester": "leicester-city",
    "ipswich town": "ipswich-town",
    "ipswich": "ipswich-town",
    "southampton": "southampton",
    "sunderland": "sunderland",
    "hull city": "hull-city",

    # La Liga
    "real madrid": "real-madrid",
    "barcelona": "barcelona",
    "fc barcelona": "barcelona",
    "atletico madrid": "atletico-madrid",
    "atletico de madrid": "atletico-madrid",
    "sevilla": "sevilla",
    "real betis": "real-betis",
    "athletic club bilbao": "athletic-bilbao",
    "athletic bilbao": "athletic-bilbao",
    "real sociedad": "real-sociedad",
    "villarreal": "villarreal",

    # Serie A
    "inter milan": "inter-milan",
    "internazionale": "inter-milan",
    "fc internazionale milano": "inter-milan",
    "ac milan": "ac-milan",
    "milan": "ac-milan",
    "juventus": "juventus",
    "napoli": "napoli",
    "roma": "as-roma",
    "as roma": "as-roma",
    "lazio": "lazio",
    "atalanta": "atalanta",

    # Bundesliga
    "bayern": "bayern-munich",
    "bayern munich": "bayern-munich",
    "bayern munchen": "bayern-munich",
    "borussia dortmund": "borussia-dortmund",
    "bayer leverkusen": "bayer-leverkusen",
    "rb leipzig": "rb-leipzig",
    "eintracht frankfurt": "eintracht-frankfurt",

    # Ligue 1
    "paris saint-germain": "paris-saint-germain",
    "psg": "paris-saint-germain",
    "marseille": "marseille",
    "monaco": "monaco",
    "as monaco": "monaco",
    "lyon": "lyon",
    "lille": "lille",
    "lens": "lens",
    "rc lens": "lens",

    # European Competitions & Smaller Leagues
    "bodo/glimt": "bodo-glimt",
    "bodo glimt": "bodo-glimt",
    "bodoglimt": "bodo-glimt",
    "bodoeglimt": "bodo-glimt",
    "fk bodo/glimt": "bodo-glimt",
    "fk bodoglimt": "bodo-glimt",
    "como": "como",
    "como 1907": "como",
    "calcio como": "como",
    "como-1907": "como",
    "shakhtar": "shakhtar-donetsk",
    "shakhtar donetsk": "shakhtar-donetsk",
    "psv": "psv-eindhoven",
    "psv eindhoven": "psv-eindhoven",
    "slavia prague": "slavia-prague",
    "slavia praha": "slavia-prague",
    "sk slavia praha": "slavia-prague",
    "sparta prague": "sparta-prague",
    "sparta praha": "sparta-prague",
    "panathinaikos": "panathinaikos",
    "kifisia": "kifisia",
    "ae kifisia": "kifisia",
    "sabah": "sabah",
    "sabah fk": "sabah",
    "fenerbahce": "fenerbahce",
    "galatasaray": "galatasaray",
    "besiktas": "besiktas",

    # Portugal Primeira Liga
    "estrela": "estrela-amadora",
    "estrela da amadora": "estrela-amadora",
    "estrela amadora": "estrela-amadora",
    "estrela-da-amadora": "estrela-amadora",
    "cf estrela": "estrela-amadora",
    "braga": "braga",
    "sc braga": "braga",
    "sporting braga": "braga",
    "sporting": "sporting-cp",
    "sporting cp": "sporting-cp",
    "sporting lisbon": "sporting-cp",
    "benfica": "benfica",
    "sl benfica": "benfica",
    "porto": "porto",
    "fc porto": "porto",

    # Liga MX & Americas
    "cd guadalajara": "guadalajara",
    "guadalajara": "guadalajara",
    "chivas": "guadalajara",
    "chivas guadalajara": "guadalajara",
    "pumas": "pumas-unam",
    "pumas unam": "pumas-unam",
    "unam": "pumas-unam",
    "club universidad nacional": "pumas-unam",
    "santos": "santos-laguna",
    "santos laguna": "santos-laguna",
    "club santos laguna": "santos-laguna",
    "juarez": "fc-juarez",
    "fc juarez": "fc-juarez",
    "racing club": "racing-club",
    "racing club avellaneda": "racing-club",
    "huracan": "huracan",

    # English Lower Tiers
    "luton": "luton-town",
    "luton town": "luton-town",
    "stevenage": "stevenage",
    "stevenage fc": "stevenage",
}


try:
    from rapidfuzz import fuzz, process
    HAS_RAPIDFUZZ = True
except ImportError:
    import difflib
    HAS_RAPIDFUZZ = False


def resolve_fuzzy_team_name(raw_name: str, min_confidence: float = 85.0) -> Tuple[str, float]:
    """
    Resolves raw team name to canonical identity using Rapidfuzz (or Levenshtein ratio >= 85%).
    Cross-checks across alias tables and canonical slugs.
    """
    if not raw_name:
        return "unknown", 0.0

    normalized = unicodedata.normalize("NFKD", raw_name)
    cleaned = "".join(c for c in normalized if not unicodedata.combining(c))
    cleaned = cleaned.lower().strip()
    cleaned = re.sub(r"[^\w\s-]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # 1. Exact match in aliases
    if cleaned in TEAM_ALIASES:
        return TEAM_ALIASES[cleaned], 100.0

    # 2. Strip club abbreviations and foundation years conservatively
    # Strip prefixes/suffixes like 'fc', 'cd', 'cf', 'afc', 'fk', 'sk', 'sc', 'ac', 'ad', 'sad'
    stripped = re.sub(r"\b(football club|fc|cf|cd|afc|sc|ac|kv|sv|fk|sk|ad|sad|csd)\b", "", cleaned).strip()
    # Strip foundation year suffixes (e.g. '1907', '1899', '1904', '1913') if preceding word exists
    stripped = re.sub(r"\b(18\d\d|19\d\d|20\d\d|04|09)\b", "", stripped).strip()
    stripped = re.sub(r"\s+", " ", stripped).strip()

    if stripped and stripped in TEAM_ALIASES:
        return TEAM_ALIASES[stripped], 98.0

    # 3. Rapidfuzz / Levenshtein matching against all known alias keys
    candidates = list(TEAM_ALIASES.keys())
    target_to_eval = stripped if stripped else cleaned

    best_match_key = None
    best_score = 0.0

    if HAS_RAPIDFUZZ:
        match_result = process.extractOne(
            target_to_eval,
            candidates,
            scorer=fuzz.token_sort_ratio
        )
        if match_result:
            best_match_key, best_score, _ = match_result
    else:
        # Fallback using difflib SequenceMatcher
        for cand in candidates:
            score = difflib.SequenceMatcher(None, target_to_eval, cand).ratio() * 100.0
            if score > best_score:
                best_score = score
                best_match_key = cand

    if best_match_key and best_score >= min_confidence:
        return TEAM_ALIASES[best_match_key], float(best_score)

    # 4. Fallback slug
    slug = re.sub(r"\s+", "-", stripped if stripped else cleaned)
    return slug, 0.0


def normalize_team_name(raw_name: str) -> str:
    """
    Cleans, strips accents, removes common punctuation, and maps
    raw provider team names to a canonical slug using fuzzy resolution (>= 85%).
    """
    resolved_canonical, confidence = resolve_fuzzy_team_name(raw_name, min_confidence=85.0)
    return resolved_canonical


def generate_canonical_key(league_code: str, home_team: str, away_team: str, kickoff: datetime) -> str:
    """
    Generates a deterministic canonical fixture key.
    Format: {league_code}:{home_canonical}:{away_canonical}:{YYYYMMDD}
    """
    date_str = kickoff.astimezone(timezone.utc).strftime("%Y%m%d")
    return f"{league_code}:{home_team}:{away_team}:{date_str}"


def build_canonical_fixture(raw: RawFixturePayload) -> CanonicalFixture:
    """
    Transforms a raw source payload into a structured CanonicalFixture.
    """
    home_norm = normalize_team_name(raw.home_team_raw)
    away_norm = normalize_team_name(raw.away_team_raw)
    key = generate_canonical_key(raw.league_code, home_norm, away_norm, raw.kickoff_time)

    return CanonicalFixture(
        sport="football",
        league_code=raw.league_code,
        season=raw.season,
        canonical_home_team=home_norm,
        canonical_away_team=away_norm,
        kickoff_utc=raw.kickoff_time.astimezone(timezone.utc),
        canonical_key=key,
        status=raw.status,
        home_score=raw.home_score,
        away_score=raw.away_score,
        venue=raw.venue,
        sources=[raw],
        agreement_count=1,
        has_conflict=False
    )


class CanonicalIdentityResolver:
    """Wrapper class providing identity resolution methods."""

    @staticmethod
    def normalize_team_name(name: str) -> str:
        return normalize_team_name(name)

    @staticmethod
    def generate_canonical_key(league_code: str, home_name: str, away_name: str, kickoff_at: datetime) -> str:
        home_norm = normalize_team_name(home_name)
        away_norm = normalize_team_name(away_name)
        return generate_canonical_key(league_code, home_norm, away_norm, kickoff_at)

    @staticmethod
    def build_canonical_fixture(raw: RawFixturePayload) -> CanonicalFixture:
        return build_canonical_fixture(raw)

    @staticmethod
    def find_matching_canonical_fixture(
        candidate: CanonicalFixture,
        pool: Dict[str, CanonicalFixture],
        time_tolerance_minutes: float = 120.0
    ) -> Optional[str]:
        return find_matching_canonical_fixture(candidate, pool, time_tolerance_minutes)


def find_matching_canonical_fixture(
    candidate: CanonicalFixture,
    pool: Dict[str, CanonicalFixture],
    time_tolerance_minutes: float = 120.0
) -> Optional[str]:
    """
    Finds a matching canonical fixture from pool for the candidate.
    Uses multi-attribute conservative matching:
    1. Exact canonical_key match.
    2. Exact teams + same league + kickoff within time_tolerance_minutes (default 120m / 2h).
    3. Fuzzy teams (>= 80% similarity on both home & away) + same league + kickoff within tolerance.
    Returns the matching pool key if found, otherwise None.
    """
    # 1. Exact key match
    if candidate.canonical_key in pool:
        return candidate.canonical_key

    candidate_kickoff = candidate.kickoff_utc

    for key, existing in pool.items():
        if existing.league_code != candidate.league_code:
            continue

        # Check kickoff time tolerance
        diff_mins = abs((candidate_kickoff - existing.kickoff_utc).total_seconds()) / 60.0
        if diff_mins > time_tolerance_minutes:
            continue

        # Check teams
        if (candidate.canonical_home_team == existing.canonical_home_team and
            candidate.canonical_away_team == existing.canonical_away_team):
            return key

        # Fuzzy team comparison if slight naming difference remains
        if HAS_RAPIDFUZZ:
            h_sim = fuzz.token_sort_ratio(candidate.canonical_home_team, existing.canonical_home_team)
            a_sim = fuzz.token_sort_ratio(candidate.canonical_away_team, existing.canonical_away_team)
        else:
            h_sim = difflib.SequenceMatcher(None, candidate.canonical_home_team, existing.canonical_home_team).ratio() * 100.0
            a_sim = difflib.SequenceMatcher(None, candidate.canonical_away_team, existing.canonical_away_team).ratio() * 100.0

        if h_sim >= 80.0 and a_sim >= 80.0:
            return key

    return None

