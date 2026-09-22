"""
Oddsbanta — Autonomous Precision Tennis Settlement Engine Runner
Phase 2: Autonomous Settlement Core & Standalone Runner

Features:
- Scrapes and settles ONLY current fixtures within [now - lookback_hours, now + 30m]
- Rejects old historical or distant future fixtures
- Uses multi-factor precision matcher (Exact ESPN competition ID, Date/Time proximity, Canonical Slugs, Tournaments)
- Updates live match states (in-play) and settles completed/retired/walkover matches
- Standalone CLI execution or continuous 3-hour autonomous daemon mode

Usage:
  python -m python.src.tennis.run_tennis_settlement
  python -m python.src.tennis.run_tennis_settlement --lookback-hours 72
  python -m python.src.tennis.run_tennis_settlement --dry-run
  python -m python.src.tennis.run_tennis_settlement --daemon --interval-hours 3
"""

import sys
import time
import signal
import logging
import argparse
from pathlib import Path
from datetime import datetime, timezone

# Ensure workspace root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "python") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "python"))

from python.src.tennis.db import TennisDbClient
from python.src.tennis.settlement import TennisSettlementEngine
from python.src.alerts.email_notifier import send_pipeline_failure_alert

logger = logging.getLogger("tennis.settlement.runner")


def run_settlement(lookback_hours: int = 48, dry_run: bool = False) -> dict:
    """
    Executes a single precision settlement cycle.
    """
    db = TennisDbClient()
    engine = TennisSettlementEngine(db_client=db)
    return engine.run_precision_settlement_cycle(lookback_hours=lookback_hours, dry_run=dry_run)


def main():
    parser = argparse.ArgumentParser(
        description="Oddsbanta Autonomous Tennis Precision Settlement Engine Runner"
    )
    parser.add_argument(
        "--lookback-hours",
        type=int,
        default=48,
        help="Active settlement kickoff lookback window in hours (default: 48)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate settlement without mutating database"
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run continuously on a 3-hour interval schedule"
    )
    parser.add_argument(
        "--interval-hours",
        type=int,
        default=3,
        help="Loop interval in hours when running as daemon (default: 3)"
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] [TENNIS-SETTLEMENT] %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)]
    )

    print("==================================================================")
    print(" Oddsbanta — Autonomous Tennis Precision Settlement Engine")
    print(f" Timestamp:      {datetime.now(timezone.utc).isoformat()}")
    print(f" Mode:           {'DAEMON (3-Hour Schedule)' if args.daemon else 'ON-DEMAND RUN'}")
    print(f" Lookback Window: Last {args.lookback_hours} hours (Current Fixtures Only)")
    print(f" Dry Run:        {args.dry_run}")
    print("==================================================================")

    if args.daemon:
        interval_seconds = args.interval_hours * 3600
        print(f"\n[DAEMON] Starting autonomous tennis settlement loop (every {args.interval_hours} hours)...")

        running = True

        def _handle_exit(sig, frame):
            nonlocal running
            print("\n[DAEMON] Shutdown signal received. Exiting cleanly...")
            running = False

        signal.signal(signal.SIGINT, _handle_exit)
        signal.signal(signal.SIGTERM, _handle_exit)

        while running:
            try:
                print(f"\n[CYCLE] Executing settlement cycle at {datetime.now(timezone.utc).isoformat()}...")
                stats = run_settlement(lookback_hours=args.lookback_hours, dry_run=args.dry_run)
                print(f"[CYCLE FINISHED] Settlement Stats: {stats}")
            except Exception as e:
                print(f"[DAEMON ERROR] Settlement cycle failed: {e}", file=sys.stderr)
                logger.error("Daemon cycle exception: %s", e, exc_info=True)

            print(f"[DAEMON] Sleeping for {args.interval_hours} hours ({interval_seconds}s) until next cycle...")
            for _ in range(interval_seconds):
                if not running:
                    break
                time.sleep(1)

        print("[DAEMON] Stopped cleanly.")
    else:
        print("\n[RUN] Executing immediate precision settlement cycle...")
        start_t = time.time()
        stats = run_settlement(lookback_hours=args.lookback_hours, dry_run=args.dry_run)
        duration_ms = round((time.time() - start_t) * 1000, 1)

        print("\n==================================================================")
        print(" Tennis Settlement Cycle Summary:")
        print("==================================================================")
        print(f" Current Fixtures Inspected:  {stats.get('inspected', 0)}")
        print(f" Live Scoreboards Matched:    {stats.get('matched', 0)}")
        print(f" Active In-Play Live Matches: {stats.get('live_updated', 0)}")
        print(f" Predictions Settled:         {stats.get('settled', 0)}")
        print(f"   • Verified WON:            {stats.get('won', 0)}")
        print(f"   • Verified LOST:           {stats.get('lost', 0)}")
        print(f"   • Voided / Edge Case:      {stats.get('void', 0)}")
        print(f" Still Pending / Scheduled:   {stats.get('unsettled_pending', 0)}")
        print(f" Execution Duration:          {duration_ms}ms")
        print("==================================================================")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n[CRITICAL ERROR] Tennis Settlement Engine Failed: {e}", file=sys.stderr)
        try:
            send_pipeline_failure_alert(
                pipeline_name="Tennis Precision Settlement Engine",
                error=e,
                context={"timestamp": datetime.now(timezone.utc).isoformat()}
            )
        except Exception:
            pass
        sys.exit(1)
