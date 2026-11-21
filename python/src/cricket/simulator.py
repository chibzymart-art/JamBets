"""
Vectorised ball-by-ball Monte Carlo match simulator.

Each simulation plays both innings ball by ball: the striker and bowler's
learned skills, the phase, wickets lost and (when chasing) the required run
rate set each ball's outcome mix. Bowlers are chosen per over from the
fielding XI by their usual share of overs, respecting the quota and never
bowling two overs in a row. All N simulations run at once with numpy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

import numpy as np

from python.src.cricket.config import (
    FORMATS, K, LEGAL_RUNS, WICKET, WIDE, NOBALL,
)
from python.src.cricket.model import CricketModel

MIN_BOWL_WEIGHT = 0.01


@dataclass
class TeamSheet:
    name: str
    batting_order: List[str]   # 11 player ids, most likely order
    bowlers: List[str]         # player ids eligible to bowl
    bowl_weights: List[float]  # usual share of overs (any scale)


@dataclass
class SimResult:
    p_bat_first_wins: float
    p_tie: float
    first_innings_runs: np.ndarray   # per simulation
    second_innings_runs: np.ndarray

    def first_innings_over(self, line: float) -> float:
        return float((self.first_innings_runs > line).mean())


def team_sheet(model: CricketModel, fmt: str, name: str, xi: List[str]) -> TeamSheet:
    """Build a sheet from an XI using as-of profiles only (no match leakage)."""
    def pos_key(p):
        u = model.usual_position(fmt, p)
        return (u if u is not None else 7.5, p)
    order = sorted(xi, key=pos_key)
    weights = [max(model.overs_share(fmt, p), MIN_BOWL_WEIGHT) for p in xi]
    return TeamSheet(name, order, list(xi), weights)


class Simulator:
    def __init__(self, model: CricketModel, fmt: str, n_sims: int = 20000,
                 seed: Optional[int] = None, competition: Optional[str] = None,
                 venue: Optional[str] = None):
        self.m = model
        self.fmt = fmt
        self.spec = FORMATS[fmt]
        self.n = n_sims
        self.rng = np.random.default_rng(seed)
        self.base = model.baseline(fmt) * model.context_factor(fmt, competition, venue)  # [3,3,K]
        self.chase = model.chase_factor(fmt)     # [3,nb,K]
        self.run_val = np.array(list(LEGAL_RUNS) + [model.extra_value(fmt, WIDE),
                                                    model.extra_value(fmt, NOBALL)])

    def _skill_tables(self, bat: TeamSheet, bowl: TeamSheet):
        bs = np.stack([self.m.bat_skill(self.fmt, p) for p in bat.batting_order])   # [11,3,K]
        ws = np.stack([self.m.bowl_skill(self.fmt, p) for p in bowl.bowlers])        # [B,3,K]
        return bs, ws

    def _innings(self, bat: TeamSheet, bowl: TeamSheet, overs: int,
                 target: Optional[np.ndarray]) -> np.ndarray:
        n, spec, rng = self.n, self.spec, self.rng
        bs, ws = self._skill_tables(bat, bowl)
        nbat = len(bat.batting_order)
        B = len(bowl.bowlers)
        w = np.asarray(bowl.bowl_weights, dtype=np.float64)
        quota = np.zeros((n, B), dtype=np.int32)
        last = np.full(n, -1)
        runs = np.zeros(n)
        wk = np.zeros(n, dtype=np.int32)
        striker = np.zeros(n, dtype=np.int32)
        non_striker = np.ones(n, dtype=np.int32)
        next_in = np.full(n, 2, dtype=np.int32)
        done = np.zeros(n, dtype=bool)
        max_wk = min(10, nbat - 1)
        total_balls = overs * 6
        legal = 0
        idx = np.arange(n)
        for over in range(overs):
            # choose bowler per simulation
            avail = (quota < spec.max_overs_per_bowler) & (np.arange(B)[None, :] != last[:, None])
            pw = avail * w[None, :]
            s = pw.sum(axis=1)
            dead = s <= 0
            if dead.any():  # everyone used up: relax the no-consecutive rule
                pw[dead] = (quota[dead] < spec.max_overs_per_bowler) * w[None, :]
                s = pw.sum(axis=1)
                s[s <= 0] = 1.0
            cum = np.cumsum(pw, axis=1) / s[:, None]
            bowler = (rng.random(n)[:, None] > cum).sum(axis=1)
            bowler = np.minimum(bowler, B - 1)
            quota[idx, bowler] += 1
            last = bowler
            ph = spec.phase(over)
            legal_in_over = np.zeros(n, dtype=np.int32)
            for _ in range(10):  # up to 6 legal balls plus extras (cap 10 deliveries)
                active = (~done) & (legal_in_over < 6)
                if not active.any():
                    break
                wb = np.where(wk <= 2, 0, np.where(wk <= 5, 1, 2))
                p = self.base[ph][wb] * bs[striker, ph] * ws[bowler, ph]   # [n,K]
                if target is not None:
                    balls_left = np.maximum(1, total_balls - (over * 6 + legal_in_over))
                    rrr = (target - runs) * 6.0 / balls_left
                    rb = np.searchsorted(spec.rrr_bins, rrr)
                    p = p * self.chase[ph][rb]
                p = p / p.sum(axis=1, keepdims=True)
                cat = (rng.random(n)[:, None] > np.cumsum(p, axis=1)).sum(axis=1)
                cat = np.minimum(cat, K - 1)
                cat = np.where(active, cat, -1)
                act = cat >= 0
                runs = runs + np.where(act, self.run_val[np.maximum(cat, 0)], 0.0)
                is_legal = act & (cat != WIDE) & (cat != NOBALL)
                legal_in_over += is_legal
                out = act & (cat == WICKET)
                wk += out
                # new batter replaces striker
                striker = np.where(out, next_in, striker)
                next_in = next_in + out
                odd = act & ((cat == 1) | (cat == 3))
                striker, non_striker = (np.where(odd, non_striker, striker),
                                        np.where(odd, striker, non_striker))
                done |= wk >= max_wk
                if target is not None:
                    done |= runs >= target
                striker = np.minimum(striker, nbat - 1)
                next_in = np.minimum(next_in, nbat - 1)
            # end of over: swap ends
            striker, non_striker = non_striker, striker
            if done.all():
                break
        return runs

    def simulate(self, bat_first: TeamSheet, bat_second: TeamSheet,
                 overs: Optional[int] = None) -> SimResult:
        ov = int(overs or self.spec.overs)
        r1 = self._innings(bat_first, bat_second, ov, None)
        target = np.floor(r1) + 1
        r2 = self._innings(bat_second, bat_first, ov, target)
        r1i, r2i = np.floor(r1), np.floor(r2)
        win1 = (r1i > r2i).mean()
        tie = (r1i == r2i).mean()
        return SimResult(float(win1), float(tie), r1i, r2i)
