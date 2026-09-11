"""
JamBets — Football Data Acquisition Configuration & League Registry
Configures at least 25 football competitions across major and smaller tiers.
"""

from dataclasses import dataclass
from typing import Dict, List, Optional
import os
from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class LeagueConfig:
    code: str
    name: str
    country: str
    tier: int
    espn_slug: str
    livescore_country: str
    livescore_stage: str
    is_active: bool = True

# Minimum 25 competitions configured (30 total)
LEAGUE_REGISTRY: Dict[str, LeagueConfig] = {
    # --- Major European Leagues ---
    "ENG_PL": LeagueConfig(
        code="ENG_PL", name="Premier League", country="England", tier=1,
        espn_slug="eng.1", livescore_country="england", livescore_stage="premier-league"
    ),
    "ESP_LL": LeagueConfig(
        code="ESP_LL", name="La Liga", country="Spain", tier=1,
        espn_slug="esp.1", livescore_country="spain", livescore_stage="laliga"
    ),
    "ITA_SA": LeagueConfig(
        code="ITA_SA", name="Serie A", country="Italy", tier=1,
        espn_slug="ita.1", livescore_country="italy", livescore_stage="serie-a"
    ),
    "GER_BL": LeagueConfig(
        code="GER_BL", name="Bundesliga", country="Germany", tier=1,
        espn_slug="ger.1", livescore_country="germany", livescore_stage="bundesliga"
    ),
    "FRA_L1": LeagueConfig(
        code="FRA_L1", name="Ligue 1", country="France", tier=1,
        espn_slug="fra.1", livescore_country="france", livescore_stage="ligue-1"
    ),
    "EUR_CL": LeagueConfig(
        code="EUR_CL", name="UEFA Champions League", country="Europe", tier=1,
        espn_slug="uefa.champions", livescore_country="champions-league", livescore_stage="main"
    ),
    "EUR_EL": LeagueConfig(
        code="EUR_EL", name="UEFA Europa League", country="Europe", tier=2,
        espn_slug="uefa.europa", livescore_country="europa-league", livescore_stage="main"
    ),
    "EUR_ECL": LeagueConfig(
        code="EUR_ECL", name="UEFA Conference League", country="Europe", tier=3,
        espn_slug="uefa.europa.conf", livescore_country="europa-conference-league", livescore_stage="main"
    ),

    # --- Secondary & Smaller European Leagues ---
    "ENG_CH": LeagueConfig(
        code="ENG_CH", name="Championship", country="England", tier=2,
        espn_slug="eng.2", livescore_country="england", livescore_stage="championship"
    ),
    "ENG_L1": LeagueConfig(
        code="ENG_L1", name="League One", country="England", tier=3,
        espn_slug="eng.3", livescore_country="england", livescore_stage="league-1"
    ),
    "ENG_L2": LeagueConfig(
        code="ENG_L2", name="League Two", country="England", tier=4,
        espn_slug="eng.4", livescore_country="england", livescore_stage="league-2"
    ),
    "ENG_PL2": LeagueConfig(
        code="ENG_PL2", name="Premier League 2", country="England", tier=5,
        espn_slug=None, livescore_country="england", livescore_stage="premier-league-2"
    ),
    "ENG_PL_U18": LeagueConfig(
        code="ENG_PL_U18", name="Premier League U18", country="England", tier=6,
        espn_slug=None, livescore_country="england", livescore_stage="premier-league-u18"
    ),
    "ENG_NL": LeagueConfig(
        code="ENG_NL", name="National League", country="England", tier=5,
        espn_slug="eng.5", livescore_country="england", livescore_stage="national-league"
    ),
    "ENG_NL_N": LeagueConfig(
        code="ENG_NL_N", name="National League North", country="England", tier=6,
        espn_slug=None, livescore_country="england", livescore_stage="national-league-north"
    ),
    "ENG_NL_S": LeagueConfig(
        code="ENG_NL_S", name="National League South", country="England", tier=6,
        espn_slug=None, livescore_country="england", livescore_stage="national-league-south"
    ),
    "ENG_NPL": LeagueConfig(
        code="ENG_NPL", name="Northern Premier League", country="England", tier=7,
        espn_slug=None, livescore_country="england", livescore_stage="northern-premier-division"
    ),
    "ENG_ILP": LeagueConfig(
        code="ENG_ILP", name="Isthmian League Premier", country="England", tier=7,
        espn_slug=None, livescore_country="england", livescore_stage="isthmian-league"
    ),
    "ENG_SLP": LeagueConfig(
        code="ENG_SLP", name="Southern League Premier", country="England", tier=7,
        espn_slug=None, livescore_country="england", livescore_stage="southern-premier-division-south"
    ),
    "ENG_WSL": LeagueConfig(
        code="ENG_WSL", name="FA Women's Super League", country="England", tier=1,
        espn_slug="eng.w.1", livescore_country="england", livescore_stage="fa-women-s-super-league"
    ),
    "ENG_EFL_CUP": LeagueConfig(
        code="ENG_EFL_CUP", name="EFL Cup", country="England", tier=1,
        espn_slug="eng.league_cup", livescore_country="england", livescore_stage="efl-cup"
    ),
    "ESP_LL2": LeagueConfig(
        code="ESP_LL2", name="LaLiga 2", country="Spain", tier=2,
        espn_slug="esp.2", livescore_country="spain", livescore_stage="laliga-2"
    ),
    "ITA_SB": LeagueConfig(
        code="ITA_SB", name="Serie B", country="Italy", tier=2,
        espn_slug="ita.2", livescore_country="italy", livescore_stage="serie-b"
    ),
    "GER_3L": LeagueConfig(
        code="GER_3L", name="3. Liga", country="Germany", tier=3,
        espn_slug=None, livescore_country="germany", livescore_stage="3-liga"
    ),
    "FRA_L2": LeagueConfig(
        code="FRA_L2", name="Ligue 2", country="France", tier=2,
        espn_slug="fra.2", livescore_country="france", livescore_stage="ligue-2"
    ),
    "NED_EED": LeagueConfig(
        code="NED_EED", name="Eerste Divisie", country="Netherlands", tier=2,
        espn_slug="ned.2", livescore_country="netherlands", livescore_stage="eerste-divisie"
    ),
    "SCO_CH": LeagueConfig(
        code="SCO_CH", name="Scottish Championship", country="Scotland", tier=2,
        espn_slug="sco.2", livescore_country="scotland", livescore_stage="championship"
    ),
    "USA_USLC": LeagueConfig(
        code="USA_USLC", name="USL Championship", country="USA", tier=2,
        espn_slug="usa.usl.1", livescore_country="usa", livescore_stage="usl-championship"
    ),
    "USA_MLSN": LeagueConfig(
        code="USA_MLSN", name="MLS Next Pro", country="USA", tier=3,
        espn_slug=None, livescore_country="usa", livescore_stage="mls-next-pro"
    ),
    "SCO_PL": LeagueConfig(
        code="SCO_PL", name="Scottish Premiership", country="Scotland", tier=1,
        espn_slug="sco.1", livescore_country="scotland", livescore_stage="scotland-premiership"
    ),
    "NED_ED": LeagueConfig(
        code="NED_ED", name="Eredivisie", country="Netherlands", tier=1,
        espn_slug="ned.1", livescore_country="netherlands", livescore_stage="eredivisie"
    ),
    "POR_PL": LeagueConfig(
        code="POR_PL", name="Primeira Liga", country="Portugal", tier=1,
        espn_slug="por.1", livescore_country="portugal", livescore_stage="primeira-liga"
    ),
    "POR_L2": LeagueConfig(
        code="POR_L2", name="Liga Portugal 2", country="Portugal", tier=2,
        espn_slug="por.2", livescore_country="portugal", livescore_stage="segunda-liga"
    ),
    "BEL_PL": LeagueConfig(
        code="BEL_PL", name="Belgian Pro League", country="Belgium", tier=1,
        espn_slug="bel.1", livescore_country="belgium", livescore_stage="belgian-pro-league-2025"
    ),
    "TUR_SL": LeagueConfig(
        code="TUR_SL", name="Süper Lig", country="Turkey", tier=1,
        espn_slug="tur.1", livescore_country="turkey", livescore_stage="super-lig"
    ),
    "SUI_SL": LeagueConfig(
        code="SUI_SL", name="Swiss Super League", country="Switzerland", tier=1,
        espn_slug="sui.1", livescore_country="switzerland", livescore_stage="super-league"
    ),
    "AUT_BL": LeagueConfig(
        code="AUT_BL", name="Austrian Bundesliga", country="Austria", tier=1,
        espn_slug="aut.1", livescore_country="austria", livescore_stage="bundesliga"
    ),
    "DEN_SL": LeagueConfig(
        code="DEN_SL", name="Danish Superliga", country="Denmark", tier=1,
        espn_slug="den.1", livescore_country="denmark", livescore_stage="superliga"
    ),
    "SWE_AL": LeagueConfig(
        code="SWE_AL", name="Allsvenskan", country="Sweden", tier=1,
        espn_slug="swe.1", livescore_country="sweden", livescore_stage="allsvenskan"
    ),
    "NOR_EL": LeagueConfig(
        code="NOR_EL", name="Eliteserien", country="Norway", tier=1,
        espn_slug="nor.1", livescore_country="norway", livescore_stage="eliteserien"
    ),
    "GRE_SL": LeagueConfig(
        code="GRE_SL", name="Super League Greece", country="Greece", tier=1,
        espn_slug="gre.1", livescore_country="greece", livescore_stage="super-league"
    ),
    "GER_2BL": LeagueConfig(
        code="GER_2BL", name="2. Bundesliga", country="Germany", tier=2,
        espn_slug="ger.2", livescore_country="germany", livescore_stage="2-bundesliga"
    ),

    # --- Americas, Asia & Global Competitions ---
    "USA_MLS": LeagueConfig(
        code="USA_MLS", name="Major League Soccer", country="USA", tier=1,
        espn_slug="usa.1", livescore_country="usa", livescore_stage="major-league-soccer-2026"
    ),
    "BRA_SA": LeagueConfig(
        code="BRA_SA", name="Brasileirão Série A", country="Brazil", tier=1,
        espn_slug="bra.1", livescore_country="brazil", livescore_stage="serie-a"
    ),
    "ARG_PD": LeagueConfig(
        code="ARG_PD", name="Liga Profesional de Fútbol", country="Argentina", tier=1,
        espn_slug="arg.1", livescore_country="argentina", livescore_stage="liga-profesional-clausura"
    ),
    "MEX_LMX": LeagueConfig(
        code="MEX_LMX", name="Liga MX", country="Mexico", tier=1,
        espn_slug="mex.1", livescore_country="mexico", livescore_stage="liga-mx"
    ),
    "SAU_SPL": LeagueConfig(
        code="SAU_SPL", name="Saudi Pro League", country="Saudi Arabia", tier=1,
        espn_slug="sau.1", livescore_country="saudi-arabia", livescore_stage="saudi-professional-league"
    ),
    "JPN_J1": LeagueConfig(
        code="JPN_J1", name="J1 League", country="Japan", tier=1,
        espn_slug="jpn.1", livescore_country="japan", livescore_stage="j-league-2025"
    ),
    "AUS_AL": LeagueConfig(
        code="AUS_AL", name="A-League Men", country="Australia", tier=1,
        espn_slug="aus.1", livescore_country="australia", livescore_stage="a-league"
    ),
    "SA_CL": LeagueConfig(
        code="SA_CL", name="Copa Libertadores", country="South America", tier=1,
        espn_slug="conmebol.libertadores", livescore_country="copa-libertadores", livescore_stage="main"
    )
}

# Stale Data Timeouts (seconds)
STALE_THRESHOLD_SCHEDULED_SECONDS = 6 * 3600  # 6 hours
STALE_THRESHOLD_LIVE_SECONDS = 15 * 60         # 15 minutes
STALE_THRESHOLD_RESULT_SECONDS = 24 * 3600     # 24 hours

# Four-Day Prediction Window Limit
MAX_PREDICTION_WINDOW_DAYS = 4

# Multi-Source Tolerance
KICKOFF_TOLERANCE_MINUTES = 30
