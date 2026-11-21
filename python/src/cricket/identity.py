"""
Player identity: map scraped players to one Cricsheet register ID.

Order of trust (the first that gives exactly one ID wins):
  1. Exact provider key from the Cricsheet register
     (LiveScore player IDs match the register's key_bigbash column;
      Cricbuzz IDs match key_cricbuzz).
  2. Exact full name in the register's alternate-name list (names.csv).
  3. Surname + first initial among players who appeared for that team in
     the last two years of Cricsheet history.

No fuzzy-only matching and no defaults: a player who still has no single
ID is returned as unmatched, and the screening step blocks Elite for that
match. (The tennis engine's duplicate-player bug came from fuzzy names.)
"""

from __future__ import annotations

import csv
import os
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Set

REGISTER_PEOPLE = "https://cricsheet.org/register/people.csv"
REGISTER_NAMES = "https://cricsheet.org/register/names.csv"


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(s.lower().replace(".", " ").replace("'", "").split())


@dataclass
class Match:
    player_id: Optional[str]
    method: str  # provider_key | full_name | team_initial | unmatched


class Register:
    def __init__(self, people_csv: str, names_csv: str):
        self.by_key: Dict[str, Dict[str, str]] = defaultdict(dict)
        self.by_name: Dict[str, Set[str]] = defaultdict(set)
        self.display: Dict[str, str] = {}
        with open(people_csv, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                pid = r["identifier"]
                self.display[pid] = r["name"]
                self.by_name[norm(r["name"])].add(pid)
                self.by_name[norm(r["unique_name"])].add(pid)
                for col in ("key_bigbash", "key_cricbuzz", "key_cricinfo"):
                    if r.get(col):
                        self.by_key[col][r[col]] = pid
        with open(names_csv, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                self.by_name[norm(r["name"])].add(r["identifier"])

    @classmethod
    def download(cls, dest_dir: str) -> "Register":
        import httpx
        os.makedirs(dest_dir, exist_ok=True)
        paths = []
        for url in (REGISTER_PEOPLE, REGISTER_NAMES):
            path = os.path.join(dest_dir, os.path.basename(url))
            r = httpx.get(url, timeout=60, follow_redirects=True)
            r.raise_for_status()
            with open(path, "wb") as fh:
                fh.write(r.content)
            paths.append(path)
        return cls(*paths)

    def resolve(self, *, provider_col: Optional[str], provider_id: Optional[str],
                full_names: Iterable[str], team_pool: Optional[Iterable[str]] = None) -> Match:
        if provider_col and provider_id:
            pid = self.by_key.get(provider_col, {}).get(str(provider_id))
            if pid:
                return Match(pid, "provider_key")
        names = [norm(n) for n in full_names if n]
        for n in names:
            ids = self.by_name.get(n, set())
            if len(ids) == 1:
                return Match(next(iter(ids)), "full_name")
        if team_pool:
            pool = set(team_pool)
            for n in names:
                parts = n.split()
                if len(parts) < 2:
                    continue
                first, last = parts[0], parts[-1]
                cands = [p for p in pool
                         if norm(self.display.get(p, "")).split()[-1:] == [last]
                         and norm(self.display.get(p, ""))[:1] == first[:1]]
                if len(cands) == 1:
                    return Match(cands[0], "team_initial")
                # register names are like "MR Marsh": initials first
                cands = [p for p in pool
                         if norm(self.display.get(p, "")).split()[-1:] == [last]
                         and first[:1] in norm(self.display.get(p, "")).split()[0]]
                if len(cands) == 1:
                    return Match(cands[0], "team_initial")
        return Match(None, "unmatched")


def recent_team_pools(matches: List[dict], since: str) -> Dict[str, Set[str]]:
    """team name -> player IDs who played for it since `since` (Cricsheet history)."""
    pools: Dict[str, Set[str]] = defaultdict(set)
    for m in matches:
        if m["date"] >= since:
            for team, xi in m["players"].items():
                pools[norm(team)].update(xi)
    return pools
