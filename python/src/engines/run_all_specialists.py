"""
Oddsbanta — Master Runner for Decoupled Specialist Engines
Runs the 4 specialist mathematical engines and settlement pass in sequence:
1. Home Win Dominance Engine
2. Away Win Road Counter Engine
3. Draw Hunter Equilibrium Engine
4. Corners Specialist Engine
5. Specialist Settlements Pipeline
"""

import sys
import os
from datetime import datetime, timezone

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.engines.home_win_engine import HomeWinEngine
from python.src.engines.away_win_engine import AwayWinEngine
from python.src.engines.draw_engine import DrawEngine
from python.src.engines.corners_engine import CornersEngine
from python.src.engines.specialist_settlements import SpecialistSettlementPipeline


def run_all(predict: bool = True, settle: bool = True):
    print("=================================================================")
    print(" 🚀 Oddsbanta — Master Decoupled Specialist Engines Runner")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=================================================================\n")

    results = {}

    if predict:
        # 1. Home Win Engine
        print("--- Running Home Win Engine ---")
        hw_engine = HomeWinEngine()
        results["home_win"] = hw_engine.run()

        # 2. Away Win Engine
        print("\n--- Running Away Win Engine ---")
        aw_engine = AwayWinEngine()
        results["away_win"] = aw_engine.run()

        # 3. Draw Engine
        print("\n--- Running Draw Hunter Engine ---")
        draw_engine = DrawEngine()
        results["draw"] = draw_engine.run()

        # 4. Corners Engine
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

