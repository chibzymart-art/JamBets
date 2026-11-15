"""
Banter Hub tennis settlement: match winner graded by the main tennis rules, void cases, waiting for
the main system, the winner_id safety net, idempotency and dry run. Offline (fake database).
"""
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from python.src.banter import tennis_settlement as ts

REPO = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 15, 22, 0, tzinfo=timezone.utc)
KICK = (NOW - timedelta(hours=3)).isoformat()
POINTS = {"won": 3.0, "lost": 0.0, "void": 0.5}


def fixture(status="finished", winner="p1", sets=("6-3", "6-4"), p1s=2, p2s=0, retired=None):
    return {
        "id": "t1", "status": status, "player1_id": "A", "player2_id": "B",
        "winner_id": {"p1": "A", "p2": "B", None: None}[winner],
        "retired_player_id": retired, "score_p1_sets": p1s, "score_p2_sets": p2s,
        "set_scores": list(sets), "target_kickoff_at": KICK,
        "player1": {"display_name": "Jannik Sinner"}, "player2": {"display_name": "Alex de Minaur"},
    }


def pick(sel, status="pending"):
    return {"id": f"tp-{sel}", "fixture_id": "t1", "market": "MW", "selection": sel, "status": status, "kickoff_at": KICK}


class GradeTests(unittest.TestCase):
    def g(self, p, fx, main="won"):
        return ts.grade_pick(p, fx, main, POINTS)

    def test_finished(self):
        self.assertEqual(self.g(pick("p1"), fixture(winner="p1")), ("won", 3.0))
        self.assertEqual(self.g(pick("p2"), fixture(winner="p1")), ("lost", 0.0))
        self.assertEqual(self.g(pick("p2"), fixture(winner="p2", p1s=0, p2s=2)), ("won", 3.0))

    def test_walkover_is_void(self):
        self.assertEqual(self.g(pick("p1"), fixture(status="walkover", sets=(), p1s=0, p2s=0), main="void"), ("void", 0.5))

    def test_retirement_one_set_rule(self):
        # Player 2 retired after a completed set: the advancing player 1 wins.
        fx = fixture(status="retired", winner="p1", sets=("6-4", "2-1"), p1s=1, p2s=0, retired="B")
        self.assertEqual(self.g(pick("p1"), fx), ("won", 3.0))
        self.assertEqual(self.g(pick("p2"), fx), ("lost", 0.0))
        # Retirement inside set 1: void.
        early = fixture(status="retired", winner="p1", sets=("3-2",), p1s=0, p2s=0, retired="B")
        self.assertEqual(self.g(pick("p1"), early), ("void", 0.5))

    def test_cancelled_follows_main_void(self):
        fx = fixture(status="cancelled", winner=None, sets=(), p1s=0, p2s=0)
        self.assertEqual(self.g(pick("p1"), fx, main="void"), ("void", 0.5))
        self.assertIsNone(self.g(pick("p1"), fx, main="won"))

    def test_waits_for_main_system_and_final_state(self):
        self.assertIsNone(self.g(pick("p1"), fixture(), main="pending"))
        self.assertIsNone(self.g(pick("p1"), fixture(status="live")))
        self.assertIsNone(self.g(pick("p1"), fixture(status="scheduled")))
        self.assertIsNone(self.g(pick("p1"), None))

    def test_safety_net_without_winner(self):
        self.assertIsNone(self.g(pick("p1"), fixture(winner=None)))

    def test_never_rescored_and_bad_selection(self):
        self.assertIsNone(self.g(pick("p1", status="lost"), fixture(winner="p1")))
        self.assertIsNone(self.g({**pick("p1"), "selection": "draw"}, fixture()))


class FakeDb:
    def __init__(self, picks, fixtures, preds):
        self.picks = {p["id"]: dict(p) for p in picks}
        self.fixtures, self.preds, self.patches = fixtures, preds, []

    def get(self, table, params):
        if table == "tennis_user_picks":
            return [dict(p) for p in self.picks.values() if p["status"] == "pending"]
        if table == "tennis_fixtures":
            return self.fixtures
        if table == "tennis_predictions":
            return self.preds
        raise AssertionError(f"unexpected read of {table}")

    def patch(self, table, data, params):
        assert table == "tennis_user_picks", f"must only write Banter tennis picks, wrote {table}"
        assert params.get("status") == "eq.pending"
        pid = params["id"].removeprefix("eq.")
        self.patches.append(pid)
        if self.picks[pid]["status"] == "pending":
            self.picks[pid].update(data)
        return []


class RunTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb([pick("p1"), pick("p2")], [fixture(winner="p1")], [{"fixture_id": "t1", "settlement_status": "won"}])

    def test_dry_run_writes_nothing(self):
        stats = ts.run(live=False, db=self.db, now=NOW)
        self.assertEqual(self.db.patches, [])
        self.assertEqual((stats["won"], stats["lost"]), (1, 1))

    def test_live_then_rerun_changes_nothing(self):
        self.assertEqual(ts.run(live=True, db=self.db, now=NOW)["written"], 2)
        self.assertEqual(self.db.picks["tp-p1"]["points"], 3.0)
        self.assertEqual(ts.run(live=True, db=self.db, now=NOW)["pending_checked"], 0)
        self.assertEqual(len(self.db.patches), 2)

    def test_missing_table_is_not_fatal(self):
        class Broken:
            def get(self, *a, **k):
                raise RuntimeError("relation does not exist")
        self.assertEqual(ts.run(live=True, db=Broken(), now=NOW)["written"], 0)


class WorkflowTests(unittest.TestCase):
    def test_workflow_runs_tennis_step(self):
        wf = (REPO / ".github" / "workflows" / "banter_settlement.yml").read_text(encoding="utf-8")
        self.assertIn("python -m python.src.banter.tennis_settlement", wf)


if __name__ == "__main__":
    unittest.main()
