"""
JamBets — Executive Live Score Scraper & Prediction Settlement Runner
Ingests real-time and completed match feeds from LiveScore and ESPN across all
registered domestic and international competitions, synchronizes live match
states in Cloud Supabase, and deterministically settles published predictions.
"""

import os
import sys
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

# Ensure workspace root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.football.settlement_scheduler import SettlementScheduler


def main():
    parser = argparse.ArgumentParser(
        description="JamBets Live Score Scraper & Deterministic Prediction Settlement Engine"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        default=True,
        help="Force immediate execution, bypassing slot lock deduplication"
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run continuously on the 15-minute Lagos WAT schedule"
    )
    parser.add_argument(
        "--slot",
        type=int,
        default=None,
        help="Override specific 15-minute slot index (0-95)"
    )

    args = parser.parse_args()

    print("==================================================================")
    print(" JamBets — Production Live Score Scraper & Settlement Engine")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print(f" Mode:      {'DAEMON (15-Minute Intervals)' if args.daemon else 'ON-DEMAND RUN'}")
    print("==================================================================")

    supabase = CloudSupabaseClient()
    scheduler = SettlementScheduler(supabase_client=supabase)

    if args.daemon:
        print("\n[DAEMON] Starting continuous 15-minute settlement loop...")
        while True:
            try:
                metrics = scheduler.run_settlement_cycle(slot_override=args.slot, force=args.force)
                print(f"[DAEMON] Cycle finished. Sleeping until next 15-minute boundary...")
            except Exception as e:
                print(f"[DAEMON ERROR] Unexpected failure in settlement cycle: {e}")
            time.sleep(300)  # Check every 5 minutes
    else:
        print("\n[STEP 1] Executing immediate settlement cycle across all competitions...")
        metrics = scheduler.run_settlement_cycle(slot_override=args.slot, force=args.force)

        print("\n==================================================================")
        print(" Settlement Cycle Summary:")
        print("==================================================================")
        print(f" Status:                  {metrics.get('status', 'COMPLETED')}")
        print(f" Fixtures Inspected:      {metrics.get('fixtures_inspected', 0)}")
        print(f" Live Fixtures Active:    {metrics.get('fixtures_live', 0)}")
        print(f" Finished Fixtures FT:    {metrics.get('fixtures_finished', 0)}")
        print(f" Predictions Evaluated:   {metrics.get('predictions_inspected', 0)}")
        print(f" Predictions Settled:     {metrics.get('predictions_settled', 0)}")
        print(f"   • Verified WON:        {metrics.get('settled_won', 0)}")
        print(f"   • Verified LOST:       {metrics.get('settled_lost', 0)}")
        print(f"   • Voided / Protected:  {metrics.get('settled_void', 0)}")
        print(f" Predictions Pending:     {metrics.get('predictions_pending', 0)}")
        print(f" Conflicts Detected:      {metrics.get('conflicts_detected', 0)}")
        print(f" Execution Duration:      {metrics.get('duration_ms', 0)}ms")
        print("==================================================================")


if __name__ == "__main__":
    main()
