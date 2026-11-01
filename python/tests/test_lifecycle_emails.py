import unittest
from datetime import datetime, timedelta, timezone

from python.src.email_engine import lifecycle as lc
from python.src.email_engine.lifecycle_templates import render

NOW = datetime(2026, 11, 1, 6, 0, tzinfo=timezone.utc)


def iso(dt):
    return dt.isoformat()


def user(uid="u1", created=NOW - timedelta(days=30), role="user", **kw):
    return {"id": uid, "email": f"{uid}@example.com", "role": role, "created_at": iso(created), "status": "active", **kw}


def sub(uid="u1", tier="standard", status="active", end=None, bachs=None, cancel=False):
    return {"user_id": uid, "tier": tier, "status": status, "current_period_end": iso(end) if end else None,
            "bachs_subscription_id": bachs, "cancel_at_period_end": cancel}


def due(u, subs=(), ents=()):
    return lc.lifecycle_campaign(u, lc.plan_state(u, subs, ents), NOW)


class LifecycleCampaignTests(unittest.TestCase):
    def test_trial_ending_and_ended(self):
        self.assertEqual(due(user(created=NOW - timedelta(days=2, hours=1)))[0], "trial_ending")
        self.assertEqual(due(user(created=NOW - timedelta(days=3, hours=1)))[0], "trial_ended")
        self.assertIsNone(due(user(created=NOW - timedelta(days=1))))  # mid-trial: nothing

    def test_trial_reminders_skip_payers(self):
        u = user(created=NOW - timedelta(days=2, hours=1))
        self.assertIsNone(due(u, [sub(end=NOW + timedelta(days=20))]))

    def test_renewal_due_only_when_not_auto_renewing(self):
        end = NOW + timedelta(days=2)
        c = due(user(), [sub(end=end)])
        self.assertEqual(c[0], "renewal_due")
        self.assertEqual(c[1], end.date().isoformat())
        self.assertIsNone(due(user(), [sub(end=end, bachs="sub_1")]))
        self.assertEqual(due(user(), [sub(end=end, bachs="sub_1", cancel=True)])[0], "renewal_due")

    def test_plan_expired_then_winback(self):
        self.assertEqual(due(user(), [sub(end=NOW - timedelta(hours=10))])[0], "plan_expired")
        self.assertIsNone(due(user(), [sub(end=NOW - timedelta(days=4))]))
        self.assertEqual(due(user(), [sub(end=NOW - timedelta(days=7, hours=3))])[0], "winback")
        # A lapsed payer never gets trial reminders.
        self.assertIsNone(due(user(created=NOW - timedelta(days=3, hours=1)), [sub(end=NOW - timedelta(days=4))]))

    def test_past_due(self):
        self.assertEqual(due(user(), [sub(status="past_due", end=NOW + timedelta(days=1), bachs="s")])[0], "payment_failed")

    def test_entitlement_dates_count(self):
        u = user(role="bigbang")  # admin_allocate_user_tier writes role + dated entitlement
        c = due(u, [], [{"user_id": "u1", "tier": "bigbang", "valid_until": iso(NOW + timedelta(days=1))}])
        self.assertEqual(c[0], "renewal_due")
        self.assertIn("BigBang", c[2]["plan_name"])

    def test_open_ended_roles_get_no_reminders(self):
        self.assertIsNone(due(user(role="admin", created=NOW - timedelta(days=3, hours=1))))
        self.assertIsNone(due(user(role="standard", created=NOW - timedelta(days=3, hours=1))))


class PlanSendsTests(unittest.TestCase):
    results = ("2026-10-31", {"date_label": "Saturday 31 October", "won": 4, "lost": 2, "top_won": 1, "top_lost": 0,
                              "products": [{"label": "Football main picks", "won": 4, "lost": 2}]})

    def plan(self, users, prefs=None, already=None, results=None, campaigns=None):
        return lc.plan_sends(NOW, users, [], [], prefs or {}, already or set(), results or self.results,
                             campaigns or set(lc.ALL_CAMPAIGNS))

    def test_reminders_come_before_daily(self):
        out = self.plan([user("a"), user("b", created=NOW - timedelta(days=2, hours=1))])
        self.assertEqual([o.campaign for o in out], ["trial_ending", "daily_results", "daily_results"])

    def test_opt_outs(self):
        prefs = {"a": {"unsubscribed_all_at": iso(NOW)}, "b": {"daily_results": False},
                 "c": {"lifecycle": False}}
        users = [user("a"), user("b"), user("c", created=NOW - timedelta(days=2, hours=1))]
        out = self.plan(users, prefs)
        self.assertEqual({(o.user_id, o.campaign) for o in out}, {("c", "daily_results")})

    def test_already_sent_is_skipped(self):
        out = self.plan([user("a")], already={("a", "daily_results", "2026-10-31")})
        self.assertEqual(out, [])

    def test_daily_needs_minimum_settled(self):
        thin = ("2026-10-31", {**self.results[1], "won": 2, "lost": 1})
        self.assertEqual(self.plan([user("a")], results=thin), [])

    def test_deleted_users_skipped(self):
        self.assertEqual(self.plan([user("a", is_deleted=True)]), [])

    def test_access_flag_for_cta(self):
        out = self.plan([user("a"), user("b", created=NOW - timedelta(days=1))])
        flags = {o.user_id: o.ctx["has_access"] for o in out if o.campaign == "daily_results"}
        self.assertEqual(flags, {"a": False, "b": True})


class ResultsTests(unittest.TestCase):
    def test_window_is_yesterday_in_wat(self):
        start, end, key = lc.results_window(datetime(2026, 11, 1, 5, 0, tzinfo=timezone.utc))
        self.assertEqual(key, "2026-10-31")
        self.assertEqual(start, datetime(2026, 10, 30, 23, 0, tzinfo=timezone.utc))
        self.assertEqual(end, datetime(2026, 10, 31, 23, 0, tzinfo=timezone.utc))

    def test_summary_counts_and_top_tier(self):
        start, _, _ = lc.results_window(NOW)
        s = lc.summarise_results([
            ("Football", [{"settlement_status": "won", "probability": 0.85}, {"settlement_status": "lost", "probability": 0.62},
                          {"settlement_status": "void", "probability": 0.9}]),
            ("Goals", [{"settlement_status": "won", "probability": 0.7}]),
        ], start)
        self.assertEqual((s["won"], s["lost"], s["top_won"], s["top_lost"]), (2, 1, 1, 0))


class TemplateTests(unittest.TestCase):
    def ctx(self, **kw):
        return {"name": "<b>Eve</b>", **lc.PRICES, "unsubscribe_url": "https://www.oddsbanta.com/api/unsubscribe?token=t&scope=daily",
                "plan_name": "Standard", "period_end_label": "Monday 2 November", "trial_end_label": "Monday 2 November", **kw}

    def test_every_campaign_renders_escaped_with_unsubscribe(self):
        results = {"date_label": "Saturday 31 October", "won": 3, "lost": 2, "top_won": 0, "top_lost": 0,
                   "products": [{"label": "Football main picks", "won": 3, "lost": 2}]}
        for c in lc.ALL_CAMPAIGNS:
            subject, html, text = render(c, self.ctx(results=results))
            self.assertTrue(subject)
            self.assertNotIn("<b>Eve</b>", html, c)
            self.assertIn("&lt;b&gt;Eve&lt;/b&gt;", html, c)
            self.assertIn("api/unsubscribe?token=t", html.replace("&amp;", "&"), c)
            self.assertIn("not a bookmaker", text, c)
            self.assertNotIn("guaranteed", (subject + html).lower(), c)

    def test_daily_subject_has_real_numbers(self):
        results = {"date_label": "x", "won": 7, "lost": 3, "top_won": 0, "top_lost": 0, "products": []}
        subject, _, _ = render("daily_results", self.ctx(results=results))
        self.assertIn("7 of 10 won (70%)", subject)


if __name__ == "__main__":
    unittest.main()
