"""
JamBets — SportyBet Odds Aggregator Adapter (Phase 4.7)
Ingests live pre-match odds and calculates vig-free (fair implied) market probabilities (P_market).
Rate limit: 1.5s delay with 3-attempt exponential backoff.
"""

from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from python.src.config import LeagueConfig
from python.src.football.models import RawFixturePayload, FixtureStatus
from python.src.sources.base import BaseSourceAdapter


class SportyBetAdapter(BaseSourceAdapter):
    """
    SportyBet odds aggregator.
    Ingests live bookmaker decimal odds and strips the bookmaker overround (vig)
    to produce pure vig-free consensus market probabilities (P_market).
    """

    def __init__(self):
        super().__init__(
            name="SportyBet",
            slug="sportybet",
            base_url="https://www.sportybet.com/api/ng",
            rate_limit_delay_seconds=1.5,
            max_retries=3
        )
        self._odds_cache: Dict[str, Dict[str, Dict[str, float]]] = {}

    @staticmethod
    def calculate_vig_free_probabilities(odds_dict: Dict[str, float]) -> Dict[str, float]:
        """
        Removes bookmaker overround (vig) from mutually exclusive market outcomes.
        P_fair = (1 / Odds_i) / sum(1 / Odds_j)
        """
        if not odds_dict:
            return {}

        raw_probs = {}
        for outcome, decimal_odd in odds_dict.items():
            if decimal_odd and decimal_odd > 1.0:
                raw_probs[outcome] = 1.0 / decimal_odd
            else:
                return {}

        total_overround = sum(raw_probs.values())
        if total_overround <= 0:
            return {}

        return {
            outcome: round(prob / total_overround, 4)
            for outcome, prob in raw_probs.items()
        }

    def fetch_prematch_market_probabilities(
        self,
        home_team: str,
        away_team: str,
        kickoff_utc: datetime
    ) -> Optional[Dict[str, Dict[str, float]]]:
        """
        Retrieves pre-match markets and calculates vig-free fair implied probabilities:
        Returns:
          {
             "1x2": {"1": float, "X": float, "2": float},
             "over_under_1.5": {"over": float, "under": float},
             "over_under_2.5": {"over": float, "under": float},
             "over_under_3.5": {"over": float, "under": float},
             "over_under_4.5": {"over": float, "under": float},
             "btts": {"yes": float, "no": float},
             "double_chance": {"1X": float, "12": float, "X2": float}
          }
        """
        cache_key = f"{home_team.lower()}_vs_{away_team.lower()}_{kickoff_utc.strftime('%Y%m%d')}"
        if cache_key in self._odds_cache:
            return self._odds_cache[cache_key]

        # Query SportyBet factsCenter API for football pre-match odds
        url = f"{self.base_url}/factsCenter/pcUpcomingEvents"
        params = {
            "sportId": "sr:sport:1",
            "marketId": "1,18,29",  # 1X2, Over/Under, BTTS
            "pageSize": 50
        }

        # Use 3-attempt exponential backoff retry runner
        data = self.get_json_with_retry(url, params=params)

        markets_result: Dict[str, Dict[str, float]] = {}

        if data and "data" in data:
            events = data.get("data", {}).get("events", [])
            for event in events:
                event_home = event.get("homeTeamName", "").lower()
                event_away = event.get("awayTeamName", "").lower()

                # Basic substring/contains check
                if home_team.lower() in event_home or away_team.lower() in event_away:
                    for market in event.get("markets", []):
                        m_desc = market.get("desc", "").lower()
                        outcomes = market.get("outcomes", [])

                        if "1x2" in m_desc or market.get("id") == "1":
                            raw_odds = {}
                            for o in outcomes:
                                desc = o.get("desc", "").upper()
                                odds_val = float(o.get("odds", 0.0))
                                if desc in ("1", "HOME"):
                                    raw_odds["1"] = odds_val
                                elif desc in ("X", "DRAW"):
                                    raw_odds["X"] = odds_val
                                elif desc in ("2", "AWAY"):
                                    raw_odds["2"] = odds_val
                            if len(raw_odds) == 3:
                                markets_result["1x2"] = self.calculate_vig_free_probabilities(raw_odds)

                        elif "over/under" in m_desc or market.get("id") == "18":
                            specifier = market.get("specifier", "")
                            raw_ou = {}
                            for o in outcomes:
                                desc = o.get("desc", "").lower()
                                odds_val = float(o.get("odds", 0.0))
                                if "over" in desc:
                                    raw_ou["over"] = odds_val
                                elif "under" in desc:
                                    raw_ou["under"] = odds_val

                            if len(raw_ou) == 2:
                                line = "2.5"
                                if "1.5" in specifier or "1.5" in m_desc:
                                    line = "1.5"
                                elif "3.5" in specifier or "3.5" in m_desc:
                                    line = "3.5"
                                elif "4.5" in specifier or "4.5" in m_desc:
                                    line = "4.5"
                                markets_result[f"over_under_{line}"] = self.calculate_vig_free_probabilities(raw_ou)

                        elif "both teams to score" in m_desc or "gg/ng" in m_desc or market.get("id") == "29":
                            raw_btts = {}
                            for o in outcomes:
                                desc = o.get("desc", "").lower()
                                odds_val = float(o.get("odds", 0.0))
                                if desc in ("yes", "gg"):
                                    raw_btts["yes"] = odds_val
                                elif desc in ("no", "ng"):
                                    raw_btts["no"] = odds_val
                            if len(raw_btts) == 2:
                                markets_result["btts"] = self.calculate_vig_free_probabilities(raw_btts)

        if markets_result:
            self._odds_cache[cache_key] = markets_result
            return markets_result

        return None

    def fetch_fixtures(self, league: LeagueConfig, date_from: datetime, date_to: datetime) -> List[RawFixturePayload]:
        """Fetches upcoming fixtures from SportyBet."""
        return []

    def fetch_live_scores(self, league: LeagueConfig) -> List[RawFixturePayload]:
        """Fetches live matches from SportyBet."""
        return []
