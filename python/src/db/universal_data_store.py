"""
JamBets — Universal Historical Data Store & Profiler (Phase 5)
Provides a single, consolidated, multi-season historical dataset and profile engine
for ALL specialist engines (Core 1X2, Home & Away, Draw Hunter, Corners, Goals).
Eliminates fragmented database queries and small-sample collapse.
"""

import sys
import os
import json
import time
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Set, Tuple
from pydantic import BaseModel, Field

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.football.identity import normalize_team_name

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "scratch" / "cache"


class UnifiedTeamProfile(BaseModel):
    """Auditable multi-season performance profile for a football club."""
    team_id: str
    team_name: str
    canonical_slug: str
    matches_analyzed: int = 0
    has_sufficient_history: bool = False

    # Venue performance
    home_matches: int = 0
    home_wins: int = 0
    home_draws: int = 0
    home_losses: int = 0
    home_goals_for: float = 0.0
    home_goals_against: float = 0.0
    home_clean_sheets: int = 0
    home_corners_for: float = 0.0
    home_corners_against: float = 0.0
    home_over25_count: int = 0

    away_matches: int = 0
    away_wins: int = 0
    away_draws: int = 0
    away_losses: int = 0
    away_goals_for: float = 0.0
    away_goals_against: float = 0.0
    away_clean_sheets: int = 0
    away_corners_for: float = 0.0
    away_corners_against: float = 0.0
    away_over25_count: int = 0

    # Aggregates
    total_goals_for: float = 0.0
    total_goals_against: float = 0.0
    rolling_npxg: float = 0.0
    rolling_xga: float = 0.0

    # Match log for H2H and form analysis
    match_log: List[Dict[str, Any]] = Field(default_factory=list)

    @property
    def home_scoring_rate(self) -> float:
        return self.home_goals_for / max(1, self.home_matches)

    @property
    def home_conceding_rate(self) -> float:
        return self.home_goals_against / max(1, self.home_matches)

    @property
    def away_scoring_rate(self) -> float:
        return self.away_goals_for / max(1, self.away_matches)

    @property
    def away_conceding_rate(self) -> float:
        return self.away_goals_against / max(1, self.away_matches)

    @property
    def home_win_rate(self) -> float:
        return self.home_wins / max(1, self.home_matches)

    @property
    def away_win_rate(self) -> float:
        return self.away_wins / max(1, self.away_matches)

    @property
    def home_clean_sheet_pct(self) -> float:
        return self.home_clean_sheets / max(1, self.home_matches)

    @property
    def away_clean_sheet_pct(self) -> float:
        return self.away_clean_sheets / max(1, self.away_matches)

    @property
    def home_over25_pct(self) -> float:
        return self.home_over25_count / max(1, self.home_matches)

    @property
    def away_over25_pct(self) -> float:
        return self.away_over25_count / max(1, self.away_matches)


class H2HRecord(BaseModel):
    """Direct head-to-head record between two specific clubs."""
    team_a: str
    team_b: str
    matches_count: int = 0
    team_a_wins: int = 0
    draws: int = 0
    team_b_wins: int = 0
    avg_total_goals: float = 2.65
    over25_rate: float = 0.50
    btts_rate: float = 0.50
    avg_corners: float = 8.50
    recent_encounters: List[Dict[str, Any]] = Field(default_factory=list)
    has_sufficient_h2h: bool = False


class UniversalDataStore:
    """
    Singleton repository providing multi-season historical match data,
    opponent-adjusted team profiles, and direct H2H lookups to all engines.
    """
    _instance: Optional['UniversalDataStore'] = None

    @classmethod
    def get_instance(cls, db: Optional[CloudSupabaseClient] = None) -> 'UniversalDataStore':
        if cls._instance is None:
            cls._instance = cls(db=db)
            cls._instance.warm_up()
        return cls._instance

    def __init__(self, db: Optional[CloudSupabaseClient] = None):
        self.db = db or CloudSupabaseClient()
        self.profiles: Dict[str, UnifiedTeamProfile] = {}
        self.slug_to_id: Dict[str, str] = {}
        self.id_to_slug: Dict[str, str] = {}
        self.raw_matches: List[Dict[str, Any]] = []
        self.h2h_index: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
        self.is_loaded: bool = False

    def warm_up(self) -> int:
        """Eagerly loads historical data from disk cache, LiveScore, and Supabase."""
        if self.is_loaded:
            return len(self.raw_matches)

        print("⚡ [UniversalDataStore] Warming up unified multi-season dataset...")
        start_time = time.time()
        self.profiles.clear()
        self.slug_to_id.clear()
        self.id_to_slug.clear()
        self.raw_matches.clear()
        self.h2h_index.clear()

        # 1. Load team mappings from Supabase
        try:
            teams_res = self.db.get("football_teams", {
                "select": "id,name",
                "limit": "3000"
            })
            for t in (teams_res or []):
                tid = t.get("id")
                name = t.get("name") or ""
                if name:
                    norm = normalize_team_name(name)
                    self.slug_to_id[norm] = tid
                    self.slug_to_id[name.lower().strip().replace(" ", "-")] = tid
                if tid and name:
                    self.id_to_slug[tid] = normalize_team_name(name)
        except Exception as e:
            print(f"⚠️ [UniversalDataStore] Team metadata notice: {e}")

        # 2. Ingest Disk-Cached Multi-Week Matches
        cached_matches = self._load_disk_cache()
        for m in cached_matches:
            self._ingest_match(
                h_slug=m.get("h_slug", ""),
                a_slug=m.get("a_slug", ""),
                hs=m.get("hs"),
                as_=m.get("as"),
                league=m.get("league", "OTHER"),
                date_str=m.get("date", ""),
                hc=m.get("hc"),
                ac=m.get("ac")
            )

        # 3. Ingest Supabase finished/settled fixtures
        try:
            fixtures = self.db.get("football_fixtures", {
                "status": "in.(finished,settled,ft,aet,pen)",
                "select": "id,league_id,home_team_id,away_team_id,home_score,away_score,canonical_key,target_kickoff_at,corners_home,corners_away",
                "order": "target_kickoff_at.desc",
                "limit": "5000"
            })
            for f in (fixtures or []):
                hid = f.get("home_team_id")
                aid = f.get("away_team_id")
                hs = f.get("home_score")
                as_ = f.get("away_score")
                if hs is None or as_ is None:
                    continue

                ckey = f.get("canonical_key") or ""
                parts = ckey.split(":") if ":" in ckey else []
                h_slug = parts[1] if len(parts) > 1 else (self.id_to_slug.get(hid) or str(hid))
                a_slug = parts[2] if len(parts) > 2 else (self.id_to_slug.get(aid) or str(aid))

                self._ingest_match(
                    h_slug=h_slug,
                    a_slug=a_slug,
                    hs=int(hs),
                    as_=int(as_),
                    league=parts[0] if parts else "OTHER",
                    date_str=f.get("target_kickoff_at", ""),
                    hc=f.get("corners_home"),
                    ac=f.get("corners_away"),
                    h_id=hid,
                    a_id=aid
                )
        except Exception as e:
            print(f"⚠️ [UniversalDataStore] Supabase fixtures notice: {e}")

        # 4. Compute sufficiency flags
        sufficient = sum(1 for p in self.profiles.values() if p.matches_analyzed >= 4)
        self.is_loaded = True
        elapsed = time.time() - start_time
        print(f"✅ [UniversalDataStore] Ingested {len(self.raw_matches)} matches across {len(self.profiles)} clubs "
              f"({sufficient} clubs with verified history) in {elapsed:.2f}s.")
        return len(self.raw_matches)

    def _load_disk_cache(self) -> List[Dict[str, Any]]:
        """Loads cached external historical matches."""
        cache_path = CACHE_DIR / "external_historical_matches.json"
        if cache_path.exists():
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    def _ingest_match(
        self,
        h_slug: str,
        a_slug: str,
        hs: Optional[int],
        as_: Optional[int],
        league: str = "OTHER",
        date_str: str = "",
        hc: Optional[int] = None,
        ac: Optional[int] = None,
        h_id: Optional[str] = None,
        a_id: Optional[str] = None
    ):
        if hs is None or as_ is None or not h_slug or not a_slug:
            return

        h_norm = normalize_team_name(h_slug)
        a_norm = normalize_team_name(a_slug)

        hid = h_id or self.slug_to_id.get(h_norm) or h_norm
        aid = a_id or self.slug_to_id.get(a_norm) or a_norm

        p_h = self._get_or_create_profile(hid, h_norm)
        p_a = self._get_or_create_profile(aid, a_norm)

        match_record = {
            "home": h_norm,
            "away": a_norm,
            "home_id": hid,
            "away_id": aid,
            "home_score": hs,
            "away_score": as_,
            "home_corners": hc,
            "away_corners": ac,
            "league": league,
            "date": date_str
        }
        self.raw_matches.append(match_record)

        # Index H2H symmetrically
        pair_key = tuple(sorted([h_norm, a_norm]))
        self.h2h_index.setdefault(pair_key, []).append(match_record)

        # Home Profile Update
        p_h.matches_analyzed += 1
        p_h.home_matches += 1
        p_h.home_goals_for += hs
        p_h.home_goals_against += as_
        p_h.total_goals_for += hs
        p_h.total_goals_against += as_
        if hs > as_:
            p_h.home_wins += 1
        elif hs == as_:
            p_h.home_draws += 1
        else:
            p_h.home_losses += 1
        if as_ == 0:
            p_h.home_clean_sheets += 1
        if (hs + as_) > 2:
            p_h.home_over25_count += 1
        if hc is not None:
            p_h.home_corners_for += hc
        if ac is not None:
            p_h.home_corners_against += ac
        p_h.match_log.append(match_record)

        # Away Profile Update
        p_a.matches_analyzed += 1
        p_a.away_matches += 1
        p_a.away_goals_for += as_
        p_a.away_goals_against += hs
        p_a.total_goals_for += as_
        p_a.total_goals_against += hs
        if as_ > hs:
            p_a.away_wins += 1
        elif as_ == hs:
            p_a.away_draws += 1
        else:
            p_a.away_losses += 1
        if hs == 0:
            p_a.away_clean_sheets += 1
        if (hs + as_) > 2:
            p_a.away_over25_count += 1
        if ac is not None:
            p_a.away_corners_for += ac
        if hc is not None:
            p_a.away_corners_against += hc
        p_a.match_log.append(match_record)

        p_h.has_sufficient_history = p_h.matches_analyzed >= 4
        p_a.has_sufficient_history = p_a.matches_analyzed >= 4

    def _get_or_create_profile(self, tid: str, slug: str) -> UnifiedTeamProfile:
        if tid in self.profiles:
            return self.profiles[tid]
        if slug in self.profiles:
            return self.profiles[slug]

        profile = UnifiedTeamProfile(
            team_id=tid,
            team_name=slug.replace("-", " ").title(),
            canonical_slug=slug
        )
        self.profiles[tid] = profile
        self.profiles[slug] = profile
        return profile

    def get_profile(self, identifier: Optional[str]) -> Optional[UnifiedTeamProfile]:
        """Resolves team profile by UUID, canonical slug, or raw name."""
        if not identifier:
            return None
        if identifier in self.profiles:
            return self.profiles[identifier]

        norm = normalize_team_name(identifier)
        if norm in self.profiles:
            return self.profiles[norm]

        tid = self.slug_to_id.get(norm) or self.slug_to_id.get(identifier.lower().strip().replace(" ", "-"))
        if tid and tid in self.profiles:
            return self.profiles[tid]

        return None

    def get_h2h(self, home_team: str, away_team: str, limit: int = 10) -> H2HRecord:
        """Computes true direct head-to-head record between two clubs."""
        h_norm = normalize_team_name(home_team)
        a_norm = normalize_team_name(away_team)
        pair_key = tuple(sorted([h_norm, a_norm]))

        encounters = self.h2h_index.get(pair_key, [])
        if not encounters:
            return H2HRecord(
                team_a=h_norm,
                team_b=a_norm,
                matches_count=0,
                has_sufficient_h2h=False
            )

        # Sort encounters by date descending
        sorted_enc = sorted(encounters, key=lambda m: m.get("date", ""), reverse=True)[:limit]
        n = len(sorted_enc)

        h_wins = 0
        a_wins = 0
        draws = 0
        tot_goals = 0
        over25_count = 0
        btts_count = 0
        tot_corners = 0
        corners_counted = 0

        for m in sorted_enc:
            hs = m["home_score"]
            as_ = m["away_score"]
            tot_goals += (hs + as_)
            if (hs + as_) > 2:
                over25_count += 1
            if hs > 0 and as_ > 0:
                btts_count += 1

            # Check winner relative to home_team argument
            is_team_a_home = (m["home"] == h_norm)
            if hs == as_:
                draws += 1
            elif (hs > as_ and is_team_a_home) or (as_ > hs and not is_team_a_home):
                h_wins += 1
            else:
                a_wins += 1

            hc = m.get("home_corners")
            ac = m.get("away_corners")
            if hc is not None and ac is not None:
                tot_corners += (hc + ac)
                corners_counted += 1

        avg_c = round(tot_corners / corners_counted, 2) if corners_counted > 0 else 8.50

        return H2HRecord(
            team_a=h_norm,
            team_b=a_norm,
            matches_count=n,
            team_a_wins=h_wins,
            draws=draws,
            team_b_wins=a_wins,
            avg_total_goals=round(tot_goals / n, 2),
            over25_rate=round(over25_count / n, 3),
            btts_rate=round(btts_count / n, 3),
            avg_corners=avg_c,
            recent_encounters=sorted_enc,
            has_sufficient_h2h=(n >= 2)
        )
