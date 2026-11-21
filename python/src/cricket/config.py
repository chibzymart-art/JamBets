"""
Cricket engine configuration.

Only structural facts live here (overs per innings, bowling quotas, phase
boundaries, which archives to load). Model strengths, tier cut-offs and
blend weights are NOT typed in: they are estimated from data by the
back-test (see backtest.py) and written to its report.
"""

from dataclasses import dataclass
from typing import Dict, Tuple

# Outcome categories for one delivery.
DOT, ONE, TWO, THREE, FOUR, SIX, WICKET, WIDE, NOBALL = range(9)
K = 9
LEGAL_RUNS = (0, 1, 2, 3, 4, 6, 0)  # runs for categories 0..6 (legal balls)


@dataclass(frozen=True)
class FormatSpec:
    key: str                 # "T20" or "ODI"
    overs: int               # overs per innings
    max_overs_per_bowler: int
    phase_edges: Tuple[int, int]  # first over (0-based) of middle and death phases
    rrr_bins: Tuple[float, ...]   # required-run-rate bucket edges for chase behaviour

    def phase(self, over: int) -> int:
        if over < self.phase_edges[0]:
            return 0
        if over < self.phase_edges[1]:
            return 1
        return 2


FORMATS: Dict[str, FormatSpec] = {
    "T20": FormatSpec("T20", 20, 4, (6, 15), (6.0, 8.0, 10.0, 12.0, 15.0)),
    "ODI": FormatSpec("ODI", 50, 10, (10, 40), (4.0, 5.5, 7.0, 9.0)),
}

# Cricsheet match_type -> engine format
MATCH_TYPE_TO_FORMAT = {"T20": "T20", "IT20": "T20", "ODI": "ODI"}

# Wickets-lost buckets used by the context baseline: 0-2, 3-5, 6-9
def wicket_bucket(wickets: int) -> int:
    return 0 if wickets <= 2 else (1 if wickets <= 5 else 2)


# Cricsheet archives for the launch scope (men's T20 and ODI).
CRICSHEET_ARCHIVES = (
    "t20s", "odis", "ipl", "bbl", "psl", "cpl", "sat", "hnd",
    "ntb", "bpl", "ilt", "mlc", "ssm", "lpl",
)
CRICSHEET_URL = "https://cricsheet.org/downloads/{name}_male_json.zip"

# Skill decay half-life (days) and prior strength (balls) for shrinkage.
# These are model hyper-parameters chosen by the back-test sweep; the values
# here are the sweep's starting points, overridden by CLI flags.
DEFAULT_HALF_LIFE_DAYS = 730.0
DEFAULT_PRIOR_BALLS_BAT = 120.0
DEFAULT_PRIOR_BALLS_BOWL = 180.0
