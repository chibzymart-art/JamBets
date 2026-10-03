"""
Phase 2: Repopulate public.tennis_predictions with Dynamic Calibrated Predictions
Runs the updated Hierarchical Markov + 250,000 Monte Carlo prediction engine
across all scheduled and active tennis fixtures in Supabase.
"""

import os
import sys
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("python"))

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from python.src.tennis.db import TennisDbClient
from python.src.tennis.prediction_engine import TennisPredictionEngine


def repopulate_predictions():
    print("=" * 80)
    print(" JAMBETS PHASE 2: BATCH TENNIS PREDICTION REPOPULATION")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print(" 250,000 Monte Carlo Iterations per Match | 100% Dynamic Real Data")
    print("=" * 80)

    db = TennisDbClient()
    engine = TennisPredictionEngine(db_client=db, simulations_count=250000)

    # Query all scheduled fixtures (including those within past 24h to catch rain delays)
    resp = db.client.get(
        "/tennis_fixtures",
        params={
            "status": "in.(scheduled,live)",
            "select": "*,tournament:tennis_tournaments(*),player1:tennis_players!tennis_fixtures_player1_id_fkey(*),player2:tennis_players!tennis_fixtures_player2_id_fkey(*)",
            "order": "target_kickoff_at.asc",
            "limit": "150"
        }
    )
    resp.raise_for_status()
    fixtures = resp.json()

    print(f"\n[QUERY] Found {len(fixtures)} active scheduled fixtures eligible for prediction update.\n")

    stats = {
        "total": len(fixtures),
        "updated": 0,
        "failed": 0,
        "bangers": 0,
        "top_picks": 0,
        "mid_conf": 0,
        "no_safe_bankers": 0
    }

    audit_records = []

    for idx, fix in enumerate(fixtures, start=1):
        f_id = fix["id"]
        t_name = (fix.get("tournament") or {}).get("name", "Unknown Tournament")
        p1 = (fix.get("player1") or {}).get("display_name", "P1")
        p2 = (fix.get("player2") or {}).get("display_name", "P2")
        kickoff = fix.get("target_kickoff_at")

        print(f"[{idx}/{len(fixtures)}] Simulating: {p1} vs {p2} ({t_name})...", end=" ", flush=True)

        try:
            pred = engine.generate_prediction_for_fixture(fix)
            if not pred:
                print("❌ Skipped (missing player data)")
                stats["failed"] += 1
                continue

            # Save to Cloud Supabase
            saved = db.save_prediction(pred)
            stats["updated"] += 1

            tier = pred["confidence_category"]
            if tier == "BANGER":
                stats["bangers"] += 1
            elif tier == "TOP PICK":
                stats["top_picks"] += 1
            elif tier == "MID CONFIDENCE":
                stats["mid_conf"] += 1
            elif tier == "NO_SAFE_BANKER":
                stats["no_safe_bankers"] += 1

            sec_preds = pred["secondary_predictions"]
            sec_summary = ", ".join([f"{s['market']}={s['prediction']} ({s['probability']*100:.1f}%)" for s in sec_preds])

            print(f"✅ [{tier}] {pred['prediction']} ({pred['probability']*100:.1f}%)")
            print(f"     Secondary: {sec_summary}")

            audit_records.append({
                "fixture_id": f_id,
                "match": f"{p1} vs {p2}",
                "tournament": t_name,
                "tier": tier,
                "primary": f"{pred['prediction']} ({pred['probability']*100:.1f}%)",
                "secondary_count": len(sec_preds),
                "secondary_markets": [s["market"] for s in sec_preds]
            })

        except Exception as e:
            print(f"❌ Error: {e}")
            stats["failed"] += 1

    print("\n" + "=" * 80)
    print(" PHASE 2 EXECUTION SUMMARY")
    print("=" * 80)
    print(f" Total Fixtures Processed:  {stats['total']}")
    print(f" Successfully Saved to DB:  {stats['updated']}")
    print(f" Failed / Skipped:          {stats['failed']}")
    print(f" Tier Breakdown:")
    print(f"   - BANGERS (85%+):        {stats['bangers']}")
    print(f"   - TOP PICKS:             {stats['top_picks']}")
    print(f"   - MID CONFIDENCE:        {stats['mid_conf']}")
    print(f"   - NO SAFE BANKERS:       {stats['no_safe_bankers']}")
    print("=" * 80)

    # Invariant Verification
    all_valid = True
    for r in audit_records:
        if r["secondary_count"] != 4:
            print(f"❌ Invariant Violation: Fixture {r['fixture_id']} has {r['secondary_count']} secondary markets")
            all_valid = False
        if "match_winner" in r["secondary_markets"]:
            print(f"❌ Invariant Violation: Fixture {r['fixture_id']} contains duplicate match_winner in secondary predictions")
            all_valid = False

    if all_valid and stats["updated"] > 0:
        print("\n[SUCCESS] 100% of updated fixtures contain 4 dynamic secondary markets with zero duplicate match_winner!")
        return 0
    else:
        print("\n[WARNING] Review violations or errors above.")
        return 1 if not all_valid else 0


if __name__ == "__main__":
    sys.exit(repopulate_predictions())
