"""
Tennis result status mapping and settlement of cancelled / stuck matches. Offline tests.
Status cases are the exact values LiveScore returned on 20-24 Oct 2026 for fixtures that got stuck.
"""
import unittest
from datetime import datetime, timedelta, timezone

from python.src.tennis.scraper.livescore_tennis import LiveScoreTennisScraper


class TennisStatusTests(unittest.TestCase):
    def test_dotted_codes(self):
        m = LiveScoreTennisScraper._map_status
        self.assertEqual(m("W.O.", 2), "walkover")   # was read as "live"
        self.assertEqual(m("Ret.", 2), "retired")
        self.assertEqual(m("Canc.", 3), "cancelled")
        self.assertEqual(m("Postp.", 4), "postponed")
        self.assertEqual(m("FT", 2), "finished")
        self.assertEqual(m("NS", 0), "scheduled")
        self.assertEqual(m("S2", 1), "live")
        self.assertEqual(m("W/O"), "walkover")

    def test_merge_only_moves_forward(self):
        from python.src.tennis.scraper.pipeline import _STATUS_RANK as R
        self.assertGreater(R["cancelled"], R["scheduled"])
        self.assertGreater(R["finished"], R["live"])
        self.assertGreater(R["walkover"], R["scheduled"])
        self.assertFalse(R["scheduled"] > R["finished"])


class TennisCycleTests(unittest.TestCase):
    """Settlement cycle with fake DB and feeds: a cancelled or long-'live' match is voided, never left pending."""

    def _run(self, comp_status, hours_ago):
        from unittest import mock
        from python.src.tennis import settlement as st

        kickoff = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
        item = {"id": "p1", "fixture_id": "f1", "market": "match_winner", "prediction": "A To Win",
                "target_kickoff_at": kickoff, "secondary_predictions": [],
                "fixture": {"id": "f1", "status": "live", "target_kickoff_at": kickoff, "canonical_key": "ATP:x:a-b:1",
                            "tournament": {"tour": "ATP"}, "metadata": {}}}
        calls = {"fixture": [], "settle": [], "params": None}

        class _Resp:
            def raise_for_status(self):
                return None

            def json(self):
                return [item]

        class _Client:
            def get(self, path, params=None):
                calls["params"] = params
                return _Resp()

        class _Db:
            client = _Client()

            def update_fixture_score(self, fid, upd):
                calls["fixture"].append(upd)

            def settle_prediction(self, **kw):
                calls["settle"].append(kw)

        class _Feed:
            def fetch_scoreboard(self, **kw):
                return {"x": 1}

            def parse_settlement_results_from_scoreboard(self, raw, tour):
                return [{"status": comp_status}]

            def close(self):
                return None

        eng = st.TennisSettlementEngine(db_client=_Db())
        with mock.patch.object(st, "LiveScoreTennisScraper", lambda: _Feed()), \
             mock.patch.object(st.TennisFixtureMatcher, "match", staticmethod(lambda f, c: True)), \
             mock.patch.object(st.TennisFixtureMatcher, "align_scores",
                               staticmethod(lambda f, c: {"status": comp_status, "score_p1_sets": 0, "score_p2_sets": 0,
                                                          "set_scores": [], "winner_id": None, "retired_player_id": None,
                                                          "was_retired": False, "was_walkover": False})):
            stats = eng.run_precision_settlement_cycle(lookback_hours=48, scraper=_Feed())
        return stats, calls

    def test_window_is_at_least_14_days(self):
        _, calls = self._run("cancelled", 50)
        start = datetime.fromisoformat(calls["params"]["target_kickoff_at"][4:])
        self.assertLess(start, datetime.now(timezone.utc) - timedelta(days=13))

    def test_cancelled_is_voided_after_36h(self):
        stats, calls = self._run("cancelled", 50)
        self.assertEqual(stats["void"], 1)
        self.assertEqual(calls["settle"][0]["status"], "void")
        self.assertEqual(calls["fixture"][0]["status"], "cancelled")

    def test_cancelled_recent_waits(self):
        stats, calls = self._run("cancelled", 10)
        self.assertEqual(stats["void"], 0)
        self.assertEqual(calls["settle"], [])

    def test_long_live_is_closed(self):
        stats, calls = self._run("live", 80)
        self.assertEqual(stats["void"], 1)
        self.assertEqual(calls["fixture"][0]["status"], "cancelled")

    def test_recent_live_is_just_updated(self):
        stats, calls = self._run("live", 2)
        self.assertEqual(stats["void"], 0)
        self.assertEqual(calls["fixture"][0]["status"], "live")
