"""
Addsbanta — Email Engine Unit & Integration Test Suite
Verifies template rendering, relay pool quota enforcement, failover, and local dispatching.
"""

import sys
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))
sys.path.insert(0, str(root_dir / "python" / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from python.src.email_engine.templates import render_email_template, TEMPLATE_MAP
from python.src.email_engine.relay_pool import SmartRelayPool, BaseRelay, RelayResult


class MockLimitRelay(BaseRelay):
    def __init__(self, provider_id: str, limit: int, should_fail: bool = False):
        self.provider_id = provider_id
        self.daily_limit = limit
        self.should_fail = should_fail
        self.sent_calls = 0

    def is_configured(self) -> bool:
        return True

    def send(self, to_email: str, subject: str, html_body: str, plain_body=None, sender_name="Addsbanta") -> RelayResult:
        if self.should_fail:
            return RelayResult(success=False, provider_id=self.provider_id, message="Simulated network failure", error="MockNetworkError")
        self.sent_calls += 1
        return RelayResult(success=True, provider_id=self.provider_id, message=f"Delivered via {self.provider_id}")


def test_template_rendering():
    print("\n--- TEST 1: Template Rendering ---")
    sample_context = {
        "display_name": "Alex",
        "banker_match": "Arsenal vs Chelsea",
        "banker_league": "Premier League",
        "banker_market": "Over 2.5 Goals",
        "banker_confidence": "85%",
        "banker_odds": "1.74",
        "win_rate": "84.2%",
        "date_title": "Saturday Matchday"
    }

    for slug in TEMPLATE_MAP:
        subject, html = render_email_template(slug, sample_context, unsubscribe_token="tok_test_123")
        assert len(subject) > 5, f"Subject too short for {slug}"
        assert len(html) > 500, f"HTML too short for {slug}"
        assert "Adds" in html and "banta" in html, f"Branding missing in {slug}"
        assert "tok_test_123" in html, f"Unsubscribe token missing in {slug}"
        assert "18+" in html, f"Responsible gambling disclaimer missing in {slug}"
        print(f"  [PASS] {slug} rendered successfully ({len(html)} bytes)")


def test_relay_pool_quota_rotation():
    print("\n--- TEST 2: Quota Rotation (1,000+ Email Scaling) ---")
    pool = SmartRelayPool(dry_run=True)
    pool.relays.clear()

    # Provider 1: limit 2
    r1 = MockLimitRelay("relay_one", limit=2)
    # Provider 2: limit 3
    r2 = MockLimitRelay("relay_two", limit=3)
    pool.relays.extend([r1, r2])

    # Send 1 -> should use relay_one
    res1 = pool.dispatch("u1@test.com", "Subj 1", "<p>Hi</p>")
    assert res1.provider_id == "relay_one", f"Expected relay_one, got {res1.provider_id}"

    # Send 2 -> should use relay_one (reaches limit 2)
    res2 = pool.dispatch("u2@test.com", "Subj 2", "<p>Hi</p>")
    assert res2.provider_id == "relay_one", f"Expected relay_one, got {res2.provider_id}"

    # Send 3 -> relay_one exhausted! Should automatically rotate to relay_two!
    res3 = pool.dispatch("u3@test.com", "Subj 3", "<p>Hi</p>")
    assert res3.provider_id == "relay_two", f"Expected rotation to relay_two, got {res3.provider_id}"

    print(f"  [PASS] Automatic rotation verified: relay_one (sent={r1.sent_calls}/2) -> rotated to relay_two (sent={r2.sent_calls}/3)")


def test_relay_pool_failover():
    print("\n--- TEST 3: Failover on Connection Outage ---")
    pool = SmartRelayPool(dry_run=True)
    pool.relays.clear()

    # Faulty relay
    bad_relay = MockLimitRelay("broken_relay", limit=100, should_fail=True)
    # Healthy relay
    healthy_relay = MockLimitRelay("backup_relay", limit=100, should_fail=False)
    pool.relays.extend([bad_relay, healthy_relay])

    res = pool.dispatch("test@example.com", "Important", "<p>Hello</p>")
    assert res.success is True, "Dispatch should succeed via failover"
    assert res.provider_id == "backup_relay", f"Expected backup_relay, got {res.provider_id}"
    print("  [PASS] Failover from faulty provider to backup provider successful!")


if __name__ == "__main__":
    test_template_rendering()
    test_relay_pool_quota_rotation()
    test_relay_pool_failover()
    print("\nALL EMAIL ENGINE TESTS PASSED! Localhost build verified.")
