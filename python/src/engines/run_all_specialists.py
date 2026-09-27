"""
Oddsbanta — Master Runner for Decoupled Specialist Engines
Runs the specialist mathematical engines and settlement pass in sequence:
1. Corners Specialist Engine
2. Specialist Settlements Pipeline
"""

import sys
import os
from datetime import datetime, timezone

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.engines.corners_engine import CornersEngine
from python.src.engines.specialist_settlements import SpecialistSettlementPipeline


def run_all(predict: bool = True, settle: bool = True):
    print("=================================================================")
    print(" 🚀 Oddsbanta — Master Decoupled Specialist Engines Runner")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=================================================================\n")

    results = {}

    if predict:
        # Corners Specialist Engine
        print("\n--- Running Corners Specialist Engine ---")
        corners_engine = CornersEngine()
        results["corners"] = corners_engine.run()

    if settle:
        # 5. Settlement Pipeline
        print("\n--- Running Specialist Settlements Pipeline ---")
        settlement_pipe = SpecialistSettlementPipeline()
        results["settlements"] = settlement_pipe.settle_all()

    print("\n=================================================================")
    print(" ✅ All Specialist Prediction & Settlement Cycles Completed!")
    print(f" Summary: {results}")
    print("=================================================================")
    return results


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Oddsbanta Decoupled Specialist Engines Runner")
    parser.add_argument("--predict-only", action="store_true", help="Run only prediction engines (Home, Away, Draw, Corners)")
    parser.add_argument("--settle-only", action="store_true", help="Run only specialist settlement pipeline")
    args = parser.parse_args()

    do_predict = not args.settle_only
    do_settle = not args.predict_only

    run_all(predict=do_predict, settle=do_settle)

