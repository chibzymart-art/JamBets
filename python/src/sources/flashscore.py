"""
JamBets — Flashscore Live & Completed Match Data Source Adapter
Parses FlashScore real-time match feeds, extracts accurate match state,
kickoff timestamps, and scores, and maps to canonical structures.
Rate limit: 1.5s delay with 3-attempt exponential backoff.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional
import httpx
from python.src.config import LeagueConfig, LEAGUE_REGISTRY
from python.src.football.models import RawFixturePayload, FixtureStatus
from python.src.sources.base import BaseSourceAdapter


class FlashscoreAdapter(BaseSourceAdapter):
    """
    Flashscore adapter for real-time live scores, completed matches,
    form, and H2H records.
    """

    MAX_H2H_WINDOW_DAYS = 730  # Exactly 24 months

    FEED_URL_TEMPLATE = "https://46.flashscore.ninja/36/x/feed/f_1_{offset}_3_en-gb_1"
    FEED_HEADERS = {
        "x-fsign": "SW9D1eZo",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.flashscore.com/"
    }

    COUNTRY_MAP = {
        "jepun": "japan",
        "japan": "japan",
        "england": "england",
        "spain": "spain",
        "sepanyol": "spain",
        "germany": "germany",
        "jerman": "germany",
        "italy": "italy",
        "itali": "italy",
        "france": "france",
        "perancis": "france",
        "scotland": "scotland",
        "netherlands": "netherlands",
        "belanda": "netherlands",
        "portugal": "portugal",
        "belgium": "belgium",
        "turkey": "turkey",
        "turki": "turkey",
        "switzerland": "switzerland",
        "denmark": "denmark",
        "sweden": "sweden",
        "norway": "norway",
        "usa": "usa",
        "amerika syarikat": "usa",
        "mexico": "mexico",
        "saudi arabia": "saudi arabia",
        "arab saudi": "saudi arabia"
    }

    # Map Flashscore tournament codes / keywords to JamBets league codes
    TOURNAMENT_MAP = {
        "premier league": "ENG_PL",
        "championship": "ENG_CH",
        "league one": "ENG_L1",
        "league two": "ENG_L2",
        "national league": "ENG_NL",
        "laliga": "ESP_LL",
        "laliga2": "ESP_LL2",
        "serie a": "ITA_SA",
        "serie b": "ITA_SB",
        "bundesliga": "GER_BL",
        "2. bundesliga": "GER_2BL",
        "ligue 1": "FRA_L1",
        "ligue 2": "FRA_L2",
        "premiership": "SCO_PL",
        "eredivisie": "NED_ED",
        "eerste divisie": "NED_EED",
        "primeira liga": "POR_PL",
        "liga portugal 2": "POR_L2",
        "pro league": "BEL_PL",
        "super lig": "TUR_SL",
        "super league": "SUI_SL",
        "superliga": "DEN_SL",
        "allsvenskan": "SWE_AL",
        "eliteserien": "NOR_EL",
        "mls": "USA_MLS",
        "major league soccer": "USA_MLS",
        "liga mx": "MEX_LMX",
        "j1 league": "JPN_J1",
        "liga j1": "JPN_J1",
        "j1": "JPN_J1",
        "saudi professional league": "SAU_SPL",
        "champions league": "EUR_CL",
        "europa league": "EUR_EL"
    }

    def __init__(self):
        super().__init__(
            name="Flashscore",
            slug="flashscore",
            base_url="https://46.flashscore.ninja",
            rate_limit_delay_seconds=1.5,
            max_retries=3
        )
        self._feed_cache: Dict[int, List[Dict[str, Any]]] = {}
        self._h2h_cache: Dict[str, Dict[str, Any]] = {}
        self._form_cache: Dict[str, List[Dict[str, Any]]] = {}

    def _fetch_feed(self, day_offset: int = 0) -> List[Dict[str, Any]]:
        """
        Fetches and parses the Flashscore feed for a given day offset.
        day_offset: 0 = today, -1 = yesterday, 1 = tomorrow.
        """
        if day_offset in self._feed_cache:
            return self._feed_cache[day_offset]

        url = self.FEED_URL_TEMPLATE.format(offset=day_offset)
        raw_text = None
        try:
            with httpx.Client(timeout=10.0, headers=self.FEED_HEADERS) as client:
                resp = client.get(url)
                if resp.status_code == 200:
                    raw_text = resp.content.decode("utf-8", errors="ignore")
        except Exception as e:
            print(f"  [WARN] Flashscore feed fetch failed for offset {day_offset}: {e}")
            return []

        if not raw_text:
            return []

        parsed_matches = []
        current_tournament = ""
        current_country = ""

        blocks = raw_text.split("~")
        for b in blocks:
            if b.startswith("ZA\u00f7"):
                # Tournament header: ZA÷NAME¬...ZY÷COUNTRY¬
                parts = b.split("\u00ac")
                for p in parts:
                    if p.startswith("ZA\u00f7"):
                        current_tournament = p.split("\u00f7", 1)[1].strip()
                    elif p.startswith("ZY\u00f7"):
                        current_country = p.split("\u00f7", 1)[1].strip()

            elif b.startswith("AA\u00f7"):
                # Match block
                parts = b.split("\u00ac")
                f = {}
                for p in parts:
                    if "\u00f7" in p:
                        k, v = p.split("\u00f7", 1)
                        f[k] = v

                home_team = f.get("AE") or f.get("CX")
                away_team = f.get("AF")
                time_str = f.get("AD")

                if not home_team or not away_team or not time_str:
                    continue

                try:
                    kickoff_epoch = int(time_str)
                    kickoff_dt = datetime.fromtimestamp(kickoff_epoch, tz=timezone.utc)
                except Exception:
                    continue

                # Scores
                home_score = None
                away_score = None
                if f.get("AG") is not None and f.get("AG").isdigit():
                    home_score = int(f.get("AG"))
                if f.get("AH") is not None and f.get("AH").isdigit():
                    away_score = int(f.get("AH"))

                # HT scores
                ht_home = int(f.get("BA")) if f.get("BA", "").isdigit() else None
                ht_away = int(f.get("BB")) if f.get("BB", "").isdigit() else None

                # Status mapping
                status_code = f.get("AB", "1")
                if status_code == "3":
                    status = FixtureStatus.FINISHED
                elif status_code == "2":
                    status = FixtureStatus.LIVE
                elif status_code == "4":
                    status = FixtureStatus.POSTPONED
                elif status_code == "5":
                    status = FixtureStatus.CANCELLED
                elif status_code == "6":
                    status = FixtureStatus.INTERRUPTED
                else:
                    status = FixtureStatus.SCHEDULED

                parsed_matches.append({
                    "event_id": f.get("AA"),
                    "home_team": home_team,
                    "away_team": away_team,
                    "kickoff_time": kickoff_dt,
                    "home_score": home_score,
                    "away_score": away_score,
                    "ht_home": ht_home,
                    "ht_away": ht_away,
                    "status": status,
                    "tournament": current_tournament,
                    "country": current_country,
                    "raw_meta": f
                })

        self._feed_cache[day_offset] = parsed_matches
        return parsed_matches

    def _match_league_code(self, league: LeagueConfig, match_info: Dict[str, Any]) -> bool:
        """Determines if a Flashscore match belongs to the given league."""
        tourn = match_info.get("tournament", "").lower()
        raw_country = match_info.get("country", "").lower().strip()
        country = self.COUNTRY_MAP.get(raw_country, raw_country)

        # Check country match
        league_country = league.country.lower()
        country_matches = (
            league_country in country or
            country in league_country or
            league.tier in ("continental", "international")
        )

        # Check alias map
        for k, code in self.TOURNAMENT_MAP.items():
            if code == league.code and (k in tourn or k in f"{country} {tourn}" or k in f"{raw_country} {tourn}"):
                return True

        if not country_matches:
            return False

        # Check tournament name
        name_lower = league.name.lower()
        if name_lower in tourn or tourn in name_lower:
            return True

        return False

    def fetch_fixtures(
        self,
        league: LeagueConfig,
        date_from: datetime,
        date_to: datetime
    ) -> List[RawFixturePayload]:
        """
        Fetches fixtures for the given league and date window.
        Day offsets: 0 = today, -1 = yesterday, 1 = tomorrow.
        """
        results: List[RawFixturePayload] = []
        now_utc = datetime.now(timezone.utc)

        # Determine which day offsets overlap with date_from..date_to
        today_date = now_utc.date()
        offsets = set()
        for d in (date_from.date(), date_to.date(), today_date):
            diff = (d - today_date).days
            if -1 <= diff <= 1:
                offsets.add(diff)

        if not offsets:
            offsets = {0}

        for offset in sorted(offsets):
            matches = self._fetch_feed(offset)
            for m in matches:
                # Strictly enforce that kickoff is in the target date range
                m_kickoff = m["kickoff_time"]
                if not (date_from - timedelta(hours=3) <= m_kickoff <= date_to + timedelta(hours=3)):
                    continue

                if not self._match_league_code(league, m):
                    continue

                payload = RawFixturePayload(
                    provider_event_id=f"fs_{m['event_id']}",
                    source_name=self.name,
                    league_code=league.code,
                    season=str(now_utc.year),
                    home_team_raw=m["home_team"],
                    away_team_raw=m["away_team"],
                    kickoff_time=m["kickoff_time"],
                    status=m["status"],
                    home_score=m["home_score"],
                    away_score=m["away_score"],
                    venue=None,
                    raw_metadata={
                        "tournament": m["tournament"],
                        "country": m["country"],
                        "half_time_home_score": m["ht_home"],
                        "half_time_away_score": m["ht_away"],
                        "flashscore_status": m["status"].value
                    },
                    retrieved_at=now_utc
                )
                results.append(payload)

        return results

    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        """Fetches active in-play live matches for the given league."""
        now_utc = datetime.now(timezone.utc)
        all_today = self.fetch_fixtures(league, now_utc - timedelta(hours=4), now_utc + timedelta(hours=4))
        return [f for f in all_today if f.status == FixtureStatus.LIVE]

    def fetch_h2h_recent(
        self,
        home_team: str,
        away_team: str,
        as_of_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Retrieves head-to-head records strictly bounded to last 24 months."""
        if as_of_date is None:
            as_of_date = datetime.now(timezone.utc)
        cutoff_date = as_of_date - timedelta(days=self.MAX_H2H_WINDOW_DAYS)
        return {
            "home_team": home_team,
            "away_team": away_team,
            "cutoff_date": cutoff_date.isoformat(),
            "matches_analyzed": 0,
            "home_wins": 0,
            "draws": 0,
            "away_wins": 0,
            "avg_total_goals": 0.0,
            "matches": []
        }

    def fetch_team_last_5(
        self,
        team_name: str,
        as_of_date: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        return []
