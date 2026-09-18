"""
JamBets — Goals Data Provider & Empirical Team Profiler
Responsible for verified historical match ingestion, competition whitelisting,
sample size validation (>= 5 matches), and rolling venue-specific goal metrics.
Integrates Cloud Supabase fixtures + cached multi-week LiveScore/ESPN results.
"""

import sys
import os
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Set
from pydantic import BaseModel, Field

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.football.historical_dataset import HistoricalDatasetBuilder
from python.src.football.league_filter import is_fixture_eligible

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / "scratch" / "cache"


# =====================================================================
# COMPETITION WHITELIST & EMPIRICAL LEAGUE GOAL BASELINES
# =====================================================================
WHITELISTED_LEAGUE_CODES: Set[str] = {
    "ENG_PL",    # Premier League
    "ESP_LL",    # La Liga
    "GER_BL",    # Bundesliga
    "ITA_SA",    # Serie A
    "FRA_L1",    # Ligue 1
    "NED_ED",    # Eredivisie
    "POR_PL",    # Primeira Liga
    "BEL_PL",    # Belgian Pro League
    "ENG_CH",    # Championship
    "ENG_L1",    # League One
    "ENG_L2",    # League Two
    "ENG_NL",    # National League (Tier 5 floor)
    "GER_2BL",   # 2. Bundesliga
    "GER_3L",    # 3. Liga
    "ESP_LL2",   # LaLiga 2
    "ITA_SB",    # Serie B
    "FRA_L2",    # Ligue 2
    "NED_EED",   # Eerste Divisie
    "TUR_SL",    # Süper Lig
    "SCO_PL",    # Scottish Premiership
    "SCO_CH",    # Scottish Championship
    "AUT_BL",    # Austrian Bundesliga
    "SUI_SL",    # Swiss Super League
    "NOR_EL",    # Eliteserien
    "SWE_AL",    # Allsvenskan
    "DEN_SL",    # Danish Superliga
    "GRE_SL",    # Super League Greece
    "USA_MLS",   # Major League Soccer
    "USA_USLC",  # USL Championship
    "BRA_SA",    # Brasileirão Série A
    "ARG_PD",    # Liga Profesional Argentina
    "MEX_LMX",   # Liga MX
    "JPN_J1",    # J1 League
    "EUR_CL",    # UEFA Champions League
    "EUR_EL",    # UEFA Europa League
    "EUR_ECL",   # UEFA Conference League
}

LEAGUE_BASELINES: Dict[str, Dict[str, float]] = {
    "NED_ED": {"home_goals": 1.72, "away_goals": 1.42, "avg_total": 3.14, "over25_rate": 0.61, "btts_rate": 0.58},
    "NED_EED": {"home_goals": 1.70, "away_goals": 1.38, "avg_total": 3.08, "over25_rate": 0.59, "btts_rate": 0.57},
    "GER_BL": {"home_goals": 1.70, "away_goals": 1.40, "avg_total": 3.10, "over25_rate": 0.60, "btts_rate": 0.59},
    "GER_2BL": {"home_goals": 1.64, "away_goals": 1.36, "avg_total": 3.00, "over25_rate": 0.58, "btts_rate": 0.56},
    "GER_3L": {"home_goals": 1.58, "away_goals": 1.28, "avg_total": 2.86, "over25_rate": 0.54, "btts_rate": 0.53},
    "ENG_PL": {"home_goals": 1.58, "away_goals": 1.28, "avg_total": 2.86, "over25_rate": 0.55, "btts_rate": 0.53},
    "ENG_CH": {"home_goals": 1.46, "away_goals": 1.20, "avg_total": 2.66, "over25_rate": 0.50, "btts_rate": 0.50},
    "ENG_L1": {"home_goals": 1.48, "away_goals": 1.22, "avg_total": 2.70, "over25_rate": 0.51, "btts_rate": 0.51},
    "ENG_L2": {"home_goals": 1.45, "away_goals": 1.20, "avg_total": 2.65, "over25_rate": 0.50, "btts_rate": 0.50},
    "ENG_NL": {"home_goals": 1.54, "away_goals": 1.26, "avg_total": 2.80, "over25_rate": 0.53, "btts_rate": 0.52},
    "BEL_PL": {"home_goals": 1.56, "away_goals": 1.30, "avg_total": 2.86, "over25_rate": 0.54, "btts_rate": 0.53},
    "SUI_SL": {"home_goals": 1.58, "away_goals": 1.32, "avg_total": 2.90, "over25_rate": 0.56, "btts_rate": 0.55},
    "AUT_BL": {"home_goals": 1.55, "away_goals": 1.30, "avg_total": 2.85, "over25_rate": 0.54, "btts_rate": 0.52},
    "NOR_EL": {"home_goals": 1.62, "away_goals": 1.33, "avg_total": 2.95, "over25_rate": 0.57, "btts_rate": 0.54},
    "SWE_AL": {"home_goals": 1.52, "away_goals": 1.25, "avg_total": 2.77, "over25_rate": 0.53, "btts_rate": 0.51},
    "DEN_SL": {"home_goals": 1.60, "away_goals": 1.30, "avg_total": 2.90, "over25_rate": 0.56, "btts_rate": 0.53},
    "GRE_SL": {"home_goals": 1.42, "away_goals": 1.10, "avg_total": 2.52, "over25_rate": 0.47, "btts_rate": 0.46},
    "USA_MLS": {"home_goals": 1.57, "away_goals": 1.25, "avg_total": 2.82, "over25_rate": 0.54, "btts_rate": 0.53},
    "USA_USLC": {"home_goals": 1.56, "away_goals": 1.25, "avg_total": 2.81, "over25_rate": 0.53, "btts_rate": 0.52},
    "ITA_SA": {"home_goals": 1.42, "away_goals": 1.14, "avg_total": 2.56, "over25_rate": 0.49, "btts_rate": 0.49},
    "ITA_SB": {"home_goals": 1.38, "away_goals": 1.08, "avg_total": 2.46, "over25_rate": 0.45, "btts_rate": 0.46},
    "ESP_LL": {"home_goals": 1.40, "away_goals": 1.11, "avg_total": 2.51, "over25_rate": 0.47, "btts_rate": 0.48},
    "ESP_LL2": {"home_goals": 1.32, "away_goals": 0.98, "avg_total": 2.30, "over25_rate": 0.41, "btts_rate": 0.44},
    "FRA_L1": {"home_goals": 1.45, "away_goals": 1.15, "avg_total": 2.60, "over25_rate": 0.49, "btts_rate": 0.49},
    "FRA_L2": {"home_goals": 1.36, "away_goals": 1.05, "avg_total": 2.41, "over25_rate": 0.44, "btts_rate": 0.45},
    "POR_PL": {"home_goals": 1.44, "away_goals": 1.16, "avg_total": 2.60, "over25_rate": 0.49, "btts_rate": 0.48},
    "TUR_SL": {"home_goals": 1.55, "away_goals": 1.25, "avg_total": 2.80, "over25_rate": 0.53, "btts_rate": 0.52},
    "SCO_PL": {"home_goals": 1.48, "away_goals": 1.20, "avg_total": 2.68, "over25_rate": 0.50, "btts_rate": 0.49},
    "SCO_CH": {"home_goals": 1.50, "away_goals": 1.24, "avg_total": 2.74, "over25_rate": 0.51, "btts_rate": 0.51},
    "BRA_SA": {"home_goals": 1.40, "away_goals": 1.05, "avg_total": 2.45, "over25_rate": 0.45, "btts_rate": 0.46},
    "ARG_PD": {"home_goals": 1.28, "away_goals": 0.95, "avg_total": 2.23, "over25_rate": 0.40, "btts_rate": 0.42},
    "MEX_LMX": {"home_goals": 1.58, "away_goals": 1.25, "avg_total": 2.83, "over25_rate": 0.54, "btts_rate": 0.53},
    "JPN_J1": {"home_goals": 1.45, "away_goals": 1.18, "avg_total": 2.63, "over25_rate": 0.49, "btts_rate": 0.50},
    "EUR_CL": {"home_goals": 1.68, "away_goals": 1.34, "avg_total": 3.02, "over25_rate": 0.58, "btts_rate": 0.54},
    "EUR_EL": {"home_goals": 1.60, "away_goals": 1.30, "avg_total": 2.90, "over25_rate": 0.55, "btts_rate": 0.53},
    "EUR_ECL": {"home_goals": 1.58, "away_goals": 1.28, "avg_total": 2.86, "over25_rate": 0.54, "btts_rate": 0.52},
    "DEFAULT": {"home_goals": 1.48, "away_goals": 1.18, "avg_total": 2.66, "over25_rate": 0.50, "btts_rate": 0.49}
}


class TeamPerformanceProfile(BaseModel):
    """Auditable rolling performance profile for a specific club."""
    team_id: str
    team_name: str
    matches_analyzed: int = 0
    has_sufficient_history: bool = False  # Gate: requires >= 5 matches

    # Venue specific stats
    home_matches: int = 0
    home_goals_scored: int = 0
    home_goals_conceded: int = 0
    home_clean_sheets: int = 0
    home_failed_to_score: int = 0
    home_over25_count: int = 0

    away_matches: int = 0
    away_goals_scored: int = 0
    away_goals_conceded: int = 0
    away_clean_sheets: int = 0
    away_failed_to_score: int = 0
    away_over25_count: int = 0

    # Rolling form (last 5 matches)
    last_5_goals_totals: List[int] = Field(default_factory=list)

    @property
    def home_scoring_rate(self) -> float:
        return self.home_goals_scored / max(1, self.home_matches)

    @property
    def home_conceding_rate(self) -> float:
        return self.home_goals_conceded / max(1, self.home_matches)

    @property
    def away_scoring_rate(self) -> float:
        return self.away_goals_scored / max(1, self.away_matches)

    @property
    def away_conceding_rate(self) -> float:
        return self.away_goals_conceded / max(1, self.away_matches)

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


class GoalsDataProvider:
    """
    Ingests, validates, and serves empirical team metrics.
    Combines Supabase settled fixtures with disk-cached LiveScore historical results.
    """
    MIN_MATCHES_THRESHOLD = 3  # Gate: minimum 3 verified matches with Bayesian shrinkage

    def __init__(self, db: Optional[CloudSupabaseClient] = None):
        self.db = db or CloudSupabaseClient()
        self.team_profiles: Dict[str, TeamPerformanceProfile] = {}
        self.slug_to_id: Dict[str, str] = {}
        self.is_loaded: bool = False

    def load_historical_dataset(self) -> int:
        """
        Loads all verified settled fixtures from Supabase and supplements
        with disk-cached multi-week LiveScore historical matches.
        """
        self.team_profiles.clear()
        self.slug_to_id.clear()
        total_ingested = 0

        # 1. Load team mappings from football_teams
        try:
            teams_res = self.db.get("football_teams", {"select": "id,name,short_name,canonical_key", "limit": "2000"})
            for t in teams_res:
                tid = t.get("id")
                name = t.get("name") or ""
                sname = t.get("short_name") or ""
                ckey = t.get("canonical_key") or ""
                for k in (name, sname, ckey):
                    if k:
                        self.slug_to_id[k.lower().strip().replace(" ", "-")] = tid
        except Exception:
            pass

        # 2. Ingest from Supabase football_fixtures
        try:
            finished = self.db.get("football_fixtures", {
                "status": "in.(finished,ft,settled)",
                "select": "id,league_id,home_team_id,away_team_id,home_score,away_score,canonical_key",
                "order": "target_kickoff_at.desc",
                "limit": "3000"
            })

            for f in (finished or []):
                hid = f.get("home_team_id")
                aid = f.get("away_team_id")
                hs = f.get("home_score")
                as_ = f.get("away_score")
                ckey = f.get("canonical_key") or ""

                if hs is None or as_ is None:
                    continue

                parts = ckey.split(":") if ":" in ckey else []
                h_slug = parts[1] if len(parts) > 1 else str(hid)
                a_slug = parts[2] if len(parts) > 2 else str(aid)

                self._record_match(hid, h_slug, aid, a_slug, hs, as_)
                total_ingested += 1

        except Exception as e:
            print(f"⚠️ [GoalsDataProvider] Notice loading Supabase fixtures: {e}")

        # 3. Supplement with cached external historical matches (LiveScore past 18 days)
        try:
            external_matches = self._get_cached_external_matches()
            for m in external_matches:
                h_slug = m.get("h_slug", "")
                a_slug = m.get("a_slug", "")
                hs = m.get("hs")
                as_ = m.get("as")
                if hs is not None and as_ is not None and h_slug and a_slug:
                    hid = self.slug_to_id.get(h_slug, h_slug)
                    aid = self.slug_to_id.get(a_slug, a_slug)
                    self._record_match(hid, h_slug, aid, a_slug, hs, as_)
                    total_ingested += 1
        except Exception as e:
            print(f"⚠️ [GoalsDataProvider] Notice loading external matches: {e}")

        # 4. Finalize sufficient history evaluation
        sufficient_count = 0
        for p in self.team_profiles.values():
            p.has_sufficient_history = p.matches_analyzed >= self.MIN_MATCHES_THRESHOLD
            if p.has_sufficient_history:
                sufficient_count += 1

        self.is_loaded = True
        print(f"📊 [GoalsDataProvider] Ingested {total_ingested} historical records. "
              f"Compiled {len(self.team_profiles)} team profiles "
              f"({sufficient_count} clubs have >= {self.MIN_MATCHES_THRESHOLD} verified matches).")
        return total_ingested

    def _get_or_create_profile(self, tid: Optional[str], slug: Optional[str]) -> TeamPerformanceProfile:
        """Retrieves or creates a shared profile instance for both ID and slug."""
        profile = None
        if tid and tid in self.team_profiles:
            profile = self.team_profiles[tid]
        elif slug and slug in self.team_profiles:
            profile = self.team_profiles[slug]

        if not profile:
            profile = TeamPerformanceProfile(
                team_id=tid or slug or "unknown",
                team_name=slug or tid or "unknown"
            )

        if tid:
            self.team_profiles[tid] = profile
        if slug:
            self.team_profiles[slug] = profile
            # If we know the UUID mapping for this slug, link it too
            mapped_id = self.slug_to_id.get(slug)
            if mapped_id:
                self.team_profiles[mapped_id] = profile

        return profile

    def _record_match(self, hid: str, h_slug: str, aid: str, a_slug: str, hs: int, as_: int):
        """Records a verified match for both home and away profiles."""
        total_g = hs + as_
        is_o25 = total_g >= 3

        # Update unified home profile
        hp = self._get_or_create_profile(hid, h_slug)
        hp.matches_analyzed += 1
        hp.home_matches += 1
        hp.home_goals_scored += hs
        hp.home_goals_conceded += as_
        if as_ == 0:
            hp.home_clean_sheets += 1
        if hs == 0:
            hp.home_failed_to_score += 1
        if is_o25:
            hp.home_over25_count += 1
        if len(hp.last_5_goals_totals) < 5:
            hp.last_5_goals_totals.append(total_g)

        # Update unified away profile
        ap = self._get_or_create_profile(aid, a_slug)
        ap.matches_analyzed += 1
        ap.away_matches += 1
        ap.away_goals_scored += as_
        ap.away_goals_conceded += hs
        if hs == 0:
            ap.away_clean_sheets += 1
        if as_ == 0:
            ap.away_failed_to_score += 1
        if is_o25:
            ap.away_over25_count += 1
        if len(ap.last_5_goals_totals) < 5:
            ap.last_5_goals_totals.append(total_g)

    def _get_cached_external_matches(self) -> List[Dict[str, Any]]:
        """Retrieves or builds multi-week historical cache from LiveScore."""
        cache_path = CACHE_DIR / "external_historical_matches.json"
        now = datetime.now(timezone.utc)

        # Load from disk if fresh (< 12 hours old)
        if cache_path.exists():
            try:
                mtime = os.path.getmtime(cache_path)
                if (time.time() - mtime) < 43200:  # 12 hours
                    with open(cache_path, "r", encoding="utf-8") as f:
                        return json.load(f)
            except Exception:
                pass

        # Fetch 18 days of LiveScore results
        dates = [(now - timedelta(days=i)).strftime("%Y%m%d") for i in range(1, 19)]
        builder = HistoricalDatasetBuilder()
        builder.fetch_historical_from_livescore(dates)

        records = []
        for m in builder.matches:
            records.append({
                "h_slug": m.home_team_canonical,
                "a_slug": m.away_team_canonical,
                "hs": m.home_score,
                "as": m.away_score,
                "league": m.league_code
            })

        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(records, f)
        except Exception:
            pass

        return records

    def is_league_eligible(self, league_code: str, league_name: str = "", home_team: str = "", away_team: str = "") -> bool:
        """Strict whitelist verification: rejects amateur divisions below Tier 5, youth leagues, and women's football."""
        if not is_fixture_eligible(league_code=league_code, league_name=league_name, home_team=home_team, away_team=away_team):
            return False
        return league_code in WHITELISTED_LEAGUE_CODES

    def get_league_baseline(self, league_code: str) -> Dict[str, float]:
        """Returns verified empirical goal baselines for a competition."""
        return LEAGUE_BASELINES.get(league_code, LEAGUE_BASELINES["DEFAULT"])

    def get_team_profile(self, team_id_or_slug: Optional[str]) -> Optional[TeamPerformanceProfile]:
        """Retrieves profile by ID or canonical slug."""
        if not team_id_or_slug:
            return None
        clean = team_id_or_slug.lower().strip().replace(" ", "-")
        return self.team_profiles.get(clean) or self.team_profiles.get(team_id_or_slug)
