"""
JamBets — Universal Competition & Fixture Eligibility Filter
Centralized validation ensuring strict quality control across all prediction engines:
1. Exclusion of Women's Football (all tiers and competitions).
2. English Pyramid Floor at England National League (Tier 5):
   - Tier 1: Premier League (ENG_PL)
   - Tier 2: Championship (ENG_CH)
   - Tier 3: League One (ENG_L1)
   - Tier 4: League Two (ENG_L2)
   - Tier 5: National League (ENG_NL)
   - Major Cups: EFL Cup (ENG_EFL_CUP), FA Cup (ENG_FA_CUP)
   - Permanently Excluded: Tier 6 (ENG_NL_N, ENG_NL_S), Tier 7 (ENG_NPL, ENG_ILP, ENG_SLP),
     and Youth/Reserves (ENG_PL2, ENG_PL_U18, U21, etc.)
"""

import re
from typing import Optional, Tuple, Set

# English leagues strictly permitted (Floor = England National League Tier 5)
PERMITTED_ENGLISH_LEAGUES: Set[str] = {
    "ENG_PL",
    "ENG_CH",
    "ENG_L1",
    "ENG_L2",
    "ENG_NL",
    "ENG_EFL_CUP",
    "ENG_FA_CUP",
}

# Explicitly excluded league codes across all countries
EXCLUDED_LEAGUE_CODES: Set[str] = {
    # English non-league below Tier 5 & youth
    "ENG_NL_N",
    "ENG_NL_S",
    "ENG_NPL",
    "ENG_ILP",
    "ENG_SLP",
    "ENG_PL2",
    "ENG_PL_U18",
    "ENG_U21",
    "ENG_U18",
    # Women's football
    "ENG_WSL",
    "ESP_LF",
    "FRA_D1F",
    "GER_FB",
    "ITA_SAW",
    "USA_NWSL",
    # Secondary youth/amateur
    "USA_MLSN",  # MLS Next Pro
}

WOMEN_KEYWORDS = [
    r"\bwomen\b",
    r"\bwsl\b",
    r"\bladies\b",
    r"\bfemenin[ao]?s?\b",
    r"\bfrauen\b",
    r"\bdamen\b",
    r"\bfemmes?\b",
    r"\b\(w\)\b",
    r"\b\(women\)\b",
    r"\bwfc\b",
    r"-women\b",
    r"_w\b",
]

YOUTH_KEYWORDS = [
    r"\bu18\b",
    r"\bu19\b",
    r"\bu21\b",
    r"\bu23\b",
    r"\bpremier league 2\b",
    r"\breserves\b",
    r"\byouth\b",
]

_WOMEN_PATTERN = re.compile("|".join(WOMEN_KEYWORDS), re.IGNORECASE)
_YOUTH_PATTERN = re.compile("|".join(YOUTH_KEYWORDS), re.IGNORECASE)


def is_fixture_eligible(
    league_code: Optional[str] = None,
    league_name: Optional[str] = None,
    home_team: Optional[str] = None,
    away_team: Optional[str] = None,
    is_women: Optional[bool] = None,
) -> bool:
    """
    Returns True if fixture meets professional quality standards:
    - Not women's football
    - Not youth/reserve football
    - Not below Tier 5 in England (National League floor)
    """
    eligible, _ = get_fixture_eligibility(
        league_code=league_code,
        league_name=league_name,
        home_team=home_team,
        away_team=away_team,
        is_women=is_women,
    )
    return eligible


def get_fixture_eligibility(
    league_code: Optional[str] = None,
    league_name: Optional[str] = None,
    home_team: Optional[str] = None,
    away_team: Optional[str] = None,
    is_women: Optional[bool] = None,
) -> Tuple[bool, str]:
    """
    Evaluates fixture and returns (is_eligible, reason).
    """
    if is_women is True:
        return False, "Explicitly marked as women's football"

    code = (league_code or "").strip().upper()
    lname = (league_name or "").strip()
    hteam = (home_team or "").strip()
    ateam = (away_team or "").strip()

    # 1. Check explicitly excluded league codes
    if code in EXCLUDED_LEAGUE_CODES:
        return False, f"Excluded league code: {code}"

    # 2. English Pyramid Floor (Tier 5 England National League cutoff)
    if code.startswith("ENG_"):
        if code not in PERMITTED_ENGLISH_LEAGUES:
            return False, f"English league below National League Tier 5 floor: {code}"

    # 3. Check for Women's keywords across all identifiers
    full_text = f"{code} {lname} {hteam} {ateam}".lower()
    if _WOMEN_PATTERN.search(full_text):
        return False, f"Identified as women's football via keyword in: {full_text}"

    # 4. Check for Youth/Reserve keywords across all identifiers
    if _YOUTH_PATTERN.search(full_text):
        return False, f"Identified as youth/reserve fixture: {full_text}"

    # 5. English amateur leagues by name heuristics
    lname_lower = lname.lower()
    if any(k in lname_lower for k in [
        "northern premier", "isthmian", "southern league",
        "national league north", "national league south"
    ]):
        return False, f"Amateur division below National League floor: {lname}"

    return True, "Eligible"
