"""
Banter Hub football settlement: grading each market from stored results, void rules, waiting for the
main system, idempotency and dry run. Offline tests (a fake database, no network).
"""
import json
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from python.src.banter import football_settlement as bs

REPO = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 14, 22, 0, tzinfo=timezone.utc)
KICK = (NOW - timedelta(hours=3)).isoformat()
POINTS = {"won": 3.0, "lost": 0.0, "void": 0.5}


def fixture(status="finished", h=2, a=1, kickoff=KICK, period=None):
    return {"id": "f1", "canonical_key": "ENG_PL:x", "status": status, "period": period,
            "target_kickoff_at": kickoff, "home_score": h, "away_score": a}


def pick(market, selection, status="pending"):
    return {"id": f"p-{market}-{selection}", "fixture_id": "f1", "market": market,
            "selection": selection, "status": status, "kickoff_at": KICK}


class GradeTests(unittest.TestCase):
    def grade(self, p, fx, main="won"):
        return bs.grade_pick(p, fx, main, POINTS, NOW)

    def test_match_result(self):
        fx = fixture(h=2, a=1)
        self.assertEqual(self.grade(pick("1X2", "home"), fx), ("won", 3.0))
        self.assertEqual(self.grade(pick("1X2", "draw"), fx), ("lost", 0.0))
        self.assertEqual(self.grade(pick("1X2", "away"), fx), ("lost", 0.0))
        self.assertEqual(self.grade(pick("1X2", "draw"), fixture(h=1, a=1)), ("won", 3.0))
        self.assertEqual(self.grade(pick("1X2", "away"), fixture(h=0, a=3)), ("won", 3.0))

    def test_over_under_25(self):
        self.assertEqual(self.grade(pick("OU25", "over"), fixture(h=2, a=1)), ("won", 3.0))
        self.assertEqual(self.grade(pick("OU25", "under"), fixture(h=2, a=1)), ("lost", 0.0))
        self.assertEqual(self.grade(pick("OU25", "under"), fixture(h=1, a=1)), ("won", 3.0))
        self.assertEqual(self.grade(pick("OU25", "over"), fixture(h=0, a=0)), ("lost", 0.0))

    def test_both_teams_score(self):
        self.assertEqual(self.grade(pick("BTTS", "yes"), fixture(h=2, a=1)), ("won", 3.0))
        self.assertEqual(self.grade(pick("BTTS", "no"), fixture(h=2, a=1)), ("lost", 0.0))
        self.assertEqual(self.grade(pick("BTTS", "no"), fixture(h=3, a=0)), ("won", 3.0))

    def test_period_ft_counts_as_finished(self):
        self.assertEqual(self.grade(pick("1X2", "home"), fixture(status="live", period="FT")), ("won", 3.0))

    def test_cancelled_is_void(self):
        fx = fixture(status="cancelled", h=None, a=None)
        self.assertEqual(self.grade(pick("1X2", "home"), fx, main="void"), ("void", 0.5))

    def test_postponed_void_only_after_48h(self):
        recent = fixture(status="postponed", h=None, a=None)
        self.assertIsNone(self.grade(pick("1X2", "home"), recent, main="void"))
        old = fixture(status="postponed", h=None, a=None, kickoff=(NOW - timedelta(hours=60)).isoformat())
        self.assertEqual(self.grade(pick("1X2", "home"), old, main="void"), ("void", 0.5))

    def test_waits_for_main_system(self):
        fx = fixture(h=2, a=1)
        self.assertIsNone(self.grade(pick("1X2", "home"), fx, main="pending"))
        self.assertIsNone(self.grade(pick("1X2", "home"), fx, main=None))
        self.assertIsNone(self.grade(pick("1X2", "home"), fx, main="conflict"))

    def test_no_verified_result_stays_pending(self):
        self.assertIsNone(self.grade(pick("1X2", "home"), fixture(h=None, a=None)))
        self.assertIsNone(self.grade(pick("1X2", "home"), fixture(status="data_unavailable")))
        self.assertIsNone(self.grade(pick("1X2", "home"), None))
        # In play: never settled early, even when the main engine could.
        self.assertIsNone(self.grade(pick("OU25", "over"), fixture(status="live", h=3, a=0)))
        self.assertIsNone(self.grade(pick("BTTS", "yes"), fixture(status="live", h=1, a=1)))

    def test_settled_pick_never_rescored(self):
        self.assertIsNone(self.grade(pick("1X2", "home", status="lost"), fixture(h=2, a=1)))
        self.assertIsNone(self.grade(pick("1X2", "home", status="won"), fixture(h=0, a=1)))

    def test_unknown_market_stays_pending(self):
        self.assertIsNone(self.grade(pick("CORNERS", "over"), fixture()))


class FakeDb:
    def __init__(self, picks, fixtures, preds):
        self.picks = {p["id"]: dict(p) for p in picks}
        self.fixtures = fixtures
        self.preds = preds
        self.patches = []

    def get(self, table, params):
        if table == "football_user_picks":
            return [dict(p) for p in self.picks.values() if p["status"] == "pending"]
        if table == "football_fixtures":
            return self.fixtures
        if table == "football_predictions":
            return self.preds
        raise AssertionError(f"unexpected read of {table}")

    def patch(self, table, data, params):
        assert table == "football_user_picks", f"must only write Banter picks, wrote {table}"
        assert params.get("status") == "eq.pending", "update must be guarded on status=pending"
        pid = params["id"].removeprefix("eq.")
        self.patches.append((pid, data))
        if self.picks[pid]["status"] == "pending":
            self.picks[pid].update(data)
        return []


class RunTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb(
            [pick("1X2", "home"), pick("OU25", "under"), pick("BTTS", "yes")],
            [fixture(h=2, a=1)],
            [{"fixture_id": "f1", "settlement_status": "won"}],
        )

    def test_dry_run_writes_nothing(self):
        stats = bs.run(live=False, db=self.db, now=NOW)
        self.assertEqual(self.db.patches, [])
        self.assertEqual((stats["won"], stats["lost"]), (2, 1))

    def test_live_run_then_second_run_changes_nothing(self):
        first = bs.run(live=True, db=self.db, now=NOW)
        self.assertEqual(first["written"], 3)
        self.assertEqual(self.db.picks["p-1X2-home"]["status"], "won")
        self.assertEqual(self.db.picks["p-1X2-home"]["points"], 3.0)
        self.assertEqual(self.db.picks["p-OU25-under"]["status"], "lost")
        second = bs.run(live=True, db=self.db, now=NOW)
        self.assertEqual(second["pending_checked"], 0)
        self.assertEqual(len(self.db.patches), 3)

    def test_unreadable_table_is_not_an_error_exit(self):
        class Broken:
            def get(self, *a, **k):
                raise RuntimeError("relation does not exist")
        stats = bs.run(live=True, db=Broken(), now=NOW)
        self.assertEqual(stats["written"], 0)


class SharedScoringTests(unittest.TestCase):
    def test_points_come_from_the_shared_file(self):
        data = json.loads((REPO / "web" / "src" / "features" / "play" / "banter_scoring.json").read_text(encoding="utf-8"))
        self.assertEqual(bs.load_points(), {"won": float(data["won"]), "lost": float(data["lost"]), "void": float(data["void"])})
        self.assertEqual(bs.load_points(), POINTS)


class WorkflowTests(unittest.TestCase):
    def test_new_workflow_is_separate_and_dry_run_by_default(self):
        wf = (REPO / ".github" / "workflows" / "banter_settlement.yml").read_text(encoding="utf-8")
        self.assertIn("python -m python.src.banter.football_settlement", wf)
        self.assertIn("BANTER_SETTLE_LIVE", wf)
        self.assertNotIn("run_settlement", wf)
        self.assertIn("group: banter-settlement", wf)


if __name__ == "__main__":
    unittest.main()
