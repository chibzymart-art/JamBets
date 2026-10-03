"""
Oddsbanta — Autonomous Live Tennis Scraper (LiveScore Feed Adapter)
Phase 1: Multi-Source Tennis Ingestion for Premier Tours, Challengers & Cups

Features:
- Connects directly to LiveScore's public tennis endpoints
- Ingests ATP 250/500/1000/Grand Slams, ATP Challenger Tour, WTA 125/Challengers, and Team Cups (Laver Cup, Davis Cup)
- Filters strictly to Singles matches (eliminating Doubles and Country-tier tie headers)
- Extracts full line scores, game totals, retirements, walkovers, and round codes
- Normalizes player canonical names, tournament stages, court categories, and UTC kickoff timestamps
- Invariant: 100% standalone tennis module. Zero football dependencies.
"""

import re
import logging
import httpx
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from .base import BaseTennisScraper
try:
    from ..tournament_normalizer import TournamentNormalizer
except (ImportError, ValueError):
    from python.src.tennis.tournament_normalizer import TournamentNormalizer

logger = logging.getLogger("tennis.scraper.livescore")


class LiveScoreTennisScraper(BaseTennisScraper):
    """
    High-availability, zero-auth live feed scraper for ATP, WTA, ATP Challenger,
    WTA 125, and International Tennis Tournaments via LiveScore.
    """

    BASE_URL = "https://prod-public-api.livescore.com/v1/api/app/date/tennis"

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout
        self.client = httpx.Client(
            timeout=self.timeout,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                "Accept": "application/json"
            }
        )

    @staticmethod
    def slugify(text: str) -> str:
        """
        Converts player names and tournament strings into deterministic canonical identifiers.
        """
        if not text:
            return "unknown"
        clean = re.sub(r"[^\w\s-]", "", text.strip().lower())
        return re.sub(r"[-\s]+", "_", clean)

    def fetch_rankings(self, tour: str = "atp") -> List[Dict[str, Any]]:
        """
        LiveScore does not provide standalone ranking tables; rankings are fetched via ESPN feed.
        """
        return []

    def fetch_scoreboard(self, tour: str = "all", date_str: Optional[str] = None) -> Dict[str, Any]:
        """
        Fetches live tennis scoreboard from LiveScore for a specified date (YYYYMMDD).
        """
        if not date_str:
            date_str = datetime.now(timezone.utc).strftime("%Y%m%d")

        url = f"{self.BASE_URL}/{date_str}/1"
        try:
            resp = self.client.get(url)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error("Error fetching LiveScore tennis scoreboard for date %s: %s", date_str, e)
            return {}

    def parse_fixtures_from_scoreboard(
        self,
        raw_data: Dict[str, Any],
        tour: str = "all",
        min_kickoff: Optional[datetime] = None,
        max_kickoff: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """
        Extracts, filters, and normalizes singles matches from LiveScore scoreboard JSON.
        Optionally filters matches to [min_kickoff, max_kickoff] window and discards past concluded matches.
        """
        fixtures = []
        stages = raw_data.get("Stages", [])
        if not stages:
            return []

        for stg in stages:
            cnm = (stg.get("Cnm") or "").strip()  # e.g., "ATP 250", "ATP Challenger", "WTA 500", "WTA Challenger"
            snm = (stg.get("Snm") or "").strip()  # e.g., "Chengdu Open", "St. Tropez, France", "Laver Cup"

            # Determine tour & tournament category
            detected_tour, category = self._resolve_tour_and_category(cnm, snm)

            # Filter by requested tour if specified
            if tour != "all":
                requested = tour.upper()
                if requested == "ATP" and detected_tour not in ("ATP", "GRAND_SLAM"):
                    continue
                elif requested == "WTA" and detected_tour not in ("WTA", "GRAND_SLAM"):
                    continue
                elif requested == "TEAM" and detected_tour != "TEAM":
                    continue

            events = stg.get("Events", [])
            for ev in events:
                t1 = ev.get("T1", [])
                t2 = ev.get("T2", [])

                # 1. Strictly Singles Only (Doubles have 2 athletes per team)
                if len(t1) != 1 or len(t2) != 1:
                    continue

                p1_name = (t1[0].get("Nm") or "").strip()
                p2_name = (t2[0].get("Nm") or "").strip()

                # Discard unknown, TBD, or Country-tier team headers
                if not p1_name or not p2_name or p1_name.upper() == "TBD" or p2_name.upper() == "TBD":
                    continue
                if self._is_country_team_header(p1_name, p2_name):
                    continue

                p1_canonical = self.slugify(p1_name)
                p2_canonical = self.slugify(p2_name)

                # 2. Parse Kickoff Datetime (Esd: YYYYMMDDHHMMSS)
                esd = str(ev.get("Esd") or "")
                kickoff_dt = self._parse_kickoff(esd)
                kickoff_iso = kickoff_dt.isoformat()

                # 3. Status Mapping & Retirements / Walkovers
                eps = (ev.get("Eps") or "NS").strip()
                status = self._map_status(eps)
                was_retired = "ret" in eps.lower()
                was_walkover = "w/o" in eps.lower() or "wo" in eps.lower()

                # 4. Strict Temporal Filtering
                if min_kickoff is not None:
                    if status in ("finished", "retired", "walkover", "cancelled"):
                        continue
                    if kickoff_dt < min_kickoff and status != "live":
                        continue

                if max_kickoff is not None:
                    if kickoff_dt > max_kickoff:
                        continue

                # 5. Score Parsing & Line Scores
                p1_sets = int(ev["Tr1"]) if ev.get("Tr1") is not None and str(ev["Tr1"]).isdigit() else 0
                p2_sets = int(ev["Tr2"]) if ev.get("Tr2") is not None and str(ev["Tr2"]).isdigit() else 0

                set_scores = []
                for s_idx in range(1, 6):
                    s1 = ev.get(f"Tr1S{s_idx}")
                    s2 = ev.get(f"Tr2S{s_idx}")
                    if s1 is not None and s2 is not None:
                        set_scores.append(f"{s1}-{s2}")

                # 6. Winner identification
                winner_canonical = None
                ewt = ev.get("Ewt")
                if ewt == 1:
                    winner_canonical = p1_canonical
                elif ewt == 2:
                    winner_canonical = p2_canonical
                elif status in ("finished", "retired") and p1_sets != p2_sets:
                    winner_canonical = p1_canonical if p1_sets > p2_sets else p2_canonical

                # 7. Round Code Mapping
                ern_inf = str(ev.get("ErnInf") or "").strip()
                round_code = self._map_round_code(ern_inf)

                # 8. Deterministic Canonical Key: TOUR:TOURNAMENT:P1-P2:DATE
                raw_tournament_name = f"{snm}"
                date_key = kickoff_dt.strftime("%Y%m%d")
                normalized_tour = TournamentNormalizer.normalize(raw_tournament_name)
                canonical_key = f"{detected_tour}:{normalized_tour}:{p1_canonical}-{p2_canonical}:{date_key}"

                fixture = {
                    "source": "livescore",
                    "external_id": str(ev.get("Eid") or canonical_key),
                    "canonical_key": canonical_key,
                    "raw_tournament_name": raw_tournament_name,
                    "tour": detected_tour,
                    "category": category,
                    "round": round_code,
                    "target_kickoff_at": kickoff_iso,
                    "status": status,
                    "best_of_sets": 5 if category == "GS" and detected_tour == "ATP" else 3,
                    "player1": {
                        "canonical_name": p1_canonical,
                        "display_name": p1_name,
                        "rank": None,
                        "country": None
                    },
                    "player2": {
                        "canonical_name": p2_canonical,
                        "display_name": p2_name,
                        "rank": None,
                        "country": None
                    },
                    "score_p1_sets": p1_sets,
                    "score_p2_sets": p2_sets,
                    "set_scores": set_scores,
                    "winner_canonical": winner_canonical,
                    "was_retired": was_retired,
                    "was_walkover": was_walkover
                }
                fixtures.append(fixture)

        return fixtures

    def parse_settlement_results_from_scoreboard(
        self,
        raw_data: Dict[str, Any],
        tour: str = "all"
    ) -> List[Dict[str, Any]]:
        """
        Parses all singles matches from LiveScore scoreboard JSON for settlement inspection.
        Preserves completed ('finished', 'retired', 'walkover') and 'live' matches
        along with their line scores, game totals, and winner IDs.
        """
        raw_fixtures = self.parse_fixtures_from_scoreboard(
            raw_data,
            tour=tour,
            min_kickoff=None,
            max_kickoff=None
        )
        results = []
        for f in raw_fixtures:
            ret_canon = None
            if f.get("was_retired"):
                if f.get("winner_canonical") == f["player1"]["canonical_name"]:
                    ret_canon = f["player2"]["canonical_name"]
                elif f.get("winner_canonical") == f["player2"]["canonical_name"]:
                    ret_canon = f["player1"]["canonical_name"]

            results.append({
                "espn_competition_id": f.get("external_id"),
                "raw_tournament_name": f["raw_tournament_name"],
                "tournament_slug": self.slugify(f["raw_tournament_name"]),
                "venue_name": None,
                "tour": f["tour"],
                "round": f["round"],
                "best_of_sets": f["best_of_sets"],
                "target_kickoff_at": f["target_kickoff_at"],
                "status": f["status"],
                "player1": f["player1"],
                "player2": f["player2"],
                "score_p1_sets": f["score_p1_sets"],
                "score_p2_sets": f["score_p2_sets"],
                "set_scores": f["set_scores"],
                "winner_canonical": f.get("winner_canonical"),
                "retired_player_canonical": ret_canon,
                "was_retired": f.get("was_retired", False),
                "was_walkover": f.get("was_walkover", False)
            })
        return results

    @staticmethod
    def _resolve_tour_and_category(cnm: str, snm: str) -> tuple[str, str]:
        """
        Determines tour (ATP, WTA, GRAND_SLAM, TEAM) and tournament category (GS, 1000, 500, 250, CH, CUP).
        """
        c_upper = cnm.upper()
        s_upper = snm.upper()

        if any(gs in s_upper for gs in ["WIMBLEDON", "ROLAND GARROS", "US OPEN", "AUSTRALIAN OPEN", "FRENCH OPEN"]):
            return "GRAND_SLAM", "GS"

        if "CHALLENGER" in c_upper or "CHALLENGER" in s_upper or "WTA 125" in c_upper:
            if "WTA" in c_upper:
                return "WTA", "CH"
            return "ATP", "CH"

        if "LAVER CUP" in c_upper or "LAVER CUP" in s_upper or "DAVIS CUP" in c_upper or "BILLIE JEAN KING" in c_upper:
            return "TEAM", "CUP"

        if "1000" in c_upper or "MASTERS" in s_upper:
            tour = "WTA" if "WTA" in c_upper else "ATP"
            return tour, "1000"

        if "500" in c_upper:
            tour = "WTA" if "WTA" in c_upper else "ATP"
            return tour, "500"

        if "WTA" in c_upper:
            return "WTA", "250"

        return "ATP", "250"

    @staticmethod
    def _map_round_code(ern_inf: str) -> str:
        """
        Maps LiveScore round descriptions into canonical database codes (F, SF, QF, R16, R32, R64, R128).
        """
        r = ern_inf.lower().strip()
        if "final" in r and "semi" not in r and "quarter" not in r and "1/4" not in r and "1/2" not in r:
            return "F"
        elif "semi" in r or "1/2" in r or "sf" in r:
            return "SF"
        elif "quarter" in r or "1/4" in r or "qf" in r:
            return "QF"
        elif "16" in r or "1/8" in r or "4th" in r:
            return "R16"
        elif "32" in r or "3rd" in r:
            return "R32"
        elif "64" in r or "2nd" in r:
            return "R64"
        elif "128" in r or "1st" in r:
            return "R128"
        elif "qual" in r:
            return "QUAL"
        return "R32"

    @staticmethod
    def _is_country_team_header(p1: str, p2: str) -> bool:
        """
        Identifies non-player country matchup lines (e.g. 'Ukraine vs Czechia') in team tournaments.
        """
        common_nations = {
            "ARGENTINA", "AUSTRALIA", "AUSTRIA", "BELGIUM", "BRAZIL", "CANADA", "CHILE", "CHINA",
            "CROATIA", "CZECHIA", "CZECH REPUBLIC", "DENMARK", "FINLAND", "FRANCE", "GERMANY",
            "GREAT BRITAIN", "GREECE", "HUNGARY", "ITALY", "JAPAN", "KAZAKHSTAN", "NETHERLANDS",
            "NORWAY", "POLAND", "PORTUGAL", "SERBIA", "SLOVAKIA", "SPAIN", "SWEDEN", "SWITZERLAND",
            "UKRAINE", "UNITED STATES", "USA", "TEAM EUROPE", "TEAM WORLD"
        }
        return p1.upper() in common_nations or p2.upper() in common_nations

    @staticmethod
    def _parse_kickoff(esd: str) -> datetime:
        """
        Parses LiveScore Esd timestamp string (YYYYMMDDHHMMSS) to UTC datetime.
        """
        if len(esd) >= 12:
            try:
                year = int(esd[:4])
                month = int(esd[4:6])
                day = int(esd[6:8])
                hour = int(esd[8:10])
                minute = int(esd[10:12])
                second = int(esd[12:14]) if len(esd) >= 14 else 0
                return datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
            except Exception:
                pass
        return datetime.now(timezone.utc)

    @staticmethod
    def _map_status(eps: str) -> str:
        """
        Maps LiveScore Eps match status to standard canonical status.
        """
        e = eps.upper()
        if e in ("NS", "NOT STARTED"):
            return "scheduled"
        if e in ("FT", "AOT", "AFTER OT"):
            return "finished"
        if "RET" in e:
            return "retired"
        if "W/O" in e or "WO" in e:
            return "walkover"
        if "POSTP" in e:
            return "postponed"
        if "CANC" in e:
            return "cancelled"
        # In-play statuses
        return "live"

    def close(self):
        """
        Closes underlying HTTP client session.
        """
        try:
            self.client.close()
        except Exception:
            pass
