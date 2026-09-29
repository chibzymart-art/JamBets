"""
JamBets — Tennis Tournament Name Normalizer
Deterministic string canonicalization for ATP, WTA, and Challenger tournaments.
Strips geographic/country suffixes, sponsor brands, and tier descriptors so that
rescheduled or variantly scraped fixtures resolve to an identical tournament key.
"""

import re
import unicodedata
from typing import Set

# Common geographic / country suffixes and annotations to strip
COUNTRY_PATTERNS = [
    r",\s*turkiye\b", r",\s*turkey\b", r",\s*usa\b", r",\s*united states\b",
    r",\s*france\b", r",\s*spain\b", r",\s*esp\b", r",\s*italy\b", r",\s*ita\b",
    r",\s*germany\b", r",\s*ger\b", r",\s*great britain\b", r",\s*gbr\b", r",\s*uk\b",
    r",\s*japan\b", r",\s*jpn\b", r",\s*china\b", r",\s*chn\b", r",\s*australia\b",
    r",\s*aus\b", r",\s*portugal\b", r",\s*por\b", r",\s*brazil\b", r",\s*bra\b",
    r",\s*argentina\b", r",\s*arg\b", r",\s*mexico\b", r",\s*mex\b", r",\s*austria\b",
    r",\s*aut\b", r",\s*switzerland\b", r",\s*sui\b", r",\s*belgium\b", r",\s*bel\b",
    r",\s*croatia\b", r",\s*cro\b", r",\s*czech republic\b", r",\s*cze\b", r",\s*poland\b",
    r",\s*pol\b", r",\s*canada\b", r",\s*can\b", r",\s*netherlands\b", r",\s*ned\b",
    r",\s*sweden\b", r",\s*swe\b", r",\s*chile\b", r",\s*colombia\b", r",\s*peru\b",
    r",\s*india\b", r",\s*korea\b", r",\s*kor\b", r",\s*serbia\b", r",\s*srb\b"
]

# Sponsor and corporate brand labels commonly prepended to tournament titles
SPONSOR_WORDS = [
    r"\baito\b", r"\brolex\b", r"\bbnp paribas\b", r"\bmutua\b", r"\bqatar airways\b",
    r"\bwestern & southern\b", r"\bgenerali\b", r"\bterebga\b", r"\bbmw\b", r"\bmercedes\b",
    r"\bemirates\b", r"\bbet-at-home\b", r"\bbank of the west\b", r"\bbnl d'italia\b"
]

# Tournament level, series, and generic suffixes
DESCRIPTOR_WORDS = [
    r"\batp\b", r"\bwta\b", r"\bitf\b", r"\bchallenger\s*\d*\b", r"\bmasters\s*\d*\b",
    r"\bseries\b", r"\btour\b", r"\bopen\b", r"\bclassic\b", r"\btrophy\b",
    r"\bchampionships?\b", r"\bcup\b", r"\binvitational\b", r"\binternational\b",
    r"\bqualifying\b", r"\bqualification\b", r"\bfinals?\b"
]


class TournamentNormalizer:
    """
    Normalizes tennis tournament names across ESPN, LiveScore, and Flashscore.
    Example:
        'Adana, Turkiye'        -> 'adana'
        'Adana Open'            -> 'adana'
        'AITO Hangzhou Open'    -> 'hangzhou'
        'ATP - Japan Open'      -> 'japan'
    """

    @classmethod
    def normalize(cls, raw_name: str) -> str:
        """
        Produces a clean, deterministic lowercase slug for tournament canonical keys.
        """
        if not raw_name:
            return "unknown_tournament"

        text = raw_name.lower().strip()

        # 1. Normalize unicode (e.g. accents: Roland-Garros)
        nfkd = unicodedata.normalize("NFKD", text)
        text = "".join([c for c in nfkd if not unicodedata.combining(c)])

        # 2. Strip geographic / country suffixes (e.g., ', Turkiye')
        for pat in COUNTRY_PATTERNS:
            text = re.sub(pat, "", text, flags=re.IGNORECASE)

        # 3. Strip sponsor brands
        for pat in SPONSOR_WORDS:
            text = re.sub(pat, "", text, flags=re.IGNORECASE)

        # 4. Strip descriptor words (atp, wta, open, challenger, etc.)
        for pat in DESCRIPTOR_WORDS:
            text = re.sub(pat, "", text, flags=re.IGNORECASE)

        # 5. Clean punctuation: replace dashes, commas, slashes with spaces
        text = re.sub(r"[^\w\s]", " ", text)

        # 6. Collapse whitespace and convert to underscore slug
        tokens = text.split()
        if not tokens:
            # Fallback to slug of raw name if all tokens were stripped
            clean_fallback = re.sub(r"[^\w\s]", " ", raw_name.lower()).split()
            return "_".join(clean_fallback) if clean_fallback else "tournament"

        slug = "_".join(tokens)
        return slug

    @classmethod
    def is_same_tournament(cls, name_a: str, name_b: str) -> bool:
        """
        Checks whether two tournament strings refer to the exact same tournament root.
        """
        if not name_a or not name_b:
            return False
        slug_a = cls.normalize(name_a)
        slug_b = cls.normalize(name_b)
        return slug_a == slug_b or slug_a in slug_b or slug_b in slug_a
