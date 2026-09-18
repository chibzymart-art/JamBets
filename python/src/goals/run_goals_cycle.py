"""
Addsbanta — Goals Specialist Cycle Runner
CLI and worker orchestrator to generate and settle goals predictions.
"""

import sys
import os
import argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.goals.over25_engine import Over25GoalsEngine
from python.src.goals.ht_over05_engine import HtOver05GoalsEngine
from python.src.goals.goals_settlement import GoalsSettlementEngine

def run_cycle(predict: bool = True, settle: bool = True, wipe_pending: bool = False):
    print(f"\n⚡ ========================================================")
    print(f"⚡ JamBets Goals Specialist Engine Cycle — {datetime.now(timezone.utc).isoformat()}")
    print(f"⚡ ========================================================\n")

    results = {}

    if predict:
        print("--- 1. RUNNING REBUILT OVER 2.5 GOALS PREDICTION PASS ---")
        p_res = Over25GoalsEngine().run(wipe_pending=wipe_pending)
        results["prediction_over25"] = p_res

        print("\n--- 2. RUNNING STANDALONE 1H OVER 0.5 GOALS BLITZ PASS ---")
        ht_res = HtOver05GoalsEngine().run(wipe_pending=wipe_pending)
        results["prediction_ht05"] = ht_res

    if settle:
        print("\n--- 3. RUNNING GOALS SETTLEMENT PASS ---")
        s_res = GoalsSettlementEngine().settle()
        results["settlement"] = s_res

    print("\n🏁 Goals Specialist Cycle Completed Successfully.\n")
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Addsbanta Goals Specialist Engine")
    parser.add_argument("--predict-only", action="store_true", help="Run only predictions pass")
    parser.add_argument("--settle-only", action="store_true", help="Run only settlement pass")
    parser.add_argument("--wipe-pending", action="store_true", help="Wipe and recalculate pending predictions")
    args = parser.parse_args()

    do_predict = not args.settle_only
    do_settle = not args.predict_only

    run_cycle(predict=do_predict, settle=do_settle, wipe_pending=args.wipe_pending)
