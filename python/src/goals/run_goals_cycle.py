"""
JamBets — Goals Specialist Cycle Runner
CLI and worker orchestrator to generate and settle goals predictions.
"""

import sys
import os
import argparse
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.goals.goals_engine import GoalsEngine
from python.src.goals.goals_settlement import GoalsSettlementEngine

def run_cycle(predict: bool = True, settle: bool = True):
    print(f"\n⚡ ========================================================")
    print(f"⚡ JamBets Goals Specialist Engine Cycle — {datetime.now(timezone.utc).isoformat()}")
    print(f"⚡ ========================================================\n")

    results = {}

    if predict:
        print("--- 1. RUNNING GOALS PREDICTION PASS ---")
        p_res = GoalsEngine().run()
        results["prediction"] = p_res

    if settle:
        print("\n--- 2. RUNNING GOALS SETTLEMENT PASS ---")
        s_res = GoalsSettlementEngine().settle()
        results["settlement"] = s_res

    print("\n🏁 Goals Specialist Cycle Completed Successfully.\n")
    return results

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="JamBets Goals Specialist Engine")
    parser.add_argument("--predict-only", action="store_true", help="Run only predictions pass")
    parser.add_argument("--settle-only", action="store_true", help="Run only settlement pass")
    args = parser.parse_args()

    do_predict = not args.settle_only
    do_settle = not args.predict_only

    run_cycle(predict=do_predict, settle=do_settle)
