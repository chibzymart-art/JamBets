"""Over/Under 2.5 engine v2: picks, tiers, team matching, ratings and Under settlement."""

import numpy as np

from python.src.goals.ou25 import model as M
from python.src.goals.ou25.matcher import best_match
from python.src.goals.ou25.sources import devig
from python.src.goals.goals_settlement import GoalsSettlementEngine


def test_choose_pick_sides_and_tiers():
    assert M.choose_pick(0.80, True, "GER_BL") == ("OVER_2.5", "ELITE_OVER", 0.80)
    assert M.choose_pick(0.66, True, "GER_BL")[:2] == ("OVER_2.5", "STANDARD_OVER")
    side, tier, p = M.choose_pick(0.38, True, "ESP_LL")
    assert (side, tier) == ("UNDER_2.5", "STANDARD_UNDER") and abs(p - 0.62) < 1e-9
    assert M.choose_pick(0.50, True, "ESP_LL") is None                  # no edge: no pick
    assert M.choose_pick(0.30, True, "ITA_SA") is None                  # Serie A unders excluded
    assert M.choose_pick(0.39, False, "ARG_PD") is None                 # no odds: Under needs 62%
    assert M.choose_pick(0.37, False, "ARG_PD")[:2] == ("UNDER_2.5", "STANDARD_UNDER")
    assert M.choose_pick(0.75, False, "ARG_PD")[1] == "STANDARD_OVER"   # Elite needs odds


def test_calibration_shrinks_overconfident_model():
    assert M.calibrated_over(0.85, None) < 0.80
    assert M.calibrated_over(0.20, None) > 0.30
    # with a market price the blend stays close to the market
    assert abs(M.calibrated_over(0.55, 0.70) - 0.70) < 0.06


def test_devig():
    assert abs(devig(1.80, 2.00) - (1 / 1.8) / (1 / 1.8 + 1 / 2.0)) < 1e-12


def test_matcher_known_names_and_ambiguity():
    fd = ["Man City", "Man United", "QPR", "West Brom", "Nott'm Forest", "Sheffield Weds", "Sheffield United",
          "Ath Madrid", "Real Madrid", "Los Angeles FC", "Los Angeles Galaxy", "FC Copenhagen", "Aarhus"]
    assert best_match("manchester city", fd) == "Man City"
    assert best_match("queens park rangers", fd) == "QPR"
    assert best_match("west bromwich albion", fd) == "West Brom"
    assert best_match("nottingham forest", fd) == "Nott'm Forest"
    assert best_match("sheffield wednesday", fd) == "Sheffield Weds"
    assert best_match("atletico madrid", fd) == "Ath Madrid"
    assert best_match("koebenhavn", fd) == "FC Copenhagen"
    assert best_match("agf", fd) == "Aarhus"
    assert best_match("la galaxy", fd) == "Los Angeles Galaxy"
    assert best_match("los angeles", fd) is None          # could be either LA club
    assert best_match("totally unknown fc", fd) is None


def test_league_ratings_vectorised():
    days = np.array([100.0, 101.0, 102.0, 103.0] * 10)
    home = ["A", "B", "C", "D"] * 10
    away = ["B", "A", "D", "C"] * 10
    hg = np.array([3, 0, 1, 0] * 10, dtype=float)
    ag = np.array([1, 2, 0, 1] * 10, dtype=float)
    r = M.league_ratings(days, home, away, hg, ag, as_of_day=110.0)
    assert r is not None and set(r.attack) == {"A", "B", "C", "D"}
    assert r.attack["A"] > r.attack["C"]          # A scores far more than C
    p = M.raw_probability(r, "A", "B")
    assert p is not None and 0.0 < p[0] < 1.0


class _FakeDB:
    def __init__(self, preds, fixtures):
        self.preds, self.fixtures, self.patches = preds, fixtures, []

    def get(self, table, params=None):
        return self.preds if table == "goals_predictions" else self.fixtures

    def patch(self, table, data, params):
        self.patches.append((params["id"], data["settlement_status"]))

    def post(self, table, data, on_conflict=None):
        return data


def test_under_settlement():
    fx = [{"id": "f1", "status": "finished", "home_score": 1, "away_score": 1},
          {"id": "f2", "status": "finished", "home_score": 2, "away_score": 1}]
    preds = [
        {"id": "u1", "fixture_id": "f1", "market": "over_2.5_goals", "predicted_outcome": "UNDER_2.5", "settlement_status": "pending"},
        {"id": "u2", "fixture_id": "f2", "market": "over_2.5_goals", "predicted_outcome": "UNDER_2.5", "settlement_status": "pending"},
        {"id": "o1", "fixture_id": "f2", "market": "over_2.5_goals", "predicted_outcome": "OVER_2.5", "settlement_status": "pending"},
        {"id": "o2", "fixture_id": "f1", "market": "over_2.5_goals", "predicted_outcome": "OVER_2.5", "settlement_status": "pending"},
    ]
    db = _FakeDB(preds, fx)
    GoalsSettlementEngine(db=db).settle()
    assert dict(db.patches) == {"eq.u1": "won", "eq.u2": "lost", "eq.o1": "won", "eq.o2": "lost"}
