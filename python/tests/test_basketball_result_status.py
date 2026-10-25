"""
Basketball result status mapping and stale-fixture reconcile. Offline tests.
Status cases are the exact values LiveScore returned on 20-24 Oct 2026 for fixtures that got stuck.
"""
import unittest
from datetime import datetime, timedelta, timezone

from python.src.basketball.scrapers.livescore_scraper import livescore_status
from python.src.basketball.reconcile import decide


class BasketballStatusTests(unittest.TestCase):
    def test_live_score_progress_codes(self):
        self.assertEqual(livescore_status("OT", 2), "finished")     # finished after overtime (was stuck "live")
        self.assertEqual(livescore_status("FT", 2), "finished")
        self.assertEqual(livescore_status("Postp.", 4), "postponed")  # dot form (was stuck "scheduled")
        self.assertEqual(livescore_status("Canc.", 3), "cancelled")
        self.assertEqual(livescore_status("NS", 0), "scheduled")
        self.assertEqual(livescore_status("3Q", 1), "live")
        self.assertEqual(livescore_status("OT", 1), "live")           # overtime in progress

    def test_without_progress_code(self):
        self.assertEqual(livescore_status("FT"), "finished")
        self.assertEqual(livescore_status("AOT"), "finished")
        self.assertEqual(livescore_status("Postp."), "postponed")
        self.assertEqual(livescore_status("4Q"), "live")
        self.assertEqual(livescore_status("NS"), "scheduled")


NOW = datetime(2026, 10, 25, 10, 0, tzinfo=timezone.utc)


def _row(key, hours_ago, eid="1853673", src="livescore", status="live"):
    return {"id": "r1", "canonical_key": key, "status": status,
            "target_kickoff_at": (NOW - timedelta(hours=hours_ago)).isoformat(),
            "metadata": {"source": src, "provider_event_id": eid}}


class ReconcileDecisionTests(unittest.TestCase):
    def test_finished_in_feed_gets_final_score(self):
        feed = {"GER_BBL:MIB-MIN:20261024": {"canonical_key": "GER_BBL:MIB-MIN:20261024", "status": "finished",
                                              "home_score": 103, "away_score": 98, "current_period": "OT"}}
        upd = decide(_row("GER_BBL:MIB-MIN:20261024", 18), feed, {}, NOW)
        self.assertEqual(upd["status"], "finished")
        self.assertEqual((upd["home_score"], upd["away_score"]), (103, 98))
        self.assertEqual(upd["current_period"], "OT")
        self.assertEqual(upd["metadata"]["provider_event_id"], "1853673")  # existing metadata kept

    def test_moved_game_marks_old_row_postponed(self):
        new = {"canonical_key": "ESP_ACB:BAG-JOV:20261025", "status": "scheduled", "provider_event_id": "77", "source": "livescore"}
        upd = decide(_row("ESP_ACB:BAG-JOV:20261024", 16, eid="77", status="scheduled"), {}, {("livescore", "77"): new}, NOW)
        self.assertEqual(upd["status"], "postponed")
        self.assertEqual(upd["metadata"]["rescheduled_to"], "ESP_ACB:BAG-JOV:20261025")

    def test_same_event_finished_under_new_key_uses_real_result(self):
        new = {"canonical_key": "X:A-B:20261023", "status": "finished", "home_score": 80, "away_score": 70,
               "provider_event_id": "9", "source": "livescore"}
        upd = decide(_row("X:A-B:20261022", 30, eid="9"), {}, {("livescore", "9"): new}, NOW)
        self.assertEqual(upd["status"], "finished")
        self.assertEqual(upd["home_score"], 80)

    def test_not_found_waits_then_gives_up(self):
        self.assertIsNone(decide(_row("X:A-B:20261023", 40), {}, {}, NOW))
        upd = decide(_row("X:A-B:20261016", 9 * 24), {}, {}, NOW)
        self.assertEqual(upd["status"], "postponed")
        self.assertTrue(upd["metadata"]["unresolved"])

    def test_still_live_in_feed_is_left_alone(self):
        feed = {"K": {"canonical_key": "K", "status": "live"}}
        self.assertIsNone(decide(_row("K", 5), feed, {}, NOW))


if __name__ == "__main__":
    unittest.main()


