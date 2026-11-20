"""
Over/Under 2.5 engine: ratings, probability, calibration and tiers.

1. Ratings: every league match in the last ~18 months, weighted by age (half-life
   150 days), opponent-neutral attack/defence rates, shrunk toward league average.
   Computed with numpy bincount in one vectorised pass per league.
2. Probability: Dixon-Coles joint score matrix (the existing model).
3. Calibration: a logistic curve fitted on 22,961 past matches turns the raw
   probability into the real hit rate. With bookmaker Over/Under 2.5 prices it is
   blended with the de-vigged market probability (the strongest single signal).
4. Tiers: ELITE and STANDARD bars per side, set from the backtest.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from python.src.goals.dixon_coles_goals import DixonColesGoalsModel

HALF_LIFE_DAYS = 150.0
SHRINK_MATCHES = 6.0
MIN_LEAGUE_WEIGHT = 30.0
MIN_TEAM_WEIGHT = 4.0  # need roughly 4+ recent matches per team (age-weighted)

# Logistic calibration fitted on 2023-24 .. 2026-27 (see docs/ou25_engine.md).
# model only:   P = sigmoid(a + b*logit(p_model))
CAL_MODEL = (0.0826, 0.6384)
# with odds:    P = sigmoid(a + b*logit(p_model) + c*logit(p_market))
CAL_BLEND = (0.0284, -0.1270, 1.1910)

# Pick bars on the calibrated probability of the chosen side. Walk-forward backtest
# (Jul 2024 - Nov 2026, 3,383 picks): ELITE_OVER 89% (99 picks), Standard Over with
# odds 67%, Standard Under with odds 62%, Over without odds 72%, Under without odds 69%.
# No Under setting reached 80% in the backtest, so ELITE_UNDER is switched off (0.99)
# rather than shown with a promise it cannot keep.
THRESHOLDS = {
    "odds":    {"ELITE_OVER": 0.78, "STANDARD_OVER": 0.65, "ELITE_UNDER": 0.99, "STANDARD_UNDER": 0.60},
    "no_odds": {"ELITE_OVER": 0.99, "STANDARD_OVER": 0.64, "ELITE_UNDER": 0.99, "STANDARD_UNDER": 0.62},
}
# Unders backtested at ~51% here (no better than a coin flip): never tip Under in these.
UNDER_EXCLUDED_LEAGUES = {"ITA_SA"}


def _logit(p: float) -> float:
    p = min(max(p, 1e-4), 1 - 1e-4)
    return math.log(p / (1 - p))


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


@dataclass
class LeagueRatings:
    home_avg: float
    away_avg: float
    attack: Dict[str, float]
    defence: Dict[str, float]
    weight: Dict[str, float]


def league_ratings(days: np.ndarray, home: List[str], away: List[str], hg: np.ndarray, ag: np.ndarray,
                   as_of_day: float) -> Optional[LeagueRatings]:
    """Age-weighted ratings from all matches strictly before `as_of_day` (vectorised)."""
    mask = days < as_of_day
    if not mask.any():
        return None
    d, hgm, agm = days[mask], hg[mask], ag[mask]
    hn = [h for h, m in zip(home, mask) if m]
    an = [a for a, m in zip(away, mask) if m]
    w = np.power(0.5, (as_of_day - d) / HALF_LIFE_DAYS)
    wsum = w.sum()
    if wsum < MIN_LEAGUE_WEIGHT:
        return None
    lh, la = float((w * hgm).sum() / wsum), float((w * agm).sum() / wsum)
    mu = (lh + la) / 2.0
    teams, idx = np.unique(np.asarray(hn + an), return_inverse=True)
    n = len(hn)
    hi, ai = idx[:n], idx[n:]
    k = len(teams)
    scored = np.bincount(hi, w * hgm, k) + np.bincount(ai, w * agm, k)
    conceded = np.bincount(hi, w * agm, k) + np.bincount(ai, w * hgm, k)
    wt = np.bincount(hi, w, k) + np.bincount(ai, w, k)
    shrink = wt / (wt + SHRINK_MATCHES)
    with np.errstate(divide="ignore", invalid="ignore"):
        att = np.where(wt > 0, scored / wt / mu, 1.0)
        dfn = np.where(wt > 0, conceded / wt / mu, 1.0)
    att = shrink * att + (1 - shrink)
    dfn = shrink * dfn + (1 - shrink)
    names = teams.tolist()
    return LeagueRatings(lh, la, dict(zip(names, att.tolist())), dict(zip(names, dfn.tolist())), dict(zip(names, wt.tolist())))


def raw_probability(r: LeagueRatings, home: str, away: str) -> Optional[Tuple[float, float, float]]:
    """(p_over_raw, lambda_home, lambda_away), or None if either team lacks history."""
    if r.weight.get(home, 0.0) < MIN_TEAM_WEIGHT or r.weight.get(away, 0.0) < MIN_TEAM_WEIGHT:
        return None
    lam_h = r.home_avg * r.attack[home] * r.defence[away]
    lam_a = r.away_avg * r.attack[away] * r.defence[home]
    p = DixonColesGoalsModel.calculate_probabilities(lam_h, lam_a)["p_over_25"]
    return p, lam_h, lam_a


def calibrated_over(p_model: float, p_market: Optional[float]) -> float:
    if p_market is None:
        a, b = CAL_MODEL
        return _sigmoid(a + b * _logit(p_model))
    a, b, c = CAL_BLEND
    return _sigmoid(a + b * _logit(p_model) + c * _logit(p_market))


def choose_pick(p_over: float, has_odds: bool, league: str) -> Optional[Tuple[str, str, float]]:
    """(predicted_outcome, confidence_tier, probability_of_that_side) or None for no pick."""
    t = THRESHOLDS["odds" if has_odds else "no_odds"]
    p_under = 1.0 - p_over
    if p_over >= t["STANDARD_OVER"]:
        tier = "ELITE_OVER" if p_over >= t["ELITE_OVER"] else "STANDARD_OVER"
        return "OVER_2.5", tier, p_over
    if p_under >= t["STANDARD_UNDER"] and league not in UNDER_EXCLUDED_LEAGUES:
        tier = "ELITE_UNDER" if p_under >= t["ELITE_UNDER"] else "STANDARD_UNDER"
        return "UNDER_2.5", tier, p_under
    return None
