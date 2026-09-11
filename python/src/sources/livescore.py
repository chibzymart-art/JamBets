"""
JamBets — LiveScore Verified Data Source Adapter
Queries LiveScore public match feeds for multi-source validation.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Optional
import httpx
from python.src.config import LeagueConfig
from python.src.football.models import RawFixturePayload, FixtureStatus
from python.src.sources.base import BaseSourceAdapter


class LiveScoreAdapter(BaseSourceAdapter):
    def __init__(self):
        super().__init__(
            name="LiveScore",
            slug="livescore",
            base_url="https://prod-public-api.livescore.com/v1/api/app/date/soccer",
            rate_limit_delay_seconds=2.0,
            max_retries=3
        )
        self._date_cache: dict = {}

    LIVESCORE_STAGE_ALIASES = {
        "ENG_PL": ["premier-league"],
        "ENG_PL2": ["premier-league-2"],
        "ENG_PL_U18": ["premier-league-u18"],
        "ENG_CH": ["championship"],
        "ENG_L1": ["league-1", "league-one"],
        "ENG_L2": ["league-2", "league-two"],
        "ENG_NL": ["national-league"],
        "ENG_NL_N": ["national-league-north"],
        "ENG_NL_S": ["national-league-south"],
        "ENG_NPL": ["northern-premier-division", "northern-premier-league", "northern-premier-league-east-division", "northern-premier-league-midlands-division", "northern-premier-league-west-division"],
        "ENG_ILP": ["isthmian-league", "isthmian-league-north-division", "isthmian-league-south-central-division", "isthmian-league-south-east-division"],
        "ENG_SLP": ["southern-premier-division-south", "southern-premier-division-central", "southern-league-central-division"],
        "ENG_WSL": ["fa-women-s-super-league"],
        "ENG_EFL_CUP": ["efl-cup-round-3-2025-2026", "efl-cup", "carabao-cup"],
        "ESP_LL": ["laliga"],
        "ESP_LL2": ["laliga-2"],
        "ITA_SA": ["serie-a"],
        "ITA_SB": ["serie-b"],
        "GER_BL": ["bundesliga"],
        "GER_2BL": ["2-bundesliga"],
        "GER_3L": ["3-liga"],
        "FRA_L1": ["ligue-1"],
        "FRA_L2": ["ligue-2"],
        "SCO_PL": ["premiership", "scotland-premiership"],
        "SCO_CH": ["championship"],
        "NED_ED": ["eredivisie"],
        "NED_EED": ["eerste-divisie"],
        "USA_USLC": ["usl-championship"],
        "USA_MLSN": ["mls-next-pro"],
        "POR_PL": ["primeira-liga"],
        "POR_L2": ["segunda-liga", "liga-portugal-2"],
        "BEL_PL": ["belgian-pro-league-2025", "pro-league", "belgian-pro-league"],
        "TUR_SL": ["super-lig"],
        "SUI_SL": ["super-league"],
        "AUT_BL": ["bundesliga"],
        "DEN_SL": ["superliga"],
        "SWE_AL": ["allsvenskan"],
        "NOR_EL": ["eliteserien"],
        "GRE_SL": ["super-league"],
        "USA_MLS": ["major-league-soccer-2026", "mls"],
        "BRA_SA": ["serie-a"],
        "ARG_PD": ["liga-profesional-clausura", "primera-division"],
        "MEX_LMX": ["liga-mx-apertura", "liga-mx-clausura", "liga-mx"],
        "SAU_SPL": ["saudi-professional-league", "pro-league"],
        "JPN_J1": ["j-league-2025", "j1-league"]
    }

    def _map_livescore_status(self, eps: str) -> FixtureStatus:
        eps_clean = eps.strip().replace("'", "")
        status_map = {
            "NS": FixtureStatus.SCHEDULED,
            "1H": FixtureStatus.LIVE,
            "2H": FixtureStatus.LIVE,
            "HT": FixtureStatus.LIVE,
            "ET": FixtureStatus.LIVE,
            "P": FixtureStatus.LIVE,
            "FT": FixtureStatus.FINISHED,
            "AET": FixtureStatus.FINISHED,
            "AP": FixtureStatus.FINISHED,
            "Postp.": FixtureStatus.POSTPONED,
            "Canc.": FixtureStatus.CANCELLED,
            "Susp.": FixtureStatus.SUSPENDED,
            "Int.": FixtureStatus.INTERRUPTED
        }
        if eps in status_map:
            return status_map[eps]
        # Any numeric elapsed minute (e.g. "35", "45+2", "78'", "90+3") indicates active play
        first_token = eps_clean.split("+")[0].strip()
        if first_token.isdigit():
            return FixtureStatus.LIVE
        return FixtureStatus.SCHEDULED

    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        """Queries LiveScore by date and filters for matching league stages."""
        results: List[RawFixturePayload] = []
        now_utc = datetime.now(timezone.utc)

        current_day = date_from.date()
        end_day = date_to.date()

        while current_day <= end_day:
            date_str = current_day.strftime("%Y%m%d")
            url = f"{self.base_url}/{date_str}/0.00?MD=1"

            if date_str in self._date_cache:
                data = self._date_cache[date_str]
            else:
                data = self.get_json_with_retry(url)
                if data:
                    self._date_cache[date_str] = data
            if data:
                stages = data.get("Stages", [])
                for stage in stages:
                    stage_country = (stage.get("Cnm") or "").lower().replace(" ", "-")
                    stage_name = (stage.get("Snm") or "").lower().replace(" ", "-")
                    stage_code = (stage.get("Scd") or "").lower().replace(" ", "-")

                    # Strict country & stage validation to prevent cross-country & cross-tier misclassification
                    # Both country AND stage must match precisely (no substring containment that leaks lower leagues)
                    country_matches = (
                        stage_country == league.livescore_country or
                        stage_country == league.country.lower().replace(" ", "-")
                    )
                    allowed_stages = self.LIVESCORE_STAGE_ALIASES.get(league.code, [league.livescore_stage])
                    stage_matches = (
                        stage_code in allowed_stages or
                        stage_name in allowed_stages
                    )
                    if not (country_matches and stage_matches):
                        continue

                    events = stage.get("Events", [])
                    for ev in events:
                        event_id = str(ev.get("Eid"))
                        t1 = ev.get("T1", [{}])[0].get("Nm")
                        t2 = ev.get("T2", [{}])[0].get("Nm")
                        if not t1 or not t2:
                            continue

                        # Parse Esd timestamp (e.g. 20260908140000)
                        esd_str = str(ev.get("Esd", ""))
                        try:
                            kickoff_dt = datetime.strptime(esd_str, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                        except Exception:
                            continue

                        eps = str(ev.get("Eps", "NS"))
                        canonical_status = self._map_livescore_status(eps)

                        home_score = None
                        away_score = None
                        ht_home = None
                        ht_away = None
                        if canonical_status in (FixtureStatus.LIVE, FixtureStatus.FINISHED):
                            try:
                                if ev.get("Tr1") is not None:
                                    home_score = int(ev.get("Tr1"))
                                if ev.get("Tr2") is not None:
                                    away_score = int(ev.get("Tr2"))
                            except (ValueError, TypeError):
                                pass
                            try:
                                if ev.get("Trh1") is not None:
                                    ht_home = int(ev.get("Trh1"))
                                if ev.get("Trh2") is not None:
                                    ht_away = int(ev.get("Trh2"))
                            except (ValueError, TypeError):
                                pass

                        minute = None
                        if eps.isdigit():
                            minute = int(eps)
                        elif "'" in eps:
                            try:
                                minute = int(eps.replace("'", "").split("+")[0].strip())
                            except Exception:
                                pass

                        period = None
                        if eps == "HT":
                            period = "HT"
                        elif canonical_status == FixtureStatus.FINISHED:
                            period = "FT"
                        elif canonical_status == FixtureStatus.LIVE:
                            period = "2H" if (minute and minute > 45) else "1H"

                        raw_meta = {
                            "livescore_eps": eps,
                            "stage": stage.get("Snm"),
                            "minute": minute,
                            "period": period,
                            "half_time_home_score": ht_home,
                            "half_time_away_score": ht_away,
                        }

                        payload = RawFixturePayload(
                            source_name=self.name,
                            provider_event_id=event_id,
                            league_code=league.code,
                            season=str(current_day.year),
                            home_team_raw=t1,
                            away_team_raw=t2,
                            kickoff_time=kickoff_dt,
                            status=canonical_status,
                            home_score=home_score,
                            away_score=away_score,
                            raw_metadata=raw_meta
                        )
                        results.append(payload)

            current_day += timedelta(days=1)

        return results

    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        today = datetime.now(timezone.utc)
        fixtures = self.fetch_fixtures(league, today, today)
        return [f for f in fixtures if f.status == FixtureStatus.LIVE]
