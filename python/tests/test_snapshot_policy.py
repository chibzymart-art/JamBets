"""
Feed snapshots are built once per workflow run (egress step 2). Offline tests.
"""
import os
import unittest
from pathlib import Path
from unittest import mock

from python.src.engines import snapshot_policy
from python.src.engines.feed_snapshot_engine import FEED_TARGETS, parse_feed_arg, sync_feed_list

REPO = Path(__file__).resolve().parents[2]
WORKFLOWS = REPO / ".github" / "workflows"

# Scripts whose inline snapshot refresh is skipped when the workflow sets the flag.
INLINE_SITES = [
    "python/src/run_settlement.py",
    "python/src/run_predictions.py",
    "python/src/engines/run_all_specialists.py",
    "python/src/basketball/run_predictions.py",
    "python/src/basketball/run_settlement.py",
    "python/src/tennis/run_tennis_predictions.py",
    "python/src/tennis/run_tennis_settlement.py",
]

# Workflow -> feeds its snapshot step must still build.
EXPECTED_FEEDS = {
    "prediction_engine.yml": {"football", "goals", "corners", "counts"},
    "settlement_engine.yml": {"football", "goals", "corners", "counts"},
    "goals_engine.yml": {"goals", "corners", "counts"},
    "basketball_engine.yml": {"basketball"},
    "basketball_settlement_engine.yml": {"basketball"},
    "tennis_engine.yml": {"tennis"},
    "tennis_settlement_engine.yml": {"tennis"},
}


class PolicyTests(unittest.TestCase):
    def test_flag_unset_keeps_inline_refresh(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop(snapshot_policy.ENV_FLAG, None)
            self.assertTrue(snapshot_policy.inline_snapshot_refresh_enabled())

    def test_flag_set_skips_inline_refresh(self):
        with mock.patch.dict(os.environ, {snapshot_policy.ENV_FLAG: "1"}):
            self.assertFalse(snapshot_policy.inline_snapshot_refresh_enabled())

    def test_other_values_keep_inline_refresh(self):
        for value in ("0", "", "true", "yes"):
            with mock.patch.dict(os.environ, {snapshot_policy.ENV_FLAG: value}):
                self.assertTrue(snapshot_policy.inline_snapshot_refresh_enabled(), value)

    def test_every_inline_site_checks_the_flag(self):
        for rel in INLINE_SITES:
            text = (REPO / rel).read_text(encoding="utf-8")
            self.assertIn("inline_snapshot_refresh_enabled()", text, rel)


class FeedArgTests(unittest.TestCase):
    def test_single_and_all_unchanged(self):
        self.assertEqual(parse_feed_arg("all"), "all")
        for name in FEED_TARGETS:
            self.assertEqual(parse_feed_arg(name), name)

    def test_list(self):
        self.assertEqual(parse_feed_arg("football, goals,corners,counts"), "football,goals,corners,counts")

    def test_rejects_unknown_or_empty(self):
        for bad in ("bogus", "football,bogus", "", ","):
            with self.assertRaises(ValueError):
                parse_feed_arg(bad)


class FakeEngine:
    def __init__(self, failing=()):
        self.failing = set(failing)
        self.written = []
        self.notified = []
        for name, (key, builder, _tags) in FEED_TARGETS.items():
            setattr(self, builder, self._builder(name))

    def _builder(self, name):
        def build():
            if name in self.failing:
                raise RuntimeError(f"{name} failed")
            return {"feed": name}
        return build

    def write_snapshot(self, key, payload):
        self.written.append(key)
        return True

    def notify_edge_invalidation(self, tags):
        self.notified.append(tuple(tags))
        return True


class SyncFeedListTests(unittest.TestCase):
    def test_builds_each_listed_feed_once(self):
        eng = FakeEngine()
        res = sync_feed_list(eng, ["football", "goals", "corners", "counts"])
        self.assertEqual(eng.written, ["feed:football:today", "feed:goals", "feed:corners", "feed:market:counts"])
        self.assertEqual(eng.notified, [("football",), ("goals",), ("market", "corners"), ("counts", "market")])
        self.assertTrue(all(res.values()))

    def test_one_failure_does_not_stop_the_rest(self):
        eng = FakeEngine(failing={"goals"})
        res = sync_feed_list(eng, ["football", "goals", "corners", "counts"])
        self.assertEqual(eng.written, ["feed:football:today", "feed:corners", "feed:market:counts"])
        self.assertFalse(res["feed:goals"])
        self.assertTrue(res["feed:market:counts"])


try:
    import yaml  # noqa: F401
    HAVE_YAML = True
except ImportError:  # pragma: no cover
    HAVE_YAML = False


@unittest.skipUnless(HAVE_YAML, "PyYAML not installed")
class WorkflowTests(unittest.TestCase):
    def _steps(self, name):
        import yaml
        doc = yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))
        return [s for job in doc["jobs"].values() for s in job["steps"]]

    def test_flagged_workflows_still_build_their_feeds_once_even_after_failures(self):
        for wf, expected in EXPECTED_FEEDS.items():
            steps = self._steps(wf)
            flagged = [s for s in steps if (s.get("env") or {}).get(snapshot_policy.ENV_FLAG) == "1"]
            self.assertTrue(flagged, f"{wf}: no engine step sets the flag")
            snap = [s for s in steps if "feed_snapshot_engine" in (s.get("run") or "")]
            self.assertEqual(len(snap), 1, f"{wf}: expected one snapshot step")
            self.assertIn("!cancelled()", str(snap[0].get("if", "")), f"{wf}: snapshot step must run after failures")
            built = []
            for line in snap[0]["run"].splitlines():
                if "feed_snapshot_engine" in line and "--feed" in line:
                    built += line.split("--feed", 1)[1].strip().split(",")
            self.assertEqual(sorted(built), sorted(expected), wf)  # each feed exactly once
            self.assertNotIn("all", built, wf)


if __name__ == "__main__":
    unittest.main()
