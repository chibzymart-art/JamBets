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

    def _map_livescore_status(self, eps: str) -> FixtureStatus:
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
        return status_map.get(eps, FixtureStatus.SCHEDULED)

    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        """Queries LiveScore by date and filters for matching league stages."""
        results: List[RawFixturePayload] = []
        now_utc = datetime.now(timezone.utc)

        current_day = date_from.date()
        end_day = date_to.date()

        while current_day <= end_day:
            date_str = current_day.strftime("%Y%m%d")
            url = f"{self.base_url}/{date_str}/0.00?MD=1"

            data = self.get_json_with_retry(url)
            if data:
                stages = data.get("Stages", [])
                for stage in stages:
                    stage_country = (stage.get("Cnm") or "").lower().replace(" ", "-")
                    stage_name = (stage.get("Snm") or "").lower().replace(" ", "-")

                    # Strict country & stage validation to prevent cross-country misclassification
                    country_matches = (
                        league.livescore_country in stage_country or
                        stage_country in league.livescore_country or
                        league.country.lower() in stage_country
                    )
                    stage_matches = (
                        league.livescore_stage in stage_name or
                        stage_name in league.livescore_stage or
                        league.name.lower() in stage_name.lower()
                    )
                    if league.country.lower() in ("europe", "south america", "international"):
                        is_match = (league.livescore_country in stage_country) or stage_matches
                    else:
                        is_match = country_matches and stage_matches
                    if not is_match:
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
                        if canonical_status in (FixtureStatus.LIVE, FixtureStatus.FINISHED):
                            try:
                                home_score = int(ev.get("Tr1"))
                                away_score = int(ev.get("Tr2"))
                            except (ValueError, TypeError):
                                pass

                        payload = RawFixturePayload(
                            source_name=self.name,
                            provider_event_id=event_id,
                            league_code=league.code,
                            season=str(current_day.year),
                            home_team_raw=t1,
                            away_team_raw=t2,
                            scheduled_kickoff_utc=kickoff_dt,
                            status=canonical_status,
                            raw_payload={"livescore_eps": eps, "stage": stage.get("Snm")}
                        )
                        results.append(payload)

            current_day += timedelta(days=1)

        return results

    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        today = datetime.now(timezone.utc)
        fixtures = self.fetch_fixtures(league, today, today)
        return [f for f in fixtures if f.status == FixtureStatus.LIVE]
