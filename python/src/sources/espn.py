"""
JamBets — ESPN Verified Data Source Adapter
Connects to official ESPN Soccer scoreboard endpoints.
"""

from datetime import datetime, timezone, timedelta
from typing import List, Optional
import httpx
from python.src.config import LeagueConfig
from python.src.football.models import RawFixturePayload, FixtureStatus
from python.src.sources.base import BaseSourceAdapter


class ESPNAdapter(BaseSourceAdapter):
    def __init__(self):
        super().__init__(
            name="ESPN",
            slug="espn",
            base_url="https://site.api.espn.com/apis/site/v2/sports/soccer",
            rate_limit_delay_seconds=1.5,
            max_retries=3
        )

    def _map_espn_status(self, espn_status_name: str) -> FixtureStatus:
        status_map = {
            "STATUS_SCHEDULED": FixtureStatus.SCHEDULED,
            "STATUS_IN_PROGRESS": FixtureStatus.LIVE,
            "STATUS_HALFTIME": FixtureStatus.LIVE,
            "STATUS_FIRST_HALF": FixtureStatus.LIVE,
            "STATUS_SECOND_HALF": FixtureStatus.LIVE,
            "STATUS_FINAL": FixtureStatus.FINISHED,
            "STATUS_FULL_TIME": FixtureStatus.FINISHED,
            "STATUS_POSTPONED": FixtureStatus.POSTPONED,
            "STATUS_CANCELED": FixtureStatus.CANCELLED,
            "STATUS_SUSPENDED": FixtureStatus.SUSPENDED,
        }
        return status_map.get(espn_status_name, FixtureStatus.SCHEDULED)

    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        """Retrieves verified schedule from ESPN for the designated league and dates."""
        results: List[RawFixturePayload] = []
        now_utc = datetime.now(timezone.utc)
        seen_event_ids = set()

        cur_date = date_from.date()
        end_date = date_to.date()

        while cur_date <= end_date:
            d_str = cur_date.strftime("%Y%m%d")
            url = f"{self.base_url}/{league.espn_slug}/scoreboard?dates={d_str}&limit=100"
            cur_date += timedelta(days=1)

            data = self.get_json_with_retry(url)
            if not data:
                continue

            events = data.get("events", [])
            season_year = str(data.get("season", {}).get("year", datetime.now().year))

            for event in events:
                event_id = str(event.get("id"))
                if event_id in seen_event_ids:
                    continue
                seen_event_ids.add(event_id)

                competitions = event.get("competitions", [])
                if not competitions:
                    continue
                comp = competitions[0]
                competitors = comp.get("competitors", [])
                if len(competitors) < 2:
                    continue

                home_comp = next((c for c in competitors if c.get("homeAway") == "home"), competitors[0])
                away_comp = next((c for c in competitors if c.get("homeAway") == "away"), competitors[1])

                home_team_name = home_comp.get("team", {}).get("displayName", home_comp.get("team", {}).get("name", "Unknown"))
                away_team_name = away_comp.get("team", {}).get("displayName", away_comp.get("team", {}).get("name", "Unknown"))

                # Parse kickoff time
                kickoff_str = event.get("date")
                try:
                    # ESPN formats ISO UTC strings like "2026-09-12T14:00Z"
                    kickoff_dt = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00"))
                except Exception:
                    continue

                status_raw = event.get("status", {}).get("type", {}).get("name", "STATUS_SCHEDULED")
                canonical_status = self._map_espn_status(status_raw)

                # Scores if available
                home_score = None
                away_score = None
                if canonical_status in (FixtureStatus.LIVE, FixtureStatus.FINISHED):
                    try:
                        home_score = int(home_comp.get("score"))
                        away_score = int(away_comp.get("score"))
                    except (ValueError, TypeError):
                        pass

                venue_name = comp.get("venue", {}).get("fullName")

                payload = RawFixturePayload(
                    source_name=self.name,
                    provider_event_id=event_id,
                    league_code=league.code,
                    season=season_year,
                    home_team_raw=home_team_name,
                    away_team_raw=away_team_name,
                    kickoff_time=kickoff_dt,
                    status=canonical_status,
                    home_score=home_score,
                    away_score=away_score,
                    venue=venue_name,
                    retrieved_at=now_utc,
                    raw_metadata={"espn_status": status_raw, "uid": event.get("uid")}
                )
                results.append(payload)

        return results

    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        """Polls current live matches for the league."""
        today = datetime.now(timezone.utc)
        fixtures = self.fetch_fixtures(league, today, today)
        return [f for f in fixtures if f.status == FixtureStatus.LIVE]
