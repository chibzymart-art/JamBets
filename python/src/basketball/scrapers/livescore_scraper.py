"""
Oddsbanta — LiveScore Public Basketball API Scraper
Phase 2: Data Acquisition (EuroLeague, ACB, NBL, European & International Leagues)

Features:
- Global basketball coverage for European, Oceanic, and International leagues
- Multi-source cross-validation of start times, quarter scores, and match lifecycle
"""

import re
import logging
import httpx
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

from python.src.basketball.config import LEAGUE_REGISTRY, ALTITUDE_VENUES, BasketballLeagueConfig
from python.src.basketball.identity import normalize_team_name, generate_canonical_key

logger = logging.getLogger("basketball.scraper.livescore")


class LivescoreBasketballScraper:
    """
    Scrapes LiveScore public basketball API for international and European leagues.
    """

    BASE_URL = "https://prod-public-api.livescore.com/v1/api/app/date/basketball/{date_str}/0"

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout
        self.headers = {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json",
        }
        self.client = httpx.Client(headers=self.headers, timeout=self.timeout)

    def fetch_matches_by_date(self, date_str: str) -> List[Dict[str, Any]]:
        """
        Fetches all basketball stages and fixtures from LiveScore for date YYYYMMDD.
        """
        url = self.BASE_URL.format(date_str=date_str)
        try:
            resp = self.client.get(url)
            resp.raise_for_status()
            data = resp.json()
            return self._parse_stages(data, date_str)
        except Exception as e:
            logger.warning("LiveScore basketball fetch failed for %s: %s", date_str, e)
            return []

    def _match_league_code(self, stage_name: str, comp_name: str) -> Optional[str]:
        combined = f"{stage_name} {comp_name}".lower()

        # Build list of (keyword, code) pairs from all registered leagues
        kw_pairs = []
        for code, cfg in LEAGUE_REGISTRY.items():
            keywords = list(cfg.livescore_keywords) if cfg.livescore_keywords else []
            if cfg.livescore_keyword and cfg.livescore_keyword not in keywords:
                keywords.append(cfg.livescore_keyword)
            for kw in keywords:
                if kw:
                    kw_pairs.append((kw.lower(), code))

        # Sort by keyword length descending so more specific phrases match first
        kw_pairs.sort(key=lambda x: len(x[0]), reverse=True)

        for kw, code in kw_pairs:
            # Word-boundary match or direct substring if keyword contains punctuation/spaces
            if " " in kw or "-" in kw:
                if kw in combined:
                    return code
            else:
                pattern = r'\b' + re.escape(kw) + r'\b'
                if re.search(pattern, combined):
                    return code

        # Dynamic fallback registration: do not discard any legitimate basketball fixture!
        clean_c = re.sub(r'[^a-zA-Z0-9]', '', comp_name).upper()[:3]
        clean_s = re.sub(r'[^a-zA-Z0-9]', '', stage_name).upper()[:4]
        gen_code = f"{clean_c}_{clean_s}" if clean_c and clean_s else (clean_c or clean_s or "INT_BB")

        if gen_code not in LEAGUE_REGISTRY:
            is_nba = "nba" in combined
            is_pba = "pba" in combined
            LEAGUE_REGISTRY[gen_code] = BasketballLeagueConfig(
                code=gen_code,
                name=f"{comp_name} {stage_name}".strip() or gen_code,
                country=comp_name or "International",
                quarter_minutes=12 if (is_nba or is_pba) else 10,
                periods_count=4,
                default_pace=99.5 if is_nba else 75.0,
                avg_offensive_rating=115.0 if is_nba else 106.0,
                hca_points=2.85,
            )
            logger.info("Dynamically registered global basketball league: %s (%s)", gen_code, f"{comp_name} {stage_name}")

        return gen_code

    def _parse_stages(self, data: Dict[str, Any], date_str: str) -> List[Dict[str, Any]]:
        stages = data.get("Stages", [])
        fixtures = []

        for stage in stages:
            stage_name = stage.get("Snm", "")
            comp_name = stage.get("Cnm", "")

            league_code = self._match_league_code(stage_name, comp_name)
            if not league_code:
                continue

            events = stage.get("Events", [])
            for ev in events:
                try:
                    t1_list = ev.get("T1", [])
                    t2_list = ev.get("T2", [])
                    if not t1_list or not t2_list:
                        continue

                    home_raw_name = t1_list[0].get("Nm", "")
                    away_raw_name = t2_list[0].get("Nm", "")

                    home_team = normalize_team_name(home_raw_name)
                    away_team = normalize_team_name(away_raw_name)

                    if home_team.lower() in ("tbd", "to be decided", "unknown team") or away_team.lower() in ("tbd", "to be decided", "unknown team"):
                        continue

                    # Scheduled datetime
                    esd = str(ev.get("Esd", ""))
                    if len(esd) >= 12:
                        try:
                            kickoff_dt = datetime.strptime(esd[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                        except ValueError:
                            kickoff_dt = datetime.strptime(f"{date_str}000000", "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
                    else:
                        kickoff_dt = datetime.strptime(f"{date_str}000000", "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)

                    canonical_key = generate_canonical_key(league_code, home_team, away_team, kickoff_dt)

                    # Status mapping
                    eps = ev.get("Eps", "NS")
                    if eps in ("FT", "AOT"):
                        status = "finished"
                    elif eps in ("1Q", "2Q", "HT", "3Q", "4Q", "OT"):
                        status = "live"
                    elif eps == "Postp":
                        status = "postponed"
                    elif eps == "Canc":
                        status = "cancelled"
                    else:
                        status = "scheduled"

                    # Scores
                    tr1 = ev.get("Tr1")
                    tr2 = ev.get("Tr2")
                    home_score = int(tr1) if tr1 is not None and str(tr1).isdigit() else 0
                    away_score = int(tr2) if tr2 is not None and str(tr2).isdigit() else 0

                    # Quarter scores if present in event payload
                    home_quarters = []
                    away_quarters = []
                    for q in range(1, 5):
                        q1 = ev.get(f"Tr1Q{q}")
                        q2 = ev.get(f"Tr2Q{q}")
                        if q1 is not None and str(q1).isdigit():
                            home_quarters.append(int(q1))
                        if q2 is not None and str(q2).isdigit():
                            away_quarters.append(int(q2))

                    fixture_item = {
                        "provider_event_id": str(ev.get("Eid", "")),
                        "canonical_key": canonical_key,
                        "league_code": league_code,
                        "home_team_name": home_team,
                        "away_team_name": away_team,
                        "target_kickoff_at": kickoff_dt.isoformat(),
                        "status": status,
                        "home_score": home_score,
                        "away_score": away_score,
                        "period_scores": {
                            "home": home_quarters,
                            "away": away_quarters,
                        },
                        "current_period": "Final" if status == "finished" else eps,
                        "time_remaining": None,
                        "market_spread": None,
                        "market_total": None,
                        "home_moneyline_odds": None,
                        "away_moneyline_odds": None,
                        "arena_name": None,
                        "city": None,
                        "state": None,
                        "altitude_bonus": ALTITUDE_VENUES.get(home_team.lower(), 0.0),
                        "source": "livescore",
                    }
                    fixtures.append(fixture_item)

                except Exception as e:
                    logger.debug("Error parsing LiveScore event: %s", e)
                    continue

        return fixtures

    def close(self):
        self.client.close()
