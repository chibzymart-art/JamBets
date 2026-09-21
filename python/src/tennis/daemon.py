"""
Oddsbanta — Autonomous Tennis Live Ingestion Daemon
Phase 2: Independent Dynamic Live Tennis Scraper Daemon

Runs as an autonomous, self-healing background daemon:
1. Syncs official ATP and WTA player rankings & surface ELO ratings
2. Continuously monitors live scoreboards, match progressions, and completed results
3. Automatically maps court speed (CPI) and match conditions
4. Isolated persistence directly into public.tennis_* tables in Supabase

Invariant: ZERO football imports or engine cross-talk. Runs completely isolated.
"""

import sys
import time
import signal
import random
import logging
import argparse
from typing import Optional

from .db import TennisDbClient
from .scraper.pipeline import TennisIngestionPipeline

# Configure Dedicated Tennis Logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [TENNIS-DAEMON] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("tennis.daemon")


class TennisScraperDaemon:
    """
    Autonomous background worker managing tennis data acquisition.
    """

    def __init__(self, interval_seconds: int = 300):
        self.interval = interval_seconds
        self.running = True
        self.db = TennisDbClient()
        self.pipeline = TennisIngestionPipeline(db_client=self.db)
        from .prediction_engine import TennisPredictionEngine
        self.predictor = TennisPredictionEngine(db_client=self.db)
        from .settlement import TennisSettlementEngine
        self.settler = TennisSettlementEngine(db_client=self.db)

        # Register OS signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._handle_exit)
        signal.signal(signal.SIGTERM, self._handle_exit)

    def _handle_exit(self, signum, frame):
        logger.info("Termination signal received. Shutting down Tennis Scraper Daemon...")
        self.running = False

    def run_cycle(self, sync_rankings: bool = True, date_str: Optional[str] = None, run_predictions: bool = True, run_settlement: bool = True):
        """
        Executes a complete synchronization, settlement, and prediction cycle.
        """
        start_t = time.time()
        logger.info("=== Starting Autonomous Tennis Sync, Settlement & Prediction Cycle ===")

        try:
            # 1. Sync Rankings (ATP & WTA)
            if sync_rankings:
                logger.info("Fetching and updating ATP/WTA rankings...")
                synced_players = self.pipeline.sync_player_rankings(tours=["atp", "wta"])
                logger.info("Rankings sync complete: %d players updated.", synced_players)

            # 2. Sync Scoreboards & Live/Completed Fixtures
            logger.info("Fetching ATP/WTA live scoreboards and matches...")
            stats = self.pipeline.sync_live_scoreboard(tours=["atp", "wta"], date_str=date_str)
            logger.info("Scoreboard sync complete: %s", stats)

            # 3. Audit and Settle Completed Matches
            if run_settlement:
                logger.info("Auditing and settling completed tennis predictions...")
                settle_stats = self.settler.run_settlement_cycle()
                logger.info("Settlement audit complete: %s", settle_stats)

            # 4. Generate Predictions for Scheduled Fixtures
            if run_predictions:
                logger.info("Executing Hierarchical Markov & Monte Carlo Prediction Engine...")
                pred_stats = self.predictor.generate_all_predictions()
                logger.info("Prediction generation complete: %s", pred_stats)

            duration = round(time.time() - start_t, 2)
            logger.info("=== Tennis Cycle Finished Successfully in %ss ===", duration)
        except Exception as e:
            logger.error("Exception during Tennis Cycle: %s", e, exc_info=True)

    def start(self, sync_rankings_on_start: bool = True):
        """
        Starts the continuous daemon loop with jitter.
        """
        logger.info("Starting Tennis Scraper Daemon (Loop Interval: %ds)...", self.interval)
        
        # Initial cycle with rankings
        self.run_cycle(sync_rankings=sync_rankings_on_start)

        cycle_count = 0
        while self.running:
            # Sleep with slight random jitter to prevent rigid traffic spikes
            jitter = random.randint(-10, 10)
            sleep_time = max(30, self.interval + jitter)
            logger.info("Sleeping for %d seconds until next sync cycle...", sleep_time)

            sleep_steps = sleep_time
            while sleep_steps > 0 and self.running:
                time.sleep(1)
                sleep_steps -= 1

            if not self.running:
                break

            cycle_count += 1
            # Refresh rankings every 12 cycles (~1 hour if interval is 300s)
            refresh_rankings = (cycle_count % 12 == 0)
            self.run_cycle(sync_rankings=refresh_rankings)

        logger.info("Tennis Scraper Daemon terminated cleanly.")
        self.pipeline.close()


def main():
    parser = argparse.ArgumentParser(description="Oddsbanta Autonomous Tennis Scraper Daemon")
    parser.add_argument("--once", action="store_true", help="Run a single sync cycle and exit immediately")
    parser.add_argument("--interval", type=int, default=300, help="Loop interval in seconds (default: 300)")
    parser.add_argument("--sync-players", action="store_true", help="Force synchronization of ATP/WTA player rankings")
    parser.add_argument("--dates", type=str, default=None, help="Target specific scoreboard dates (format: YYYYMMDD)")
    args = parser.parse_args()

    daemon = TennisScraperDaemon(interval_seconds=args.interval)

    if args.once:
        daemon.run_cycle(sync_rankings=args.sync_players or True, date_str=args.dates)
    else:
        daemon.start(sync_rankings_on_start=args.sync_players or True)


if __name__ == "__main__":
    main()
