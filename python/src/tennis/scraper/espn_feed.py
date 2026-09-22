"""
Oddsbanta — Autonomous Live Tennis Scraper (ESPN Feed Adapter)
Phase 2: Independent Dynamic Live Tennis Scraper Daemon

Ingests live ATP, WTA, and Grand Slam data dynamically:
- Scoreboard events, match fixtures, and tournament groupings
- Live in-play and final set/game scores
- Official player rankings, points, and demographics

Invariant: Completely independent from football scrapers. Zero shared code or state.
"""

import re
import logging
import httpx
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from .base import BaseTennisScraper

logger = logging.getLogger("tennis.scraper.espn")


class EspnTennisFeedScraper(BaseTennisScraper):
    """
    High-availability, zero-auth live feed scraper for ATP and WTA tennis.
    """

    BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/tennis"

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout
        self.client = httpx.Client(timeout=self.timeout)

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
        Fetches official current rankings for ATP or WTA.
        """
        tour_slug = tour.lower().strip()
        url = f"{self.BASE_URL}/{tour_slug}/rankings"
        try:
            resp = self.client.get(url)
            resp.raise_for_status()
            data = resp.json()
            rankings_group = data.get("rankings", [])
            if not rankings_group:
                return []

            ranks = rankings_group[0].get("ranks", [])
            results = []
            for rk in ranks:
                athlete = rk.get("athlete", {})
                display_name = athlete.get("displayName")
                if not display_name:
                    continue

                canonical = self.slugify(display_name)
                country = athlete.get("citizenshipCountry") or athlete.get("flagAltText")
                points = rk.get("points")
                current_rank = rk.get("current")

                results.append({
                    "canonical_name": canonical,
                    "display_name": display_name,
                    "current_rank": int(current_rank) if current_rank else None,
                    "points": float(points) if points is not None else None,
                    "country": str(country) if country else None,
                    "age": athlete.get("age"),
                    "headshot_url": athlete.get("headshot"),
                    "tour": tour.upper()
                })

            logger.info("Successfully fetched %d %s rankings", len(results), tour.upper())
            return results
        except Exception as e:
            logger.error("Error fetching %s rankings: %s", tour, e)
            return []

    def fetch_scoreboard(self, tour: str = "atp", date_str: Optional[str] = None) -> Dict[str, Any]:
        """
        Fetches live scoreboard with tournament events and match groupings.
        date_str format: YYYYMMDD (optional)
        """
        tour_slug = tour.lower().strip()
        url = f"{self.BASE_URL}/{tour_slug}/scoreboard"
        params = {}
        if date_str:
            params["dates"] = date_str

        try:
            resp = self.client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error("Error fetching %s scoreboard (dates=%s): %s", tour, date_str, e)
            return {}

    def parse_fixtures_from_scoreboard(
        self,
        raw_data: Dict[str, Any],
        tour: str = "atp",
        min_kickoff: Optional[datetime] = None,
        max_kickoff: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """
        Extracts and normalizes singles matches from ESPN scoreboard JSON.
        Optionally filters matches to [min_kickoff, max_kickoff] window and discards past concluded matches.
        """
        fixtures = []
        events = raw_data.get("events", [])

        for ev in events:
            raw_t_name = ev.get("name", "Unknown Tournament")
            raw_t_id = ev.get("id")
            venue_obj = ev.get("venue") or {}
            venue_name = venue_obj.get("fullName")
            groupings = ev.get("groupings", [])

            for g in groupings:
                competitions = g.get("competitions", [])
                for comp in competitions:
                    comp_type = comp.get("type", {})
                    type_slug = comp_type.get("slug", "").lower()
                    type_text = comp_type.get("text", "").lower()

                    # Only ingest Singles matches for prediction engine precision
                    if "doubles" in type_slug or "doubles" in type_text:
                        continue

                    competitors = comp.get("competitors", [])
                    if len(competitors) < 2:
                        continue

                    # In ESPN's tennis JSON API, competitors array uses US convention ("Away @ Home"):
                    # competitors[0] is typically 'away' (order: 2), and competitors[1] is 'home' (order: 1).
                    # We explicitly resolve Home (Order 1 / Top of bracket) as Player 1, and Away (Order 2 / Challenger) as Player 2.
                    c_home = next((c for c in competitors if c.get("homeAway") == "home" or c.get("order") == 1), None)
                    c_away = next((c for c in competitors if c.get("homeAway") == "away" or c.get("order") == 2), None)
                    if not c_home or not c_away:
                        c_away = competitors[0]
                        c_home = competitors[1] if len(competitors) > 1 else competitors[0]

                    c1 = c_home  # Player 1 = Home (Seed 1 / Top of Draw)
                    c2 = c_away  # Player 2 = Away (Order 2 / Challenger)
                    p1_name = c1.get("athlete", {}).get("displayName")
                    p2_name = c2.get("athlete", {}).get("displayName")

                    if not p1_name or not p2_name or p1_name == "TBD" or p2_name == "TBD":
                        continue

                    p1_canonical = self.slugify(p1_name)
                    p2_canonical = self.slugify(p2_name)

                    # Round Mapping
                    round_info = comp.get("round", {}).get("displayName", "Round of 32")
                    round_code = self._map_round_code(round_info)

                    # Kickoff Time
                    kickoff_raw = comp.get("date") or comp.get("startDate") or ev.get("date")
                    try:
                        kickoff_dt = datetime.fromisoformat(kickoff_raw.replace("Z", "+00:00"))
                        kickoff_iso = kickoff_dt.isoformat()
                    except Exception:
                        kickoff_dt = datetime.now(timezone.utc)
                        kickoff_iso = kickoff_dt.isoformat()

                    # Match Status Mapping
                    status_obj = comp.get("status", {})
                    status_type = status_obj.get("type", {})
                    raw_status_name = status_type.get("name", "STATUS_SCHEDULED")
                    is_completed = status_type.get("completed", False)
                    desc = (status_type.get("description") or "").lower()
                    detail = (status_type.get("detail") or "").lower()

                    status = "scheduled"
                    was_retired = "retir" in desc or "retir" in detail or "ret." in detail
                    was_walkover = "walkover" in desc or "walkover" in detail or "w/o" in detail

                    if was_retired:
                        status = "retired"
                    elif was_walkover:
                        status = "walkover"
                    elif is_completed or raw_status_name == "STATUS_FINAL":
                        status = "finished"
                    elif raw_status_name in ("STATUS_IN_PROGRESS", "STATUS_LIVE"):
                        status = "live"
                    elif raw_status_name in ("STATUS_POSTPONED", "STATUS_SUSPENDED"):
                        status = "postponed"
                    elif raw_status_name == "STATUS_CANCELED":
                        status = "cancelled"

                    # STRICT TEMPORAL FILTERING:
                    # Oddsbanta is a prediction website that must NEVER ingest past concluded fixtures.
                    if min_kickoff is not None:
                        # Drop past finished/settled/retired/cancelled matches
                        if status in ("finished", "retired", "walkover", "cancelled"):
                            continue
                        # If kickoff has passed and match is not currently live in-play, discard
                        if kickoff_dt < min_kickoff and status != "live":
                            continue

                    if max_kickoff is not None:
                        # Drop fixtures scheduled beyond the approved horizon (e.g. > 3 days)
                        if kickoff_dt > max_kickoff:
                            continue

                    # Score extraction
                    lines_p1 = [int(float(l.get("value", 0))) for l in c1.get("linescores", []) if l.get("value") is not None]
                    lines_p2 = [int(float(l.get("value", 0))) for l in c2.get("linescores", []) if l.get("value") is not None]

                    set_scores = []
                    for i in range(min(len(lines_p1), len(lines_p2))):
                        set_scores.append(f"{lines_p1[i]}-{lines_p2[i]}")

                    # Count sets won
                    p1_sets = sum(1 for i in range(min(len(lines_p1), len(lines_p2))) if lines_p1[i] > lines_p2[i])
                    p2_sets = sum(1 for i in range(min(len(lines_p1), len(lines_p2))) if lines_p2[i] > lines_p1[i])

                    # Winner identification
                    winner_canonical = None
                    if c1.get("winner") is True:
                        winner_canonical = p1_canonical
                    elif c2.get("winner") is True:
                        winner_canonical = p2_canonical
                    elif is_completed:
                        if p1_sets > p2_sets:
                            winner_canonical = p1_canonical
                        elif p2_sets > p1_sets:
                            winner_canonical = p2_canonical

                    # Deterministic canonical key: TOUR:TOURNAMENT:P1-P2:DATE
                    date_key = kickoff_raw[:10].replace("-", "") if kickoff_raw else "TBD"
                    t_slug = self.slugify(raw_t_name)
                    canonical_key = f"{tour.upper()}:{t_slug}:{p1_canonical}-{p2_canonical}:{date_key}"

                    best_of_sets = 5 if ("wimbledon" in t_slug or "us_open" in t_slug or "roland_garros" in t_slug or "australian_open" in t_slug) and tour.lower() == "atp" else 3

                    comp_id = str(comp.get("id")) if comp.get("id") else None

                    fixtures.append({
                        "espn_competition_id": comp_id,
                        "canonical_key": canonical_key,
                        "raw_tournament_name": raw_t_name,
                        "raw_tournament_id": raw_t_id,
                        "venue_name": venue_name,
                        "tour": tour.upper(),
                        "round": round_code,
                        "best_of_sets": best_of_sets,
                        "target_kickoff_at": kickoff_iso,
                        "status": status,
                        "player1": {
                            "canonical_name": p1_canonical,
                            "display_name": p1_name,
                            "country": c1.get("athlete", {}).get("flag", {}).get("alt")
                        },
                        "player2": {
                            "canonical_name": p2_canonical,
                            "display_name": p2_name,
                            "country": c2.get("athlete", {}).get("flag", {}).get("alt")
                        },
                        "score_p1_sets": p1_sets,
                        "score_p2_sets": p2_sets,
                        "set_scores": set_scores,
                        "winner_canonical": winner_canonical,
                        "was_retired": was_retired,
                        "was_walkover": was_walkover
                    })

        logger.info("Parsed %d singles fixtures for %s", len(fixtures), tour.upper())
        return fixtures

    @staticmethod
    def _map_round_code(round_name: str) -> str:
        """
        Maps verbose round descriptions to canonical standard database codes.
        """
        r = round_name.lower().strip()
        if "qualifying" in r or "qual" in r:
            return "QUAL"
        elif "final" in r and "semi" not in r and "quarter" not in r:
            return "F"
        elif "semifinal" in r or "semi-final" in r:
            return "SF"
        elif "quarterfinal" in r or "quarter-final" in r:
            return "QF"
        elif "round of 16" in r or "4th round" in r:
            return "R16"
        elif "round of 32" in r or "3rd round" in r:
            return "R32"
        elif "round of 64" in r or "2nd round" in r:
            return "R64"
        elif "round of 128" in r or "1st round" in r:
            return "R128"
        return "R32"

    def parse_settlement_results_from_scoreboard(
        self,
        raw_data: Dict[str, Any],
        tour: str = "atp"
    ) -> List[Dict[str, Any]]:
        """
        Parses all singles matches from ESPN scoreboard JSON for settlement inspection.
        Unlike fixture ingestion, this preserves completed ('finished', 'retired', 'walkover')
        and 'live' matches along with their full line scores, game totals, and competition IDs.
        """
        results = []
        events = raw_data.get("events", [])

        for ev in events:
            raw_t_name = ev.get("name", "Unknown Tournament")
            t_slug = self.slugify(raw_t_name)
            venue_obj = ev.get("venue") or {}
            venue_name = venue_obj.get("fullName")
            groupings = ev.get("groupings", [])

            for g in groupings:
                competitions = g.get("competitions", [])
                for comp in competitions:
                    comp_type = comp.get("type", {})
                    type_slug = comp_type.get("slug", "").lower()
                    type_text = comp_type.get("text", "").lower()

                    # Only Singles matches
                    if "doubles" in type_slug or "doubles" in type_text:
                        continue

                    competitors = comp.get("competitors", [])
                    if len(competitors) < 2:
                        continue

                    c_home = next((c for c in competitors if c.get("homeAway") == "home" or c.get("order") == 1), None)
                    c_away = next((c for c in competitors if c.get("homeAway") == "away" or c.get("order") == 2), None)
                    if not c_home or not c_away:
                        c_away = competitors[0]
                        c_home = competitors[1] if len(competitors) > 1 else competitors[0]

                    c1 = c_home  # Player 1 = Home (Seed 1 / Top of Draw)
                    c2 = c_away  # Player 2 = Away (Order 2 / Challenger)
                    p1_name = c1.get("athlete", {}).get("displayName")
                    p2_name = c2.get("athlete", {}).get("displayName")

                    if not p1_name or not p2_name or p1_name == "TBD" or p2_name == "TBD":
                        continue

                    p1_canonical = self.slugify(p1_name)
                    p2_canonical = self.slugify(p2_name)
                    comp_id = str(comp.get("id")) if comp.get("id") else None

                    round_info = comp.get("round", {}).get("displayName", "Round of 32")
                    round_code = self._map_round_code(round_info)

                    kickoff_raw = comp.get("date") or comp.get("startDate") or ev.get("date")
                    try:
                        kickoff_dt = datetime.fromisoformat(kickoff_raw.replace("Z", "+00:00"))
                        kickoff_iso = kickoff_dt.isoformat()
                    except Exception:
                        kickoff_dt = datetime.now(timezone.utc)
                        kickoff_iso = kickoff_dt.isoformat()

                    status_obj = comp.get("status", {})
                    status_type = status_obj.get("type", {})
                    raw_status_name = status_type.get("name", "STATUS_SCHEDULED")
                    is_completed = status_type.get("completed", False)
                    desc = (status_type.get("description") or "").lower()
                    detail = (status_type.get("detail") or "").lower()

                    status = "scheduled"
                    was_retired = "retir" in desc or "retir" in detail or "ret." in detail
                    was_walkover = "walkover" in desc or "walkover" in detail or "w/o" in detail

                    if was_retired:
                        status = "retired"
                    elif was_walkover:
                        status = "walkover"
                    elif is_completed or raw_status_name == "STATUS_FINAL":
                        status = "finished"
                    elif raw_status_name in ("STATUS_IN_PROGRESS", "STATUS_LIVE"):
                        status = "live"
                    elif raw_status_name in ("STATUS_POSTPONED", "STATUS_SUSPENDED"):
                        status = "postponed"
                    elif raw_status_name == "STATUS_CANCELED":
                        status = "cancelled"

                    # Score extraction
                    lines_p1 = [int(float(l.get("value", 0))) for l in c1.get("linescores", []) if l.get("value") is not None]
                    lines_p2 = [int(float(l.get("value", 0))) for l in c2.get("linescores", []) if l.get("value") is not None]

                    set_scores = []
                    for i in range(min(len(lines_p1), len(lines_p2))):
                        set_scores.append(f"{lines_p1[i]}-{lines_p2[i]}")

                    p1_sets = sum(1 for i in range(min(len(lines_p1), len(lines_p2))) if lines_p1[i] > lines_p2[i])
                    p2_sets = sum(1 for i in range(min(len(lines_p1), len(lines_p2))) if lines_p2[i] > lines_p1[i])

                    winner_canonical = None
                    if c1.get("winner") is True:
                        winner_canonical = p1_canonical
                    elif c2.get("winner") is True:
                        winner_canonical = p2_canonical
                    elif is_completed:
                        if p1_sets > p2_sets:
                            winner_canonical = p1_canonical
                        elif p2_sets > p1_sets:
                            winner_canonical = p2_canonical

                    retired_player_canonical = None
                    if was_retired:
                        if winner_canonical == p1_canonical:
                            retired_player_canonical = p2_canonical
                        elif winner_canonical == p2_canonical:
                            retired_player_canonical = p1_canonical

                    best_of_sets = 5 if ("wimbledon" in t_slug or "us_open" in t_slug or "roland_garros" in t_slug or "australian_open" in t_slug) and tour.lower() == "atp" else 3

                    results.append({
                        "espn_competition_id": comp_id,
                        "raw_tournament_name": raw_t_name,
                        "tournament_slug": t_slug,
                        "venue_name": venue_name,
                        "tour": tour.upper(),
                        "round": round_code,
                        "best_of_sets": best_of_sets,
                        "target_kickoff_at": kickoff_iso,
                        "status": status,
                        "player1": {
                            "canonical_name": p1_canonical,
                            "display_name": p1_name,
                            "country": c1.get("athlete", {}).get("flag", {}).get("alt")
                        },
                        "player2": {
                            "canonical_name": p2_canonical,
                            "display_name": p2_name,
                            "country": c2.get("athlete", {}).get("flag", {}).get("alt")
                        },
                        "score_p1_sets": p1_sets,
                        "score_p2_sets": p2_sets,
                        "set_scores": set_scores,
                        "winner_canonical": winner_canonical,
                        "retired_player_canonical": retired_player_canonical,
                        "was_retired": was_retired,
                        "was_walkover": was_walkover
                    })

        logger.info("Parsed %d singles match results for settlement from %s", len(results), tour.upper())
        return results

    def close(self):
        self.client.close()


class TennisFixtureMatcher:
    """
    High-precision multi-factor matcher between Supabase tennis_fixtures and ESPN competitions.
    Enforces strict temporal guardrails and identity bounds to prevent false settlements.
    """

    @staticmethod
    def _parse_dt(dt_val: Any) -> Optional[datetime]:
        if not dt_val:
            return None
        if isinstance(dt_val, datetime):
            return dt_val.astimezone(timezone.utc) if dt_val.tzinfo else dt_val.replace(tzinfo=timezone.utc)
        try:
            clean = str(dt_val).replace("Z", "+00:00")
            dt = datetime.fromisoformat(clean)
            return dt.astimezone(timezone.utc) if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            return None

    @classmethod
    def match(
        cls,
        fixture: Dict[str, Any],
        comp: Dict[str, Any],
        max_kickoff_diff_hours: float = 6.0
    ) -> bool:
        """
        Determines if an ESPN competition corresponds to a given database fixture.
        Must satisfy:
        1. Exact ESPN competition ID if stored in fixture.metadata
        OR
        2. Both player canonical names match exactly (either order),
           AND Tour matches (e.g. WTA == WTA, ATP == ATP),
           AND Kickoff datetime matches within strict tolerance (within same UTC calendar day or <= max_kickoff_diff_hours)
           AND Tournament slug / name matches if available.
        """
        # 1. Exact ID match (Primary)
        f_meta = fixture.get("metadata") or {}
        f_espn_id = f_meta.get("espn_competition_id")
        c_espn_id = comp.get("espn_competition_id")
        if f_espn_id and c_espn_id and str(f_espn_id).strip() == str(c_espn_id).strip():
            return True

        # 2. Tour Check
        f_tour = str(fixture.get("tour") or (fixture.get("tournament") or {}).get("tour") or "").upper().strip()
        if not f_tour and fixture.get("canonical_key"):
            f_tour = fixture["canonical_key"].split(":")[0].upper()
        c_tour = str(comp.get("tour") or "").upper().strip()
        if f_tour and c_tour and f_tour != c_tour:
            return False

        # 3. Player Canonical Identity Check
        f_p1 = (fixture.get("player1") or {}).get("canonical_name", "")
        f_p2 = (fixture.get("player2") or {}).get("canonical_name", "")
        if not f_p1 or not f_p2:
            key_parts = fixture.get("canonical_key", "").split(":")
            if len(key_parts) >= 3 and "-" in key_parts[2]:
                pair = key_parts[2].split("-")
                f_p1 = f_p1 or pair[0]
                f_p2 = f_p2 or pair[1]

        c_p1 = (comp.get("player1") or {}).get("canonical_name", "")
        c_p2 = (comp.get("player2") or {}).get("canonical_name", "")

        if not f_p1 or not f_p2 or not c_p1 or not c_p2:
            return False

        # Must be exact match of the pair {p1, p2}
        if {f_p1, f_p2} != {c_p1, c_p2}:
            return False

        # 4. Strict Temporal Guardrail (Same Match Round / Kickoff Proximity)
        f_dt = cls._parse_dt(fixture.get("target_kickoff_at"))
        c_dt = cls._parse_dt(comp.get("target_kickoff_at"))

        if f_dt and c_dt:
            diff_hours = abs((f_dt - c_dt).total_seconds()) / 3600.0
            # If dates differ and time difference exceeds tolerance, reject!
            # Tennis matches can shift by a few hours on the same court/day, but cannot be from different days/rounds.
            if diff_hours > max_kickoff_diff_hours and f_dt.date() != c_dt.date():
                return False
            # Hard limit: even across midnight boundary, never exceed 12 hours difference
            if diff_hours > 12.0:
                return False

        # 5. Tournament match
        f_key = fixture.get("canonical_key") or ""
        c_t_slug = comp.get("tournament_slug") or comp.get("raw_tournament_name") or ""
        if f_key and c_t_slug:
            parts = f_key.split(":")
            if len(parts) >= 2:
                key_t_slug = parts[1]
                clean_c = re.sub(r"[^\w\s]", "", c_t_slug.lower()).replace(" ", "_")
                clean_k = re.sub(r"[^\w\s]", "", key_t_slug.lower()).replace(" ", "_")
                if clean_c != clean_k and clean_c not in clean_k and clean_k not in clean_c:
                    STOP_WORDS = {
                        "open", "tournament", "championships", "championship", "cup",
                        "masters", "classic", "trophy", "international", "de", "the",
                        "atp", "wta", "challenger", "itf"
                    }
                    tokens_c = set(clean_c.split("_")) - STOP_WORDS
                    tokens_k = set(clean_k.split("_")) - STOP_WORDS
                    if tokens_c and tokens_k and not tokens_c.intersection(tokens_k):
                        return False

        return True

    @classmethod
    def align_scores(cls, fixture: Dict[str, Any], comp: Dict[str, Any]) -> Dict[str, Any]:
        """
        Aligns competition set scores, player set totals, winner, and retirement IDs
        to match the orientation of fixture.player1 vs fixture.player2 in Supabase.
        """
        f_p1 = (fixture.get("player1") or {}).get("canonical_name", "")
        if not f_p1 and fixture.get("canonical_key"):
            key_parts = fixture["canonical_key"].split(":")
            if len(key_parts) >= 3 and "-" in key_parts[2]:
                f_p1 = key_parts[2].split("-")[0]

        c_p1 = (comp.get("player1") or {}).get("canonical_name", "")
        is_same_order = (f_p1 == c_p1)

        raw_p1_sets = int(comp.get("score_p1_sets") or 0)
        raw_p2_sets = int(comp.get("score_p2_sets") or 0)
        raw_set_scores = comp.get("set_scores") or []

        if is_same_order:
            aligned_p1_sets = raw_p1_sets
            aligned_p2_sets = raw_p2_sets
            aligned_set_scores = list(raw_set_scores)
        else:
            # Swap scores to orient relative to fixture player 1
            aligned_p1_sets = raw_p2_sets
            aligned_p2_sets = raw_p1_sets
            aligned_set_scores = [cls.swap_set_score(s) for s in raw_set_scores]

        # Resolve winner_id
        winner_id = None
        winner_canonical = comp.get("winner_canonical")
        f_p1_id = fixture.get("player1_id")
        f_p2_id = fixture.get("player2_id")

        if winner_canonical:
            f_p1_canon = (fixture.get("player1") or {}).get("canonical_name") or f_p1
            if winner_canonical == f_p1_canon:
                winner_id = f_p1_id
            else:
                winner_id = f_p2_id
        elif comp.get("status") in ("finished", "retired") and (aligned_p1_sets != aligned_p2_sets):
            winner_id = f_p1_id if aligned_p1_sets > aligned_p2_sets else f_p2_id

        # Resolve retired_player_id
        retired_player_id = None
        if comp.get("was_retired"):
            ret_canonical = comp.get("retired_player_canonical")
            f_p1_canon = (fixture.get("player1") or {}).get("canonical_name") or f_p1
            if ret_canonical:
                if ret_canonical == f_p1_canon:
                    retired_player_id = f_p1_id
                else:
                    retired_player_id = f_p2_id
            elif winner_id:
                # Loser is the retired player
                retired_player_id = f_p2_id if winner_id == f_p1_id else f_p1_id

        return {
            "status": comp.get("status", "finished"),
            "score_p1_sets": aligned_p1_sets,
            "score_p2_sets": aligned_p2_sets,
            "set_scores": aligned_set_scores,
            "winner_id": winner_id,
            "retired_player_id": retired_player_id,
            "was_retired": comp.get("was_retired", False),
            "was_walkover": comp.get("was_walkover", False),
            "espn_competition_id": comp.get("espn_competition_id")
        }

    @staticmethod
    def swap_set_score(s: str) -> str:
        """
        Swaps '6-4' to '4-6', '7-6(5)' to '6-7(5)', etc.
        """
        s_clean = s.strip()
        match = re.match(r"^(\d+)(?:\((\d+)\))?-(\d+)(?:\((\d+)\))?$", s_clean)
        if match:
            g1, tb1, g2, tb2 = match.groups()
            p1_str = f"{g2}" + (f"({tb2})" if tb2 else "")
            p2_str = f"{g1}" + (f"({tb1})" if tb1 else "")
            return f"{p1_str}-{p2_str}"
        parts = s_clean.split("-")
        if len(parts) == 2:
            return f"{parts[1].strip()}-{parts[0].strip()}"
        return s_clean

