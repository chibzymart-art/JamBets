"""
Basketball ratings v2 (Phase 1). Offline tests.
The parity fixture is the first 20 finished games from production (team ids anonymised to row numbers),
with the predictions produced by the browser backtest that measured v2 on all 1,694 games.
"""
import unittest

from python.src.basketball.ratings_v2 import Game, PointsRatingModel, evaluate, default_team_points

ROWS = ("NBA,12,23,578,84,95;NBA,12,336,671,87,86;AUS_NBL,10,156,343,88,85;WNBA,10,463,626,79,69;"
        "WNBA,10,383,416,97,85;WNBA,10,643,651,96,77;WNBA,10,192,110,89,79;AUS_NBL,10,175,665,93,87;"
        "AUS_NBL,10,488,672,74,57;AUS_NBL,10,94,633,115,74;AUS_NBL,10,616,347,111,87;AUS_NBL,10,360,393,85,76;"
        "AUS_NBL,10,134,727,114,81;AUS_NBL,10,97,617,54,100;WNBA,10,23,578,65,83;WNBA,10,456,671,91,103;"
        "AUS_NBL,10,376,598,61,86;AUS_NBL,10,585,546,98,97;EUROLEAGUE,10,98,99,78,77;EUROLEAGUE,10,535,624,84,86")
EXPECTED = ("113.250/110.750;110.302/108.073;81.250/78.750;81.250/78.750;80.575/77.925;82.137/79.300;"
            "83.022/79.861;82.067/79.558;83.251/80.671;81.337/78.469;83.543/79.912;85.906/81.868;"
            "85.532/81.395;87.575/82.861;77.560/76.963;79.896/77.148;86.041/82.341;84.566/81.440;"
            "81.250/78.750;80.922/78.453")


def fixture_games():
    games = []
    for i, row in enumerate(ROWS.split(";")):
        lg, qm, h, a, hs, as_ = row.split(",")
        games.append(Game(kickoff=i, league=lg, quarter_minutes=int(qm), home=h, away=a,
                          home_score=int(hs), away_score=int(as_)))
    return games


class RatingsV2Tests(unittest.TestCase):
    def test_matches_browser_backtest(self):
        preds = PointsRatingModel(k=0.1).replay(fixture_games())
        got = ";".join(f"{p.home_expected:.3f}/{p.away_expected:.3f}" for p in preds)
        self.assertEqual(got, EXPECTED)

    def test_each_game_applied_once_and_deterministic(self):
        a = PointsRatingModel().replay(fixture_games())
        b = PointsRatingModel().replay(fixture_games())
        self.assertEqual([p.home_expected for p in a], [p.home_expected for p in b])
        m = PointsRatingModel()
        m.replay(fixture_games())
        total_team_games = sum(t.games for t in m.teams.values())
        self.assertEqual(total_team_games, 2 * len(fixture_games()))

    def test_unknown_league_uses_game_length_prior(self):
        self.assertEqual(default_team_points(12), 112.0)
        self.assertEqual(default_team_points(10), 80.0)
        g = Game(0, "BRAND_NEW_48MIN", 12, "x", "y", 100, 90)
        p = PointsRatingModel().predict(g)
        self.assertAlmostEqual(p.expected_total, 224.0)

    def test_predictions_use_only_earlier_games(self):
        games = fixture_games()
        first = PointsRatingModel().replay(games)[0]
        self.assertEqual(first.home_prior_games, 0)
        self.assertEqual(first.away_prior_games, 0)

    def test_league_learns_its_own_scoring_level(self):
        games = [Game(i, "LOW", 10, f"h{i%4}", f"a{i%4}", 70, 66) for i in range(60)]
        m = PointsRatingModel()
        m.replay(games)
        self.assertAlmostEqual(m.leagues["LOW"].avg_team_points, 68.0, delta=1.0)

    def test_backtest_runner_offline(self):
        import json, tempfile, os
        from python.src.research.basketball_backtest import load_from_json, run
        rows = [[g.kickoff, g.league, g.quarter_minutes, g.home, g.away, g.home_score, g.away_score]
                for g in fixture_games()]
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"rows": rows}, fh)
        try:
            out = run(load_from_json(fh.name))
        finally:
            os.unlink(fh.name)
        self.assertEqual(out["games"], 20)
        self.assertEqual(out["all"]["n"], 20)

    def test_evaluate(self):
        preds = PointsRatingModel().replay(fixture_games())
        r = evaluate(preds)
        self.assertEqual(r["n"], 20)
        self.assertIn("winner_pct", r)


if __name__ == "__main__":
    unittest.main()


class _Resp:
    def __init__(self, data):
        self._d = data

    def json(self):
        return self._d

    def raise_for_status(self):
        return None


class _FakeClient:
    """GET-only stand-in for the Supabase REST client. Any write attempt fails the test."""
    def __init__(self, leagues, fixtures):
        self.leagues, self.fixtures, self.calls = leagues, fixtures, []

    def get(self, path, params=None):
        self.calls.append((path, dict(params or {})))
        if path == "/basketball_leagues":
            return _Resp(self.leagues)
        off, lim = int(params["offset"]), int(params["limit"])
        return _Resp(self.fixtures[off:off + lim])

    def post(self, *a, **k):
        raise AssertionError("v2 must not write")

    patch = delete = post


class _FakeDb:
    def __init__(self, client):
        self.client = client


def _history(n_games=2500):
    import random
    rnd = random.Random(7)
    strength = {f"t{i}": rnd.gauss(0, 6) for i in range(20)}
    rows = []
    for i in range(n_games):
        h, a = rnd.sample(sorted(strength), 2)
        m = strength[h] - strength[a] + 3 + rnd.gauss(0, 11)
        tot = 165 + rnd.gauss(0, 15)
        rows.append({"id": f"f{i}", "target_kickoff_at": f"2026-{1 + i // 250:02d}-{1 + (i % 250) // 10:02d}T{(i % 10) + 10}:00:00+00:00",
                     "league_id": "L1", "home_team_id": h, "away_team_id": a,
                     "home_score": int(round((tot + m) / 2)), "away_score": int(round((tot - m) / 2))})
    return rows


class V2EngineTests(unittest.TestCase):
    def setUp(self):
        from python.src.basketball import v2_engine
        self.v2 = v2_engine
        self.client = _FakeClient([{"id": "L1", "code": "TEST_LG", "quarter_minutes": 10}], _history())
        self.games = v2_engine.load_history(_FakeDb(self.client))

    def test_history_is_paged_and_read_only(self):
        self.assertEqual(len(self.games), 2500)
        fixture_calls = [c for c in self.client.calls if c[0] == "/basketball_fixtures"]
        self.assertEqual([c[1]["offset"] for c in fixture_calls], ["0", "1000", "2000"])

    def test_sim_spread_reproduces_measured_errors(self):
        sigma, rho = self.v2.sim_spread(14.0, 18.0)
        self.assertAlmostEqual((2 * sigma ** 2 * (1 - rho)) ** 0.5, 14.0, places=6)
        self.assertAlmostEqual((2 * sigma ** 2 * (1 + rho)) ** 0.5, 18.0, places=6)

    def test_tiers_need_history_for_top_labels(self):
        from python.src.basketball.models import BasketballConfidenceTier as T
        self.assertEqual(self.v2.tier_for(0.95, 0), T.HIGH_CONFIDENCE)
        self.assertEqual(self.v2.tier_for(0.95, 3), T.BANGER)
        self.assertEqual(self.v2.tier_for(0.80, 5), T.TOP_PICK)
        self.assertEqual(self.v2.tier_for(0.86, 5), T.TOP_PICK)   # below the 88% Banger floor
        self.assertEqual(self.v2.tier_for(0.88, 5), T.BANGER)
        self.assertEqual(self.v2.tier_for(0.70, 5), T.HIGH_CONFIDENCE)

    def test_prediction_probability_is_unclamped_and_consistent(self):
        from python.src.basketball.monte_carlo import BasketballMonteCarloSimulator
        model = self.v2.build_model(self.games)
        fix = {"id": "new1", "target_kickoff_at": "2026-12-01T19:00:00+00:00", "home_team_id": "t1", "away_team_id": "t2",
               "league": {"code": "TEST_LG", "quarter_minutes": 10},
               "home_team": {"canonical_name": "Home"}, "away_team": {"canonical_name": "Away"}}
        pred = self.v2.predict_fixture(model, fix, BasketballMonteCarloSimulator(default_simulations=20000), 20000)
        meta = pred.metadata["ratings_v2"]
        self.assertGreater(meta["home_prior_games"], 100)
        # simulated scores track the ratings, the stated probability is what the simulation produced
        exp_home = (meta["home_expected"] + meta["away_expected"] + meta["calibrated_margin"]) / 2
        self.assertAlmostEqual(pred.simulated_home_score, exp_home, delta=0.6)
        self.assertTrue(0.5 <= pred.probability <= 1.0)
        self.assertIn(pred.market.value, ("moneyline", "point_spread", "game_total_over_under"))
        for s in pred.secondary_predictions:
            self.assertNotEqual(s["tier"], "BANGER")

    def test_calibration_on_synthetic_league(self):
        # Walk-forward: stated win probability should match the hit rate within a few points.
        model = PointsRatingModel()
        preds = model.replay(self.games)
        buckets = {}
        m2 = PointsRatingModel()
        for g, p in zip(sorted(self.games, key=lambda x: x.kickoff), preds):
            if p.home_prior_games >= 3 and p.away_prior_games >= 3:
                ph = m2.win_probability(p)
                fav = max(ph, 1 - ph)
                ok = (ph >= 0.5) == (g.home_score > g.away_score)
                b = buckets.setdefault(int(fav * 10), [0, 0, 0.0])
                b[0] += 1; b[1] += ok; b[2] += fav
            m2.errors.record(p)
        for k, (n, won, st) in buckets.items():
            if n >= 150:
                self.assertAlmostEqual(won / n, st / n, delta=0.06, msg=f"band {k}")


class SeasonCarryoverTests(unittest.TestCase):
    def test_idle_team_is_shrunk_once(self):
        m = PointsRatingModel(carryover=0.6)
        g1 = [Game(f"2026-01-{d:02d}T12:00:00+00:00", "L", 10, "a", "b", 100, 70) for d in range(1, 11)]
        m.replay(g1)
        off_before = m.teams["a"].off
        p = m.predict(Game("2026-05-01T12:00:00+00:00", "L", 10, "a", "b", 0, 0))
        self.assertAlmostEqual(m.teams["a"].off, off_before * 0.6, places=6)
        self.assertEqual(p.home_prior_games, 3)

    def test_no_shrink_without_gap(self):
        m = PointsRatingModel(carryover=0.6)
        m.replay([Game(f"2026-01-{d:02d}T12:00:00+00:00", "L", 10, "a", "b", 100, 70) for d in range(1, 11)])
        before = m.teams["a"].off
        m.predict(Game("2026-01-20T12:00:00+00:00", "L", 10, "a", "b", 0, 0))
        self.assertEqual(m.teams["a"].off, before)


class BackfillFilterTests(unittest.TestCase):
    def test_only_finished_games_with_scores_are_kept(self):
        from python.src.research import basketball_history_backfill as bf

        class _Src:
            def __init__(self, rows):
                self.rows = rows

            def fetch_scoreboard(self, code, date_str):
                return self.rows if code == "NBA" else []

            def fetch_matches_by_date(self, date_str):
                return self.rows

        rows = [
            {"canonical_key": "a", "status": "finished", "home_score": 100, "away_score": 90},
            {"canonical_key": "b", "status": "scheduled", "home_score": None, "away_score": None},
            {"canonical_key": "c", "status": "live", "home_score": 50, "away_score": 40},
            {"canonical_key": "d", "status": "finished", "home_score": None, "away_score": 70},
        ]

        class _Pipe:
            espn = _Src(rows)
            livescore = _Src(rows)

        self.assertEqual(sorted(bf.fetch_finished_for_date(_Pipe(), "20260301")), ["a"])
