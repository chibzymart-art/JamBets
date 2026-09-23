"""
Oddsbanta — Master Basketball Settlement & Audit Runner
Phase 4: Autonomous Settlement Daemon & CLI Runner

Features:
- Refreshes completed match scores from free public scoreboards (ESPN & LiveScore)
- Evaluates pending predictions across Moneyline, Point Spread, Totals, 1st Half
- Handles Overtime inclusion and 48-hour abandonment/postponement rules
- Writes immutable audit trail to public.basketball_settlements
- Updates public.basketball_predictions with won/lost/void outcome and notes
- Standalone CLI execution or continuous daemon loop with failure alerts
"""

import sys
import time
import signal
import logging
import argparse
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "python") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "python"))

from python.src.basketball.db import BasketballDbClient
from python.src.basketball.pipeline import BasketballIngestionPipeline
from python.src.basketball.settlement import BasketballSettlementEngine
from python.src.alerts.email_notifier import send_pipeline_failure_alert

logger = logging.getLogger("basketball.settlement.runner")


def run_settlement_cycle(
    lookback_hours: int = 48,
    dry_run: bool = False,
    refresh_scores: bool = True,
    predictions: Optional[list] = None
) -> dict:
    """
    Executes a complete basketball score refresh and settlement cycle.
    """
    db = BasketballDbClient()
    pipeline = BasketballIngestionPipeline(db_client=db)
    engine = BasketballSettlementEngine(db_client=db)

    # 1. Optionally refresh completed scores from live APIs
    if refresh_scores:
        try:
            logger.info("Refreshing recent completed basketball scores from ESPN & LiveScore...")
            pipeline.ingest_horizon(days_back=2, days_forward=0)
        except Exception as e:
            logger.warning("Scoreboard refresh encountered a non-fatal error: %s", e)

    # 2. Settle pending predictions
    logger.info("Executing settlement evaluation (lookback: %d hours, dry_run: %s)...", lookback_hours, dry_run)
    summary = engine.settle_pending_predictions(
        lookback_hours=lookback_hours,
        dry_run=dry_run,
        predictions=predictions
    )

    db.close()
    pipeline.close()
    return summary


def main():
    parser = argparse.ArgumentParser(
        description="Oddsbanta Autonomous Basketball Settlement & Audit Engine"
    )
    parser.add_argument(
        "--lookback-hours",
        type=int,
        default=48,
        help="Settlement lookback window in hours (default: 48)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate settlement without mutating Cloud Supabase"
    )
    parser.add_argument(
        "--no-refresh-scores",
        action="store_true",
        help="Skip scraping fresh scores before evaluating predictions"
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run continuously as a background daemon"
    )
    parser.add_argument(
        "--interval-minutes",
        type=int,
        default=15,
        help="Loop interval in minutes when running in daemon mode (default: 15)"
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] [BASKETBALL-SETTLEMENT] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)]
    )

    print("==================================================================")
    print(" Oddsbanta — Autonomous Basketball Settlement & Audit Engine")
    print(f" Timestamp:        {datetime.now(timezone.utc).isoformat()}")
    print(f" Mode:             {'DAEMON' if args.daemon else 'ON-DEMAND RUN'}")
    print(f" Lookback Window:  Last {args.lookback_hours} hours")
    print(f" Refresh Scores:   {not args.no_refresh_scores}")
    print(f" Dry Run:          {args.dry_run}")
    print("==================================================================")

    if args.daemon:
        interval_seconds = args.interval_minutes * 60
        print(f"\n[DAEMON] Starting basketball settlement daemon (every {args.interval_minutes} minutes)...")

        running = True

        def _handle_exit(sig, frame):
            nonlocal running
            print("\n[DAEMON] Shutdown signal received. Exiting gracefully...")
            running = False

        signal.signal(signal.SIGINT, _handle_exit)
        signal.signal(signal.SIGTERM, _handle_exit)

        cycle = 1
        while running:
            print(f"\n--- [Cycle #{cycle}] {datetime.now(timezone.utc).isoformat()} ---")
            try:
                summary = run_settlement_cycle(
                    lookback_hours=args.lookback_hours,
                    dry_run=args.dry_run,
                    refresh_scores=not args.no_refresh_scores
                )
                print(f"[Cycle #{cycle} Complete] Settled: {summary.get('settled', 0)} (Won: {summary.get('won', 0)}, Lost: {summary.get('lost', 0)}, Void: {summary.get('void', 0)})")
            except Exception as e:
                logger.error("Error in basketball settlement daemon cycle #%d: %s", cycle, e, exc_info=True)
                try:
                    send_pipeline_failure_alert(
                        "Basketball Settlement Daemon",
                        e,
                        {"cycle": cycle, "timestamp": datetime.now(timezone.utc).isoformat()}
                    )
                except Exception as alert_err:
                    logger.warning("Failed to send alert email: %s", alert_err)

            cycle += 1
            if running:
                time.sleep(interval_seconds)

        print("[DAEMON] Basketball settlement daemon stopped.")
    else:
        try:
            summary = run_settlement_cycle(
                lookback_hours=args.lookback_hours,
                dry_run=args.dry_run,
                refresh_scores=not args.no_refresh_scores
            )
            print("\n==================================================================")
            print(" Basketball Settlement Execution Summary:")
            print(f"   Evaluated: {summary.get('pending_evaluated', 0)}")
            print(f"   Settled:   {summary.get('settled', 0)}")
            print(f"   Won:       {summary.get('won', 0)}")
            print(f"   Lost:      {summary.get('lost', 0)}")
            print(f"   Void:      {summary.get('void', 0)}")
            print(f"   Dry Run:   {summary.get('dry_run', False)}")
            print("==================================================================")
        except Exception as e:
            logger.error("Fatal error during basketball settlement execution: %s", e, exc_info=True)
            try:
                send_pipeline_failure_alert(
                    "Basketball Settlement Runner",
                    e,
                    {"timestamp": datetime.now(timezone.utc).isoformat()}
                )
            except Exception as alert_err:
                logger.warning("Failed to send alert email: %s", alert_err)
            sys.exit(1)


if __name__ == "__main__":
    main()
