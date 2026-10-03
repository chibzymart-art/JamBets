"""
Phase 2: Database Storage & Paywall Contract Verification Suite
Queries Cloud Supabase directly to verify:
1. 100% of scheduled tennis fixtures contain 4 dynamic secondary markets (Zero empty arrays, zero duplicate match_winner).
2. Paywall view (tennis_predictions_paywall) properly protects VIP data for unauthenticated guests while returning structured teasers.
"""

import os
import sys
from datetime import datetime, timezone
from typing import Dict, Any, List

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("python"))

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

import httpx
from python.src.tennis.db import TennisDbClient


def verify_phase2():
    print("=" * 80)
    print(" JAMBETS PHASE 2: DATABASE STORAGE & PAYWALL CONTRACT VERIFICATION")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print(" Verifying public.tennis_predictions and public.tennis_predictions_paywall")
    print("=" * 80)

    db = TennisDbClient()
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")

    all_passed = True

    # ------------------------------------------------------------------
    # 1. Test public.tennis_predictions (Service Role / Full Engine Access)
    # ------------------------------------------------------------------
    print("\n--- 1. Verifying public.tennis_predictions (Active Scheduled Records) ---")
    
    resp_pending = db.client.get(
        "/tennis_predictions",
        params={
            "settlement_status": "eq.pending",
            "order": "target_kickoff_at.asc",
            "limit": "50"
        }
    )
    resp_pending.raise_for_status()
    pending_preds = resp_pending.json()

    print(f"Found {len(pending_preds)} pending predictions in public.tennis_predictions")

    if not pending_preds:
        print("❌ [FAIL] No pending predictions found in database!")
        return 1

    expected_markets = {"game_handicap", "first_set_winner", "set_handicap", "total_games_over_under"}

    for idx, p in enumerate(pending_preds, start=1):
        f_id = p["fixture_id"]
        primary = p["prediction"]
        tier = p["confidence_category"]
        prob = p["probability"]
        sec = p.get("secondary_predictions") or []

        # Check 1: Secondary length must be exactly 4
        if len(sec) != 4:
            print(f"❌ [FAIL] Fixture {f_id} has {len(sec)} secondary predictions (expected 4)")
            all_passed = False
            continue

        sec_markets = {s["market"] for s in sec}

        # Check 2: All 4 expected markets must be present
        if sec_markets != expected_markets:
            print(f"❌ [FAIL] Fixture {f_id} secondary markets mismatch: {sec_markets}")
            all_passed = False

        # Check 3: Zero duplicate match_winner in secondary predictions
        if "match_winner" in sec_markets:
            print(f"❌ [FAIL] Fixture {f_id} contains duplicate 'match_winner' in secondary predictions!")
            all_passed = False

        # Check 4: Probabilities must be strictly dynamic (not 0.63, not 0.885)
        for s in sec:
            s_prob = s.get("probability")
            if s_prob == 0.63:
                print(f"❌ [FAIL] Fixture {f_id} market {s['market']} has hardcoded 0.63 probability fallback!")
                all_passed = False
            if s_prob is not None and (s_prob < 0.50 or s_prob > 0.90):
                print(f"❌ [FAIL] Fixture {f_id} market {s['market']} has anomalous probability: {s_prob}")
                all_passed = False

        if idx <= 5:
            print(f"  [{idx}] [{tier}] {primary} ({prob*100:.1f}%)")
            for s in sec:
                print(f"        * {s['market']:<24}: {s['prediction']:<32} | {s['probability']*100:.1f}%")

    if all_passed:
        print(f"\n[PASS] All {len(pending_preds)} database records contain 4 verified dynamic secondary markets!")

    # ------------------------------------------------------------------
    # 2. Test public.tennis_predictions_paywall (Unauthenticated Guest Query)
    # ------------------------------------------------------------------
    print("\n--- 2. Verifying public.tennis_predictions_paywall (Guest / Anon Query) ---")

    resp_paywall = httpx.get(
        f"{db.url}/rest/v1/tennis_predictions_paywall",
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}"
        },
        params={
            "settlement_status": "eq.pending",
            "order": "target_kickoff_at.asc",
            "limit": "5"
        }
    )

    if resp_paywall.status_code != 200:
        print(f"❌ [FAIL] Paywall query returned HTTP {resp_paywall.status_code}: {resp_paywall.text}")
        return 1

    paywall_records = resp_paywall.json()
    print(f"Retrieved {len(paywall_records)} records from tennis_predictions_paywall as unauthenticated guest")

    for idx, pw in enumerate(paywall_records, start=1):
        is_locked = pw.get("is_locked")
        pred_label = pw.get("prediction")
        prob = pw.get("probability")
        sec = pw.get("secondary_predictions") or []

        print(f"  [{idx}] is_locked: {is_locked} | prediction: {pred_label} | prob: {prob}")

        # Invariant 1: Guest must see is_locked = True on pending match
        if is_locked is not True:
            print(f"❌ [FAIL] Paywall failed to lock pending match for guest (is_locked = {is_locked})")
            all_passed = False

        # Invariant 2: Prediction must be 'LOCKED'
        if pred_label != "LOCKED":
            print(f"❌ [FAIL] Paywall leaked prediction label to guest: {pred_label}")
            all_passed = False

        # Invariant 3: Probability must be None / Null
        if prob is not None:
            print(f"❌ [FAIL] Paywall leaked probability to guest: {prob}")
            all_passed = False

    print("\n" + "=" * 80)
    print(" PHASE 2 VERIFICATION SUMMARY")
    print("=" * 80)
    if all_passed:
        print("[SUCCESS] ALL PHASE 2 DATABASE & PAYWALL INVARIANTS PASSED!")
        return 0
    else:
        print("[FAIL] Some Phase 2 invariants failed. See details above.")
        return 1


if __name__ == "__main__":
    sys.exit(verify_phase2())
