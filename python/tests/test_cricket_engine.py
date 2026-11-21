"""Cricket engine phase 1: parser, model, simulator, calibration, scraper, identity."""

import json

import httpx
import numpy as np
import pytest

from python.src.cricket import config as C
from python.src.cricket.calibration import LogisticBlend, wilson_lower, calibration_table
from python.src.cricket.history import delivery_category, parse_match
from python.src.cricket.identity import Register
from python.src.cricket.model import CricketModel, _shrunk_ratio
from python.src.cricket.scrapers.livescore import LiveScoreCricket, LiveScoreError, in_scope
from python.src.cricket.simulator import Simulator, TeamSheet


def test_delivery_categories():
    assert delivery_category({"runs": {"total": 0}}) == C.DOT
    assert delivery_category({"runs": {"total": 6}}) == C.SIX
    assert delivery_category({"runs": {"total": 5}}) == C.FOUR
    assert delivery_category({"runs": {"total": 1}, "extras": {"wides": 1}}) == C.WIDE
    assert delivery_category({"runs": {"total": 1}, "extras": {"noballs": 1}}) == C.NOBALL
    assert delivery_category({"runs": {"total": 0}, "wickets": [{"kind": "bowled"}]}) == C.WICKET
    assert delivery_category({"runs": {"total": 0}, "wickets": [{"kind": "retired hurt"}]}) == C.DOT


def _raw_match(winner="A"):
    reg = {f"{t}{i}": f"id{t}{i}" for t in "AB" for i in range(11)}
    def over(team, o, runs):
        bat = f"{team}0"
        bowl = f"{'B' if team == 'A' else 'A'}{o % 5}"
        return {"over": o, "deliveries": [
            {"batter": bat, "non_striker": f"{team}1", "bowler": bowl, "runs": {"total": runs}}
            for _ in range(6)]}
    return {
        "info": {"match_type": "T20", "gender": "male", "teams": ["A", "B"], "dates": ["2025-01-01"],
                 "overs": 20, "toss": {"winner": "A", "decision": "bat"},
                 "outcome": {"winner": winner, "by": {"runs": 10}},
                 "players": {t: [f"{t}{i}" for i in range(11)] for t in "AB"},
                 "registry": {"people": reg}, "venue": "Ground X, City", "event": {"name": "Test Cup"}},
        "innings": [{"team": "A", "overs": [over("A", o, 2) for o in range(20)]},
                    {"team": "B", "overs": [over("B", o, 1) for o in range(20)], "target": {"runs": 241, "overs": 20}}],
    }


def test_parse_match_and_model_update():
    m = parse_match(_raw_match(), "1", "t20s")
    assert m["format"] == "T20" and m["winner"] == "A"
    assert m["players"]["A"][0] == "idA0"
    assert len(m["innings"][0]["balls"]) == 120
    model = CricketModel()
    model.update(m)
    assert model.elo_of("T20", "A") > 1500 > model.elo_of("T20", "B")
    assert model.balls_faced("T20", "idA0") == pytest.approx(120)
    base = model.baseline("T20")
    assert np.allclose(base.sum(axis=2), 1.0)


def test_women_and_tests_skipped():
    raw = _raw_match()
    raw["info"]["gender"] = "female"
    assert parse_match(raw, "1", "x") is None
    raw = _raw_match()
    raw["info"]["match_type"] = "Test"
    assert parse_match(raw, "1", "x") is None


def test_shrunk_ratio_has_no_zero_rows():
    obs = np.zeros((3, C.K))
    exp = np.zeros((3, C.K))
    r = _shrunk_ratio(obs, exp, 100.0)
    assert np.allclose(r, 1.0)  # unknown player = average, never zero or a made-up number
    exp[0] = 10.0 / C.K
    obs[0, C.SIX] = 5.0
    r = _shrunk_ratio(obs, exp, 100.0)
    assert r[0, C.SIX] > 1.0 and np.all(r > 0)


def _sheet(name, model, fmt, strong: bool):
    ids = [f"{name}{i}" for i in range(11)]
    for p in ids:
        bo = model._get(model.bat_obs, (fmt, p), (3, C.K)).v
        be = model._get(model.bat_exp, (fmt, p), (3, C.K)).v
        be[:] = 1000.0 / C.K
        bo[:] = 1000.0 / C.K
        if strong:
            bo[:, C.SIX] *= 3
            bo[:, C.WICKET] *= 0.5
        else:
            bo[:, C.WICKET] *= 2.5
    return TeamSheet(name, ids, ids, [1.0] * 11)


def test_simulator_strong_team_wins_and_scores_sane():
    model = CricketModel()
    strong = _sheet("S", model, "T20", True)
    weak = _sheet("W", model, "T20", False)
    res = Simulator(model, "T20", 3000, seed=1).simulate(strong, weak)
    assert res.p_bat_first_wins > 0.7
    assert res.first_innings_runs.mean() > res.second_innings_runs.mean() > 0
    assert 0.0 <= res.p_tie < 0.1


def test_logistic_blend_recovers_calibration():
    rng = np.random.default_rng(0)
    true_p = rng.uniform(0.05, 0.95, 4000)
    y = (rng.random(4000) < true_p).astype(float)
    X = (1.6 * np.log(true_p / (1 - true_p)))[:, None]  # over-confident model
    p = LogisticBlend().fit(X, y).predict(X)
    for band, n, pm, act in calibration_table(p, y):
        if n > 200:
            assert abs(pm - act) < 0.05


def test_wilson_lower():
    assert wilson_lower(90, 100) < 0.9
    assert wilson_lower(0, 0) == 0.0


LS_DAY = {"Stages": [
    {"Snm": "Australia v England 2026", "Cnm": "Twenty20 Internationals", "Events": [
        {"Eid": "1", "T1": [{"Nm": "Australia", "ID": "a"}], "T2": [{"Nm": "England", "ID": "e"}],
         "Eps": "NS", "Epr": 0, "EtTx": "Twenty20", "Esd": 20261121081500, "TPa": 1, "TCho": 2}]},
    {"Snm": "Sheffield Shield", "Cnm": "Australia", "Events": [
        {"Eid": "2", "T1": [{"Nm": "NSW"}], "T2": [{"Nm": "QLD"}], "Eps": "NS", "Epr": 0,
         "EtTx": "Domestic First Class", "Esd": 20261121000000}]},
]}


def _client(payloads):
    def handler(request: httpx.Request):
        for key, (code, body) in payloads.items():
            if key in request.url.path:
                return httpx.Response(code, json=body)
        return httpx.Response(404, json={})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_livescore_fixtures_toss_and_scope():
    s = LiveScoreCricket(_client({"date/cricket": (200, LS_DAY)}))
    fx = s.fixtures("20261121")
    assert [f.event_id for f in fx] == ["1"]  # first-class match out of scope
    f = fx[0]
    assert f.fmt == "T20" and f.toss_winner == "Australia" and f.toss_decision == "field"
    assert f.start_utc.startswith("2026-11-21T08:15")


def test_livescore_fails_loudly():
    with pytest.raises(LiveScoreError):
        LiveScoreCricket(_client({"date/cricket": (403, {})})).fixtures("20261121")
    with pytest.raises(LiveScoreError):
        LiveScoreCricket(_client({"date/cricket": (200, {"unexpected": 1})})).fixtures("20261121")


def test_in_scope_rules():
    assert in_scope("Indian Premier League", "India", "T20", "Mumbai Indians", "CSK")
    assert not in_scope("Women's Big Bash League", "Australia", "T20", "Stars W", "Heat W")
    assert not in_scope("Sheffield Shield", "Australia", None, "NSW", "QLD")


def test_identity_resolution(tmp_path):
    people = tmp_path / "people.csv"
    people.write_text(
        "identifier,name,unique_name,key_bigbash,key_cricbuzz,key_cricinfo\n"
        "p1,MR Marsh,MR Marsh,4601,,\n"
        "p2,J Edwards,J Edwards,,,\n"
        "p3,J Edwards,J Edwards (2),,,\n"
        "p4,HC Brook,HC Brook,,,\n")
    names = tmp_path / "names.csv"
    names.write_text("identifier,name\np1,Mitchell Marsh\np2,Jack Edwards\np3,Jack Edwards\n")
    reg = Register(str(people), str(names))
    assert reg.resolve(provider_col="key_bigbash", provider_id="4601", full_names=[]).player_id == "p1"
    assert reg.resolve(provider_col=None, provider_id=None, full_names=["Mitchell Marsh"]).method == "full_name"
    # ambiguous name stays unmatched unless the team pool settles it
    assert reg.resolve(provider_col=None, provider_id=None, full_names=["Jack Edwards"]).player_id is None
    assert reg.resolve(provider_col=None, provider_id=None, full_names=["Jack Edwards"],
                       team_pool=["p2"]).player_id == "p2"
    assert reg.resolve(provider_col=None, provider_id=None, full_names=["Harry Brook"],
                       team_pool=["p4", "p1"]).player_id == "p4"


CB_PAYLOAD = {
    "scoreCard": [], "isMatchComplete": False,
    "matchHeader": {
        "matchId": 151338, "matchFormat": "T20", "matchDescription": "1st T20I", "state": "Toss",
        "status": "Australia opt to bowl", "matchStartTimestamp": 1795248900000, "complete": False,
        "tossResults": {"tossWinnerId": 4, "tossWinnerName": "Australia", "decision": "Bowling"},
        "result": {}, "team1": {"id": 4, "name": "Australia"}, "team2": {"id": 9, "name": "England"},
        "venue": {"name": "Melbourne Cricket Ground", "city": "Melbourne", "country": "Australia",
                  "latitude": "-37.819967", "longitude": "144.983449"},
        "seriesName": "England tour of Australia, 2026"},
    "winProbability": {"team1": {"percent": 46}, "team2": {"percent": 54},
                       "odds": {"team1_point": 2.1, "team2_point": 1.8}},
}


def test_cricbuzz_parse_toss_venue_odds():
    from python.src.cricket.scrapers.cricbuzz import parse_mcenter, match_ids_from_html, CricbuzzError
    m = parse_mcenter(CB_PAYLOAD)
    assert m.toss_winner == "Australia" and m.toss_decision == "field"
    assert m.latitude == pytest.approx(-37.819967)
    assert m.odds == {"Australia": 2.1, "England": 1.8}
    assert m.start_utc.startswith("2026-11-21T08:15")
    with pytest.raises(CricbuzzError):
        parse_mcenter({"nothing": 1})
    html = '<a href="/live-cricket-scores/151338/aus-vs-eng">x</a><a href="/cricket-scores/151338/aus">y</a>'
    assert match_ids_from_html(html) == ["151338"]


def test_winner_from_text_and_league_key():
    from python.src.cricket.run_engine import winner_from_text, league_key
    assert winner_from_text("Netherlands win by 7 wickets", "Oman", "Netherlands") == "Netherlands"
    assert winner_from_text("Match tied", "A", "B") is None
    assert winner_from_text("No result", "A", "B") is None
    assert winner_from_text("Desert Vipers won the Super Over", "Desert Vipers", "MI Emirates") == "Desert Vipers"
    assert league_key("International League T20", "United Arab Emirates") == "ilt"
    assert league_key("Australia v England 2026", "Twenty20 Internationals") is None


def test_refresh_only_outside_48h_lock():
    from datetime import datetime, timezone
    from python.src.cricket.run_engine import is_refreshable, DAYS_AHEAD, LOCK_HOURS
    now = datetime(2026, 11, 21, 12, 0, tzinfo=timezone.utc)
    assert DAYS_AHEAD >= 4 and LOCK_HOURS == 48
    assert is_refreshable("2026-11-24T12:00:00+00:00", now)       # 72h out
    assert is_refreshable("2026-11-23T12:06:00Z", now)            # 48h06m out
    assert not is_refreshable("2026-11-23T12:03:00+00:00", now)   # inside 5-min margin
    assert not is_refreshable("2026-11-22T09:00:00+00:00", now)   # tomorrow
    assert not is_refreshable("2026-11-21T10:00:00+00:00", now)   # started
