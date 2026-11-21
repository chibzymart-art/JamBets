"""
As-of cricket model state, learned only from matches already played.

Everything is estimated from ball-by-ball history, nothing is typed in:

* Context baseline: outcome mix per format x phase x wickets-lost bucket.
* Chase behaviour: how the mix shifts in the second innings by required
  run rate (multiplicative, per format x phase x RRR bucket).
* Player skills: batter and bowler multipliers per format x phase x outcome,
  with Bayesian shrinkage to 1.0 (average) so a player with few balls is
  pulled to the average instead of given a made-up rating. No defaults like
  the tennis engine's 1450 Elo.
* Team Elo per format with margin-of-victory scaling.
* Player profiles: usual batting position and share of overs bowled.

All counts decay with a half-life so recent form weighs more. State is
updated match by match, so a walk-forward back-test never sees the future.
"""

from __future__ import annotations

import math
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import numpy as np

from python.src.cricket.config import (
    FORMATS, K, WIDE, NOBALL, WICKET, wicket_bucket,
    DEFAULT_HALF_LIFE_DAYS, DEFAULT_PRIOR_BALLS_BAT, DEFAULT_PRIOR_BALLS_BOWL,
)

EPS = 1e-9


def competition_key(m: dict) -> Optional[str]:
    """Franchise leagues by archive; internationals have no shared environment."""
    src = m.get("source")
    return src if src not in ("t20s", "odis") else None


def venue_key(m: dict) -> Optional[str]:
    v = (m.get("venue") or "").split(",")[0].strip().lower()
    return v or None


def day_number(date: str) -> int:
    y, m, d = (int(x) for x in date[:10].split("-"))
    # days since 1970-01-01 (proleptic Gregorian), no datetime import in hot path
    import datetime as _dt
    return (_dt.date(y, m, d) - _dt.date(1970, 1, 1)).days


def _shrunk_ratio(obs: np.ndarray, exp: np.ndarray, prior: float) -> np.ndarray:
    """Observed / expected per outcome, shrunk to 1.0 with `prior` pseudo-balls
    spread like the expected mix (uniform when nothing is expected yet)."""
    tot = exp.sum(axis=-1, keepdims=True)
    share = np.where(tot > 0, exp / np.maximum(tot, EPS), 1.0 / exp.shape[-1])
    return (obs + prior * share) / (exp + prior * share)


class Decayed:
    """A decayed count array: value *= 0.5 ** (dt / half_life) when read."""

    __slots__ = ("v", "t")

    def __init__(self, shape, t: int):
        self.v = np.zeros(shape, dtype=np.float64)
        self.t = t

    def at(self, t: int, half_life: float) -> np.ndarray:
        if t != self.t:
            self.v *= 0.5 ** ((t - self.t) / half_life)
            self.t = t
        return self.v


class CricketModel:
    def __init__(self, half_life_days: float = DEFAULT_HALF_LIFE_DAYS,
                 prior_bat: float = DEFAULT_PRIOR_BALLS_BAT,
                 prior_bowl: float = DEFAULT_PRIOR_BALLS_BOWL,
                 elo_k: float = 24.0):
        self.hl = half_life_days
        self.prior_bat = prior_bat
        self.prior_bowl = prior_bowl
        self.elo_k = elo_k
        self.ctx_hl = 365.0  # scoring environments move faster (rule changes, pitches)
        self.t = 0
        # baseline counts [phase, wkt_bucket, K]
        self.base: Dict[str, Decayed] = {}
        # chase: observed and expected counts [phase, rrr_bucket, K]
        self.chase_obs: Dict[str, Decayed] = {}
        self.chase_exp: Dict[str, Decayed] = {}
        # player skills: observed and expected counts [phase, K]
        self.bat_obs: Dict[Tuple[str, str], Decayed] = {}
        self.bat_exp: Dict[Tuple[str, str], Decayed] = {}
        self.bowl_obs: Dict[Tuple[str, str], Decayed] = {}
        self.bowl_exp: Dict[Tuple[str, str], Decayed] = {}
        # scoring environment: competition and venue multipliers [K]
        self.ctx_obs: Dict[Tuple[str, str, str], Decayed] = {}
        self.ctx_exp: Dict[Tuple[str, str, str], Decayed] = {}
        # extras run values (mean total runs on a wide / no-ball) per format
        self.extra_runs = {f: {WIDE: [0.0, 0.0], NOBALL: [0.0, 0.0]} for f in FORMATS}
        # profiles
        self.bat_pos: Dict[Tuple[str, str], List[float]] = defaultdict(lambda: [0.0, 0.0])
        self.bowl_share: Dict[Tuple[str, str], List[float]] = defaultdict(lambda: [0.0, 0.0])
        self.matches_played: Dict[Tuple[str, str], int] = defaultdict(int)
        # team Elo
        self.elo: Dict[Tuple[str, str], float] = {}
        self.elo_games: Dict[Tuple[str, str], int] = defaultdict(int)

    # ------------------------------------------------------------------ helpers
    def _get(self, store: dict, key, shape) -> Decayed:
        d = store.get(key)
        if d is None:
            d = Decayed(shape, self.t)
            store[key] = d
        return d

    def baseline(self, fmt: str) -> np.ndarray:
        """Probabilities [phase, wkt_bucket, K]."""
        d = self.base.get(fmt)
        if d is None:
            return np.full((3, 3, K), 1.0 / K)
        c = d.at(self.t, self.hl) + 1.0  # Laplace
        return c / c.sum(axis=2, keepdims=True)

    def chase_factor(self, fmt: str) -> np.ndarray:
        """Multipliers [phase, rrr_bucket, K], shrunk to 1 with 200 pseudo-balls."""
        nb = len(FORMATS[fmt].rrr_bins) + 1
        o = self.chase_obs.get(fmt)
        e = self.chase_exp.get(fmt)
        if o is None or e is None:
            return np.ones((3, nb, K))
        ov = o.at(self.t, self.hl)
        ev = e.at(self.t, self.hl)
        return _shrunk_ratio(ov, ev, 200.0)

    def _skill(self, obs: dict, exp: dict, key, prior: float) -> np.ndarray:
        o = obs.get(key)
        if o is None:
            return np.ones((3, K))
        return _shrunk_ratio(o.at(self.t, self.hl), exp[key].at(self.t, self.hl), prior)

    def bat_skill(self, fmt: str, pid: str) -> np.ndarray:
        return self._skill(self.bat_obs, self.bat_exp, (fmt, pid), self.prior_bat)

    def bowl_skill(self, fmt: str, pid: str) -> np.ndarray:
        return self._skill(self.bowl_obs, self.bowl_exp, (fmt, pid), self.prior_bowl)

    def context_factor(self, fmt: str, competition: Optional[str], venue: Optional[str]) -> np.ndarray:
        """Combined competition x venue multiplier [K] (1.0 when unknown)."""
        f = np.ones(K)
        for kind, name, prior in (("comp", competition, 1500.0), ("venue", venue, 600.0)):
            if not name:
                continue
            o = self.ctx_obs.get((fmt, kind, name))
            if o is not None:
                f = f * _shrunk_ratio(o.at(self.t, self.ctx_hl), self.ctx_exp[(fmt, kind, name)].at(self.t, self.ctx_hl), prior)
        return f

    def extra_value(self, fmt: str, cat: int) -> float:
        s, n = self.extra_runs[fmt][cat]
        return s / n if n > 0 else (1.1 if cat == WIDE else 1.8)

    def balls_faced(self, fmt: str, pid: str) -> float:
        o = self.bat_obs.get((fmt, pid))
        return float(o.at(self.t, self.hl).sum()) if o is not None else 0.0

    def balls_bowled(self, fmt: str, pid: str) -> float:
        o = self.bowl_obs.get((fmt, pid))
        return float(o.at(self.t, self.hl).sum()) if o is not None else 0.0

    def usual_position(self, fmt: str, pid: str) -> Optional[float]:
        s, n = self.bat_pos.get((fmt, pid), (0.0, 0.0))
        return s / n if n > 0 else None

    def overs_share(self, fmt: str, pid: str) -> float:
        s, n = self.bowl_share.get((fmt, pid), (0.0, 0.0))
        return s / n if n > 0 else 0.0

    def elo_of(self, fmt: str, team: str) -> float:
        return self.elo.get((fmt, team), 1500.0)

    def elo_prob(self, fmt: str, a: str, b: str) -> float:
        return 1.0 / (1.0 + 10 ** ((self.elo_of(fmt, b) - self.elo_of(fmt, a)) / 400.0))

    # ------------------------------------------------------------------ update
    def update(self, m: dict) -> None:
        """Learn from one finished match (call AFTER predicting it)."""
        fmt = m["format"]
        spec = FORMATS[fmt]
        self.t = day_number(m["date"])
        base_p = self.baseline(fmt)          # as-of expectations (before this match)
        chase_f = self.chase_factor(fmt)
        ctx_f = self.context_factor(fmt, competition_key(m), venue_key(m))
        # As-of skills of everyone in this match, so each player's expected
        # outcomes account for the quality of the opponent they faced
        # (an associate batter facing associate bowlers is not rated as if
        # facing an average international attack).
        everyone = {p for xi in m["players"].values() for p in xi}
        for inn in m["innings"][:2]:
            for b in inn["balls"]:
                everyone.update((b[1], b[3]))
        bat_sk = {p: self.bat_skill(fmt, p) for p in everyone}
        bowl_sk = {p: self.bowl_skill(fmt, p) for p in everyone}
        nb = len(spec.rrr_bins) + 1
        base = self._get(self.base, fmt, (3, 3, K)).at(self.t, self.hl)
        co = self._get(self.chase_obs, fmt, (3, nb, K)).at(self.t, self.hl)
        ce = self._get(self.chase_exp, fmt, (3, nb, K)).at(self.t, self.hl)
        ex = self.extra_runs[fmt]
        ctx = []
        ctx_kinds = []
        for kind, name in (("comp", competition_key(m)), ("venue", venue_key(m))):
            if name:
                ctx_kinds.append((kind, name))
                ctx.append((self._get(self.ctx_obs, (fmt, kind, name), (K,)),
                            self._get(self.ctx_exp, (fmt, kind, name), (K,))))
        ctx_arrays = [(o.at(self.t, self.ctx_hl), e.at(self.t, self.ctx_hl)) for o, e in ctx]
        # each factor's own value, so a factor's expectation excludes only itself
        # (competition and venue must not both absorb the same residual)
        own_f = [_shrunk_ratio(o.copy(), e.copy(), pr) for (o, e), pr in zip(
            ctx_arrays, [1500.0 if kind == "comp" else 600.0 for kind, _ in ctx_kinds])]

        for inn_idx, inn in enumerate(m["innings"][:2]):
            team = inn["team"]
            wkts = 0
            runs = 0
            legal = 0
            order: List[str] = []
            bowler_balls: Dict[str, int] = defaultdict(int)
            target = inn.get("target_runs")
            t_overs = inn.get("target_overs") or (m.get("overs") or spec.overs)
            for over, bat, ns, bowl, cat, tot in inn["balls"]:
                for p in (bat, ns):
                    if p not in order:
                        order.append(p)
                ph = spec.phase(over)
                wb = wicket_bucket(wkts)
                exp_vec = base_p[ph, wb] * ctx_f
                exp_vec = exp_vec / exp_vec.sum()
                rb = None
                if inn_idx == 1 and target:
                    balls_left = max(1, int(round(float(t_overs) * 6)) - legal)
                    rrr = (target - runs) * 6.0 / balls_left
                    rb = int(np.searchsorted(spec.rrr_bins, rrr))
                    co[ph, rb, cat] += 1.0
                    ce[ph, rb] += exp_vec
                    exp_vec = exp_vec * chase_f[ph, rb]
                    exp_vec = exp_vec / exp_vec.sum()
                base[ph, wb, cat] += 1.0
                for (co_, ce_), f_own in zip(ctx_arrays, own_f):
                    co_[cat] += 1.0
                    full = exp_vec / f_own * bat_sk[bat][ph] * bowl_sk[bowl][ph]  # excludes this factor only
                    ce_ += full / full.sum()
                if cat in (WIDE, NOBALL):
                    ex[cat][0] += tot
                    ex[cat][1] += 1
                # skills: wides/no-balls credited to bowler only
                bo = self._get(self.bowl_obs, (fmt, bowl), (3, K)).at(self.t, self.hl)
                be = self._get(self.bowl_exp, (fmt, bowl), (3, K)).at(self.t, self.hl)
                bo[ph, cat] += 1.0
                e_bowl = exp_vec * bat_sk[bat][ph]
                be[ph] += e_bowl / e_bowl.sum()
                if cat not in (WIDE, NOBALL):
                    so = self._get(self.bat_obs, (fmt, bat), (3, K)).at(self.t, self.hl)
                    se = self._get(self.bat_exp, (fmt, bat), (3, K)).at(self.t, self.hl)
                    so[ph, cat] += 1.0
                    e_bat = exp_vec * bowl_sk[bowl][ph]
                    se[ph] += e_bat / e_bat.sum()
                    legal += 1
                    bowler_balls[bowl] += 1
                runs += tot
                if cat == WICKET:
                    wkts += 1
            for pos, p in enumerate(order):
                bp = self.bat_pos[(fmt, p)]
                bp[0] += pos
                bp[1] += 1
            # bowling share over the fielding XI
            fielding = [t for t in m["teams"] if t != team]
            if fielding:
                xi = m["players"].get(fielding[0], [])
                total = max(1, sum(bowler_balls.values()))
                for p in xi:
                    bs = self.bowl_share[(fmt, p)]
                    bs[0] += bowler_balls.get(p, 0) / total
                    bs[1] += 1
        for t in m["teams"]:
            for p in m["players"].get(t, []):
                self.matches_played[(fmt, p)] += 1
        self._update_elo(m)

    def _update_elo(self, m: dict) -> None:
        fmt = m["format"]
        a, b = m["teams"]
        if m["result"] == "no result" or not m["innings"]:
            return
        if m["result"] == "tie" and not m.get("winner"):
            s = 0.5
        else:
            s = 1.0 if m.get("winner") == a else 0.0
        mov = 1.0
        if m["result"] == "normal" and len(m["innings"]) >= 2:
            r1 = sum(x[5] for x in m["innings"][0]["balls"])
            r2 = sum(x[5] for x in m["innings"][1]["balls"])
            margin_runs = abs(r1 - r2)
            mov = 1.0 + math.log1p(margin_runs / (10.0 if fmt == "T20" else 25.0)) * 0.5
        ea = self.elo_prob(fmt, a, b)
        k = self.elo_k * mov
        for team, sc, e in ((a, s, ea), (b, 1 - s, 1 - ea)):
            key = (fmt, team)
            g = self.elo_games[key]
            kk = k * (1.5 if g < 10 else 1.0)
            self.elo[key] = self.elo_of(fmt, team) + kk * (sc - e)
            self.elo_games[key] = g + 1
