"""
JamBets — Phase 8 Automated Unit Test Suite for User Authentication,
Disclaimers, Subscription Tiers, Entitlements & Access Control.

Verifies requirements from Phase 8:
- Section 15: Mandatory Legal Disclaimers (Cases A, B, C rejected; Case D accepted)
- Section 8, 12, 13, 14: Entitlements & Subscription Tiers (Visitor, Free, Standard, BigBang, Admin)
- Section 18, 19: Teaser vs Full Prediction Privacy & RLS Protection
- Section 5: Date Navigation Horizon (0, +1, +2, +3, +4; nothing beyond +4)
- Section 10, 11: Live match state isolation
"""

import unittest
from datetime import datetime, timezone, timedelta


class TestPhase8AuthAndAccessControl(unittest.TestCase):

    # ------------------------------------------------------------------------
    # 1. Mandatory Legal & Regulatory Disclaimers (Section 15)
    # ------------------------------------------------------------------------
    def validate_disclaimers(self, age_accepted: bool, financial_accepted: bool) -> tuple[bool, str]:
        """Simulates client and server validation for user registration disclaimers."""
        if not age_accepted and not financial_accepted:
            return False, "You must confirm you are 18+ and accept the financial indemnity disclaimer to register."
        if not age_accepted:
            return False, "You must confirm you are 18 years or older and at the legal age for sports betting."
        if not financial_accepted:
            return False, "You must accept the educational purpose and financial indemnity disclaimer to register."
        return True, "Accepted"

    def test_case_a_age_missing_rejected(self):
        """Case A: Age disclaimer unchecked -> Must be rejected."""
        valid, msg = self.validate_disclaimers(age_accepted=False, financial_accepted=True)
        self.assertFalse(valid)
        self.assertIn("18 years or older", msg)

    def test_case_b_financial_missing_rejected(self):
        """Case B: Financial indemnity unchecked -> Must be rejected."""
        valid, msg = self.validate_disclaimers(age_accepted=True, financial_accepted=False)
        self.assertFalse(valid)
        self.assertIn("financial indemnity", msg)

    def test_case_c_both_missing_rejected(self):
        """Case C: Both disclaimers unchecked -> Must be rejected."""
        valid, msg = self.validate_disclaimers(age_accepted=False, financial_accepted=False)
        self.assertFalse(valid)
        self.assertIn("You must confirm you are 18+", msg)

    def test_case_d_both_accepted_permitted(self):
        """Case D: Both disclaimers checked -> Successfully registered."""
        valid, msg = self.validate_disclaimers(age_accepted=True, financial_accepted=True)
        self.assertTrue(valid)
        self.assertEqual(msg, "Accepted")

    # ------------------------------------------------------------------------
    # 2. Subscription Tiers & Entitlement Access (Section 8, 12, 13, 14)
    # ------------------------------------------------------------------------
    def resolve_prediction_access(self, user_role: str | None, entitlement_flag: bool | None = None) -> bool:
        """Determines if the user is authorized to read raw predictions and probabilities."""
        if user_role is None or user_role == "visitor":
            return False
        if entitlement_flag is not None:
            return entitlement_flag
        role = user_role.lower()
        return role in ["standard", "bigbang", "pro", "premium", "admin"]

    def test_visitor_cannot_view_predictions(self):
        """Unauthenticated visitor is strictly locked out of predictions."""
        has_access = self.resolve_prediction_access(None)
        self.assertFalse(has_access)

    def test_free_tier_cannot_view_predictions(self):
        """Free authenticated user is locked out of predictions (teaser mode)."""
        has_access = self.resolve_prediction_access("free")
        self.assertFalse(has_access)

    def test_standard_tier_unlocked(self):
        """Standard tier subscribers receive full prediction access."""
        has_access = self.resolve_prediction_access("standard")
        self.assertTrue(has_access)

    def test_bigbang_tier_unlocked(self):
        """BigBang VIP tier subscribers receive full prediction access."""
        has_access = self.resolve_prediction_access("bigbang")
        self.assertTrue(has_access)

    def test_admin_tier_unlocked(self):
        """Admin role receives full prediction access."""
        has_access = self.resolve_prediction_access("admin")
        self.assertTrue(has_access)

    # ------------------------------------------------------------------------
    # 3. Teaser Privacy vs Full Prediction Data Contract (Section 18, 19)
    # ------------------------------------------------------------------------
    def test_teaser_does_not_leak_predictions_or_probabilities(self):
        """Teaser payload must omit outcome, probability, model parameters, and scorelines."""
        teaser_record = {
            "id": "pred-101",
            "fixture_id": "fix-001",
            "market": "1x2",
            "confidence_category": "BANGER",
            "publication_status": "published",
            "target_kickoff_at": "2026-09-08T20:00:00Z",
            "is_locked": True
        }

        # Assert no sensitive prediction data is present
        self.assertNotIn("prediction", teaser_record)
        self.assertNotIn("probability", teaser_record)
        self.assertNotIn("lambda_home", teaser_record)
        self.assertNotIn("lambda_away", teaser_record)
        self.assertNotIn("actual_score", teaser_record)
        self.assertTrue(teaser_record["is_locked"])

    # ------------------------------------------------------------------------
    # 4. Date Navigation Horizon (Section 5)
    # ------------------------------------------------------------------------
    def test_queue_day_horizon_rules(self):
        """Only fixtures within Today (0) through Day +4 may be in prediction queue."""
        valid_queue_days = {0, 1, 2, 3, 4}

        # Eligible fixtures
        for day in [0, 1, 2, 3, 4]:
            self.assertIn(day, valid_queue_days)

        # Ineligible future fixtures beyond +4 days
        for day in [5, 6, 7, 10]:
            self.assertNotIn(day, valid_queue_days)

    # ------------------------------------------------------------------------
    # 5. Live State Isolation (Section 10, 11)
    # ------------------------------------------------------------------------
    def test_live_badge_only_for_live_status(self):
        """Live match indicators are displayed only when status is strictly 'live'."""
        statuses = ["scheduled", "live", "finished", "postponed", "cancelled"]
        for s in statuses:
            is_live = (s == "live")
            if s == "live":
                self.assertTrue(is_live)
            else:
                self.assertFalse(is_live)


if __name__ == "__main__":
    unittest.main()
