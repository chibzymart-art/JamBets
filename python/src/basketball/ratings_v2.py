"""
Oddsbanta basketball ratings v2.

Why this exists: the v1 ratings replay all history on top of already-updated ratings on every run,
use possession and offence baselines that exist for only some leagues (China CBA and Kazakhstan KBC
have none, so they fall back to 40-minute European defaults), and add a "Four Factors" term derived
from the same ratings. Backtested on 1,110 finished games, v1 mis-scales totals by league (NBA -26,
CBA -46 points).

v2 is a points-based offence/defence rating:
  expected home points = league_avg + home.off - away.def + league_hca / 2
  expected away points = league_avg + away.off - home.def - league_hca / 2
Each finished game is applied exactly once, in kickoff order, starting from clean baselines, so the
result is the same however often it runs. League scoring level and home advantage are learned from
that league's own games, so a league missing from any config cannot be mis-scaled.

Probabilities come from the model's own measured error: every game's margin and total error is
recorded (before the game is learned), grouped by game length and by how many earlier games the two
teams have, so a pick between two barely-known teams is stated with the wider uncertainty it really has.

This module has no database access. v2_engine.py feeds it and turns its output into predictions.
"""

from dataclasses import dataclass, field
from datetime import datetime
from math import erf, sqrt
from typing import Callable, Dict, Iterable, List, Optional, Tuple


@dataclass(frozen=True)
class Game:
    kickoff: float          # any sortable time value (epoch seconds/minutes)
    league: str
    quarter_minutes: int    # 12 = 48-minute game (NBA/CBA/NBL-style), 10 = 40-minute game
    home: str
    away: str
    home_score: int
    away_score: int


@dataclass
class TeamRating:
    off: float = 0.0
    defense: float = 0.0
    games: int = 0
    last_kickoff: Optional[float] = None  # epoch seconds, only tracked when kickoffs are datetimes/strings


@dataclass
class LeagueState:
    avg_team_points: float
    hca: float = 2.5
    games: int = 0


@dataclass(frozen=True)
class Prediction:
    game: Game
    home_expected: float
    away_expected: float
    home_prior_games: int
    away_prior_games: int
    league_prior_games: int

    @property
    def expected_total(self) -> float:
        return self.home_expected + self.away_expected

    @property
    def expected_margin(self) -> float:
        return self.home_expected - self.away_expected


def default_team_points(quarter_minutes: int) -> float:
    """Prior for average points per team before a league has its own games."""
    return 112.0 if int(quarter_minutes) == 12 else 80.0


def game_length_class(quarter_minutes: int) -> str:
    return "48" if int(quarter_minutes) == 12 else "40"


def experience_bucket(min_prior_games: int) -> int:
    """0: no earlier games, 1: 1-2, 2: 3-5, 3: 6-9, 4: 10+ (for the less-known of the two teams)."""
    n = int(min_prior_games)
    return 0 if n < 1 else 1 if n < 3 else 2 if n < 6 else 3 if n < 10 else 4


def to_epoch(kickoff) -> Optional[float]:
    if isinstance(kickoff, datetime):
        return kickoff.timestamp()
    if isinstance(kickoff, str):
        try:
            return datetime.fromisoformat(kickoff.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None
    return None


def normal_cdf(x: float) -> float:
    return 0.5 * (1.0 + erf(x / sqrt(2.0)))


@dataclass
class ErrorTracker:
    """
    Measured accuracy of the model, per (game length, experience of the less-known team), from games
    it predicted before learning them. Tracks:
      slope    how far real margins follow predicted margins (actual ~ slope x predicted). Below 1 means
               the ratings overstate gaps and probabilities must be pulled toward 50%; above 1, the reverse.
      margin   spread of real margins around slope x predicted
      total    spread of real totals around the predicted total
    Starts from a neutral prior (slope 1, margin 15, total 20, worth 20 games) so early cells are sane.
    """
    prior_n: int = 20
    prior_margin_sd: float = 15.0
    prior_total_sd: float = 20.0
    prior_pred_margin_sd: float = 5.0
    cells: Dict[Tuple[str, int], List[float]] = field(default_factory=dict)  # [s_pp, s_pa, s_aa, s_tt, n]

    def _cell(self, key: Tuple[str, int]) -> List[float]:
        if key not in self.cells:
            n = float(self.prior_n)
            pp = self.prior_pred_margin_sd ** 2
            self.cells[key] = [n * pp, n * pp, n * (pp + self.prior_margin_sd ** 2), n * self.prior_total_sd ** 2, n]
        return self.cells[key]

    def _key(self, quarter_minutes: int, min_prior_games: int) -> Tuple[str, int]:
        return game_length_class(quarter_minutes), experience_bucket(min_prior_games)

    def slope(self, quarter_minutes: int, min_prior_games: int) -> float:
        c = self._cell(self._key(quarter_minutes, min_prior_games))
        return max(0.5, min(1.3, c[1] / c[0]))

    def sds(self, quarter_minutes: int, min_prior_games: int) -> Tuple[float, float]:
        c = self._cell(self._key(quarter_minutes, min_prior_games))
        b = self.slope(quarter_minutes, min_prior_games)
        resid = max(1.0, c[2] - 2.0 * b * c[1] + b * b * c[0])
        return sqrt(resid / c[4]), sqrt(c[3] / c[4])

    def record(self, p: "Prediction") -> None:
        g = p.game
        c = self._cell(self._key(g.quarter_minutes, min(p.home_prior_games, p.away_prior_games)))
        pm = p.expected_margin
        am = g.home_score - g.away_score
        c[0] += pm * pm
        c[1] += pm * am
        c[2] += am * am
        c[3] += ((g.home_score + g.away_score) - p.expected_total) ** 2
        c[4] += 1.0

    def observed_games(self, quarter_minutes: int, min_prior_games: int) -> int:
        return int(self._cell(self._key(quarter_minutes, min_prior_games))[4]) - self.prior_n


@dataclass
class PointsRatingModel:
    k: float = 0.10            # learning rate for team offence/defence (tuned on the first half of history)
    k_hca: float = 0.02        # learning rate for league home advantage
    prior_games: int = 8       # league average is a running mean, weighted as if it started with this many games
    season_gap_days: float = 60.0  # a team idle this long is treated as starting a new season
    carryover: float = 1.0     # share of offence/defence kept across a season gap (1.0 = keep everything)
    teams: Dict[str, TeamRating] = field(default_factory=dict)
    leagues: Dict[str, LeagueState] = field(default_factory=dict)
    errors: ErrorTracker = field(default_factory=ErrorTracker)

    def _team(self, team_id: str) -> TeamRating:
        if team_id not in self.teams:
            self.teams[team_id] = TeamRating()
        return self.teams[team_id]

    def _apply_season_gap(self, t: TeamRating, kickoff) -> None:
        if self.carryover >= 1.0:
            return
        now = to_epoch(kickoff)
        if now is None or t.last_kickoff is None:
            return
        if now - t.last_kickoff >= self.season_gap_days * 86400.0:
            t.off *= self.carryover
            t.defense *= self.carryover
            t.games = min(t.games, 3)  # treat as partly known again, so its uncertainty widens

    def win_probability(self, p: "Prediction") -> float:
        """Calibrated probability that the home team wins."""
        qm, n = p.game.quarter_minutes, min(p.home_prior_games, p.away_prior_games)
        sm, _ = self.errors.sds(qm, n)
        return normal_cdf(self.errors.slope(qm, n) * p.expected_margin / sm)

    def _league(self, game: Game) -> LeagueState:
        if game.league not in self.leagues:
            self.leagues[game.league] = LeagueState(avg_team_points=default_team_points(game.quarter_minutes))
        return self.leagues[game.league]

    def predict(self, game: Game) -> Prediction:
        lg = self._league(game)
        h = self._team(game.home)
        a = self._team(game.away)
        self._apply_season_gap(h, game.kickoff)
        self._apply_season_gap(a, game.kickoff)
        return Prediction(
            game=game,
            home_expected=lg.avg_team_points + h.off - a.defense + lg.hca / 2.0,
            away_expected=lg.avg_team_points + a.off - h.defense - lg.hca / 2.0,
            home_prior_games=h.games,
            away_prior_games=a.games,
            league_prior_games=lg.games,
        )

    def update(self, game: Game, prediction: Optional[Prediction] = None) -> None:
        p = prediction or self.predict(game)
        lg = self._league(game)
        h = self._team(game.home)
        a = self._team(game.away)
        rh = game.home_score - p.home_expected
        ra = game.away_score - p.away_expected
        h.off += self.k * rh
        a.defense -= self.k * rh
        a.off += self.k * ra
        h.defense -= self.k * ra
        h.games += 1
        a.games += 1
        ts = to_epoch(game.kickoff)
        if ts is not None:
            h.last_kickoff = ts
            a.last_kickoff = ts
        w = 1.0 / max(self.prior_games, lg.games + 1)
        lg.avg_team_points += w * (((game.home_score + game.away_score) / 2.0) - lg.avg_team_points)
        lg.hca += self.k_hca * ((game.home_score - game.away_score) - lg.hca)
        lg.games += 1

    def replay(self, games: Iterable[Game]) -> List[Prediction]:
        """Walk-forward: predict each game from earlier games only, then learn from it. Each game once."""
        out: List[Prediction] = []
        for g in sorted(games, key=lambda x: x.kickoff):
            p = self.predict(g)
            out.append(p)
            self.errors.record(p)
            self.update(g, p)
        return out


def evaluate(predictions: Iterable[Prediction], keep: Callable[[Prediction], bool] = lambda p: True) -> Dict[str, float]:
    """Backtest metrics against the actual final scores."""
    rows = [p for p in predictions if keep(p)]
    n = len(rows)
    if n == 0:
        return {"n": 0}
    total_err = [p.expected_total - (p.game.home_score + p.game.away_score) for p in rows]
    margin_err = [(p.game.home_score - p.game.away_score) - p.expected_margin for p in rows]
    winner = [((p.expected_margin > 0) == (p.game.home_score > p.game.away_score)) for p in rows]
    mu = sum(margin_err) / n
    return {
        "n": n,
        "total_bias": round(sum(total_err) / n, 1),
        "total_mae": round(sum(abs(e) for e in total_err) / n, 1),
        "margin_mae": round(sum(abs(e) for e in margin_err) / n, 1),
        "margin_sd": round(sqrt(sum((e - mu) ** 2 for e in margin_err) / n), 1),
        "winner_pct": round(100.0 * sum(winner) / n, 1),
    }
