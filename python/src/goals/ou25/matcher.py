"""
Over/Under 2.5 engine: team name matching between our fixture slugs
(e.g. "queens-park-rangers") and football-data.co.uk names (e.g. "QPR").
A team that cannot be matched with confidence gets no pick (never a guess).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Dict, Iterable, Optional

from rapidfuzz import fuzz, process

# football-data spelling -> words as our slugs spell them (only where fuzzy matching fails)
ALIASES: Dict[str, str] = {
    "man city": "manchester city", "man united": "manchester united",
    "nott m forest": "nottingham forest", "qpr": "queens park rangers",
    "west brom": "west bromwich albion", "wolves": "wolverhampton wanderers",
    "sheffield weds": "sheffield wednesday", "mk dons": "milton keynes dons",
    "afc wimbledon": "wimbledon", "bournemouth": "afc bournemouth",
    "brighton": "brighton and hove albion", "tottenham": "tottenham hotspur",
    "ath madrid": "atletico madrid", "ath bilbao": "athletic club", "sociedad": "real sociedad",
    "betis": "real betis", "vallecano": "rayo vallecano", "celta": "celta vigo",
    "espanol": "espanyol", "la coruna": "deportivo", "sp gijon": "sporting gijon",
    "oviedo": "real oviedo", "valladolid": "real valladolid", "santander": "racing santander",
    "dortmund": "borussia dortmund", "m gladbach": "borussia monchengladbach",
    "ein frankfurt": "eintracht frankfurt", "fc koln": "cologne", "koln": "cologne",
    "leverkusen": "bayer leverkusen", "stuttgart": "vfb stuttgart", "hoffenheim": "tsg hoffenheim",
    "union berlin": "1 union berlin", "heidenheim": "1 heidenheim", "magdeburg": "1 magdeburg",
    "nurnberg": "1 nurnberg", "greuther furth": "spvgg greuther furth", "bielefeld": "arminia bielefeld",
    "braunschweig": "eintracht braunschweig", "hertha": "hertha berlin", "darmstadt": "darmstadt 98",
    "hannover": "hannover 96", "paderborn": "paderborn 07", "cottbus": "energie cottbus",
    "dresden": "dynamo dresden", "mainz": "mainz", "bayern munich": "bayern munich",
    "paris sg": "paris saint germain", "st etienne": "saint etienne", "reims": "stade de reims",
    "laval": "stade laval", "nancy": "as nancy lorraine", "rodez": "rodez aveyron", "clermont": "clermont foot",
    "dijon": "dijon fco", "red star": "red star 93",
    "inter": "inter milan", "milan": "ac milan", "roma": "as roma", "verona": "hellas verona",
    "avellino": "us avellino", "entella": "virtus entella",
    "ajax": "ajax amsterdam", "feyenoord": "feyenoord rotterdam", "psv eindhoven": "psv eindhoven",
    "for sittard": "fortuna sittard", "nijmegen": "nec nijmegen", "zwolle": "pec zwolle",
    "den haag": "ado den haag", "sp lisbon": "sporting cp", "guimaraes": "vitoria de guimaraes",
    "sp braga": "braga", "estrela": "estrela amadora", "aves": "avs",
    "st truiden": "sint truidense", "st gilloise": "union st gilloise", "waregem": "zulte waregem",
    "oud heverlee leuven": "oud heverlee leuven", "charleroi": "sporting charleroi", "gent": "kaa gent",
    "buyuksehyr": "istanbul basaksehir", "rizespor": "caykur rizespor", "goztep": "goztepe",
    "erzurum": "erzurum bb", "amed": "amed sfk",
    "hearts": "heart of midlothian", "inverness c": "inverness caledonian thistle", "morton": "greenock morton",
    "aek": "aek athens", "ofi crete": "ofi crete", "volos": "volos nfc", "asteras tripolis": "asteras tripoli",
    "salzburg": "rb salzburg", "austria vienna": "austria wien", "rapid vienna": "rapid wien",
    "wsg tirol": "wsg tirol", "altach": "rheindorf altach", "hartberg": "tsv hartberg", "ried": "josko ried",
    "st gallen": "st gallen", "grasshoppers": "grasshopper",
    "bodo glimt": "bodo glimt", "valerenga": "valerenga", "hamkam": "hamkam",
    "hacken": "bk hacken", "djurgarden": "djurgarden", "norrkoping": "norrkoping",
    "fc copenhagen": "copenhagen", "brondby": "broendby if", "sonderjyske": "soenderjyske",
    "nordsjaelland": "nordsjaelland", "aarhus": "agf", "odense": "ob",
    "new york city": "new york city", "ny red bulls": "new york red bulls", "los angeles fc": "lafc",
    "la galaxy": "la galaxy", "st louis city": "st louis city", "sporting kansas city": "sporting kansas city",
    "dc united": "dc united", "inter miami": "inter miami",
    "athletico pr": "athletico paranaense", "atletico mg": "atletico mg", "bragantino": "red bull bragantino",
    "vasco": "vasco da gama", "sao paulo": "sao paulo",
    "estudiantes l p": "estudiantes de la plata", "gimnasia l p": "gimnasia la plata",
    "newells old boys": "newells old boys", "central cordoba": "central cordoba de santiago",
    "atl tucuman": "atletico tucuman", "huracan": "huracan", "velez sarsfield": "velez sarsfield",
    "club america": "america", "u n a m": "pumas unam", "pumas unam": "pumas unam",
    "atl san luis": "atletico de san luis", "juarez": "fc juarez", "guadalajara chivas": "guadalajara",
    # our slug spellings that differ from football-data
    "peterboro": "peterborough united", "urawa reds": "urawa red diamonds", "urawa": "urawa red diamonds",
    "verdy": "tokyo verdy", "stade rennais": "rennes", "oh leuven": "oud heverlee leuven",
    "royal charleroi": "sporting charleroi", "sttruiden": "sint truidense", "st truidense": "sint truidense",
    "union stgilloise": "union st gilloise", "kobenhavn": "copenhagen", "fc kobenhavn": "copenhagen",
    "odense boldklub": "ob", "sonderjyske fodbold": "soenderjyske", "hamarkameratene": "hamkam",
    "inverness ct": "inverness caledonian thistle", "scr altach": "rheindorf altach",
    "la galaxy": "los angeles galaxy", "los angeles galaxy": "los angeles galaxy",
    "amedspor": "amed sfk", "erzurumspor": "erzurum bb", "rc celta fortuna": "celta b",
    "gimnasia lp": "gimnasia la plata", "ind rivadavia": "independiente rivadavia",
    "dep riestra": "deportivo riestra", "yokohama fmarinos": "yokohama f marinos",
    "raith rvs": "raith rovers", "bristol rvs": "bristol rovers", "argentinos jrs": "argentinos juniors",
    "atl tucuman": "atletico tucuman",
}

# Generic names that could be either of two clubs: never match them.
AMBIGUOUS = {"los angeles", "new york", "manchester", "milan", "madrid", "sheffield", "bristol"}

_STOP = {"fc", "cf", "afc", "sc", "cd", "ud", "sd", "club", "the", "de", "of", "calcio", "if", "fk", "sk", "bk"}


def norm(name: str) -> str:
    s = (name or "").lower().replace("ø", "o").replace("æ", "ae").replace("å", "aa")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    s = ALIASES.get(s, s)
    # Nordic transliterations ("koebenhavn", "djurgaarden") -> plain vowels on both sides
    s = s.replace("oe", "o").replace("ae", "a").replace("aa", "a")
    s = ALIASES.get(s, s)
    toks = [t for t in s.split() if t not in _STOP] or s.split()
    return " ".join(toks)


def best_match(name: str, candidates: Iterable[str], min_score: int = 86) -> Optional[str]:
    """Best candidate for `name`, or None if no candidate is clearly the same club."""
    cands = list(dict.fromkeys(candidates))
    if not cands:
        return None
    target = norm(name)
    if target in AMBIGUOUS:
        return None
    normed = {c: norm(c) for c in cands}
    for c, n in normed.items():  # exact after normalisation
        if n == target:
            return c
    scored = process.extract(target, normed, scorer=fuzz.token_set_ratio, limit=2)
    if not scored:
        return None
    top = scored[0]
    if top[1] < min_score:
        return None
    if len(scored) > 1 and scored[1][1] >= top[1] - 2 and scored[1][1] >= min_score:
        # ambiguous (e.g. "real sociedad" vs "real sociedad b"): prefer the closer plain ratio
        a, b = scored[0][2], scored[1][2]
        ra, rb = fuzz.ratio(target, normed[a]), fuzz.ratio(target, normed[b])
        if abs(ra - rb) < 5:
            return None
        return a if ra > rb else b
    return top[2]
