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

                    # Player 1 (Order 1 / Home) & Player 2 (Order 2 / Away)
                    c1 = competitors[0]
                    c2 = competitors[1]
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

                    fixtures.append({
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

    def close(self):
        self.client.close()
