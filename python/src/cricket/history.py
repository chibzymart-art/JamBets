"""
Cricsheet history: download and parse ball-by-ball match files.

Cricsheet (https://cricsheet.org) publishes every ball of 23k+ matches under
the Open Data Commons Attribution licence (ODC-BY): free, commercial use
allowed, credit required ("Data: Cricsheet.org").

Output is a compact list of match dicts, cached as gzipped JSON so GitHub
Actions can keep it between runs. Ball-by-ball data never goes to Supabase.
"""

from __future__ import annotations

import gzip
import io
import json
import logging
import os
import zipfile
from typing import Dict, Iterable, List, Optional

from python.src.cricket.config import (
    CRICSHEET_ARCHIVES, CRICSHEET_URL, MATCH_TYPE_TO_FORMAT,
    DOT, ONE, TWO, THREE, FOUR, SIX, WICKET, WIDE, NOBALL,
)

logger = logging.getLogger("cricket.history")


def download_archives(dest_dir: str, names: Iterable[str] = CRICSHEET_ARCHIVES) -> List[str]:
    import httpx
    os.makedirs(dest_dir, exist_ok=True)
    paths = []
    with httpx.Client(timeout=120, follow_redirects=True,
                      headers={"User-Agent": "oddsbanta-cricket/1.0"}) as client:
        for name in names:
            path = os.path.join(dest_dir, f"{name}_male_json.zip")
            r = client.get(CRICSHEET_URL.format(name=name))
            r.raise_for_status()
            with open(path, "wb") as fh:
                fh.write(r.content)
            paths.append(path)
            logger.info("downloaded %s (%d bytes)", name, len(r.content))
    return paths


def delivery_category(d: dict) -> int:
    extras = d.get("extras") or {}
    if "wides" in extras:
        return WIDE
    if "noballs" in extras:
        return NOBALL
    if d.get("wickets"):
        # retired hurt / retired not out are not dismissals by the bowler side
        kinds = [w.get("kind", "") for w in d["wickets"]]
        if any(k not in ("retired hurt", "retired not out") for k in kinds):
            return WICKET
    runs = int((d.get("runs") or {}).get("total", 0))
    if runs <= 0:
        return DOT
    if runs == 1:
        return ONE
    if runs == 2:
        return TWO
    if runs == 3:
        return THREE
    if runs == 6 or runs >= 6:
        return SIX
    return FOUR  # 4 and the rare 5


def parse_match(raw: dict, match_id: str, source: str) -> Optional[dict]:
    info = raw.get("info") or {}
    fmt = MATCH_TYPE_TO_FORMAT.get(info.get("match_type"))
    if not fmt or info.get("gender") != "male":
        return None
    teams = info.get("teams") or []
    if len(teams) != 2:
        return None
    registry = (info.get("registry") or {}).get("people") or {}

    def pid(name: str) -> str:
        return registry.get(name) or f"name:{name}"

    outcome = info.get("outcome") or {}
    winner = outcome.get("winner") or outcome.get("eliminator")
    result = "normal" if outcome.get("winner") else (outcome.get("result") or "unknown")
    if outcome.get("eliminator"):
        result = "tie"  # decided by super over; winner kept

    innings_out = []
    for inn in raw.get("innings") or []:
        if inn.get("super_over"):
            continue
        balls = []  # [over, batter, non_striker, bowler, category, total_runs]
        for ov in inn.get("overs") or []:
            o = int(ov.get("over", 0))
            for d in ov.get("deliveries") or []:
                balls.append([o, pid(d["batter"]), pid(d["non_striker"]), pid(d["bowler"]),
                              delivery_category(d), int((d.get("runs") or {}).get("total", 0))])
        target = inn.get("target") or {}
        innings_out.append({
            "team": inn.get("team"),
            "balls": balls,
            "target_runs": target.get("runs"),
            "target_overs": target.get("overs"),
        })
    if not innings_out:
        return None

    players = {t: [pid(n) for n in (info.get("players") or {}).get(t, [])] for t in teams}
    toss = info.get("toss") or {}
    event = info.get("event") or {}
    return {
        "id": match_id,
        "source": source,
        "date": (info.get("dates") or [""])[0],
        "format": fmt,
        "match_type": info.get("match_type"),
        "competition": event.get("name") or source,
        "teams": teams,
        "venue": info.get("venue"),
        "city": info.get("city"),
        "overs": info.get("overs"),
        "toss_winner": toss.get("winner"),
        "toss_decision": toss.get("decision"),
        "winner": winner,
        "result": result,
        "method": outcome.get("method"),
        "players": players,
        "innings": innings_out,
    }


def load_archives(paths: Iterable[str]) -> List[dict]:
    matches: Dict[str, dict] = {}
    for path in paths:
        source = os.path.basename(path).split("_male_json")[0]
        with zipfile.ZipFile(path) as zf:
            for name in zf.namelist():
                if not name.endswith(".json"):
                    continue
                mid = os.path.splitext(os.path.basename(name))[0]
                if mid in matches:
                    continue  # same match appears in several archives
                try:
                    raw = json.load(io.TextIOWrapper(zf.open(name), encoding="utf-8"))
                    m = parse_match(raw, mid, source)
                except Exception as exc:  # malformed file: skip, never guess
                    logger.warning("skip %s/%s: %s", source, name, exc)
                    continue
                if m:
                    matches[mid] = m
    out = sorted(matches.values(), key=lambda m: (m["date"], m["id"]))
    logger.info("parsed %d matches", len(out))
    return out


def save_cache(matches: List[dict], path: str) -> None:
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(matches, fh, separators=(",", ":"))


def load_cache(path: str) -> List[dict]:
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)
