"""
Oddsbanta — Autonomous Basketball Live Ingestion Daemon
Phase 2: Independent Dynamic Live Basketball Scraper Daemon

Runs as an autonomous, self-healing background worker:
1. Pre-seeds & syncs official basketball leagues (NBA, EuroLeague, WNBA, NCAA, ACB, NBL)
2. Monitors live scoreboards, match progressions, and completed results across ESPN & LiveScore
3. Automatically computes calendar rest days, B2B fatigue penalties, and altitude bonuses
4. Isolated persistence directly into public.basketball_* tables in Supabase

Invariant: ZERO football or tennis cross-talk. Runs completely isolated.
"""

import sys
import time
import signal
import logging
import argparse
from typing import Optional, List

from python.src.basketball.db import BasketballDbClient
from python.src.basketball.pipeline import BasketballIngestionPipeline

# Configure Dedicated Basketball Logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [BASKETBALL-DAEMON] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("basketball.daemon")


class BasketballScraperDaemon:
    """
    Autonomous background worker managing basketball data acquisition.
    """

    def __init__(self, interval_seconds: int = 300):
        self.interval = interval_seconds
        self.running = True
        self.db = BasketballDbClient()
        self.pipeline = BasketballIngestionPipeline(db_client=self.db)

        # Register OS signal handlers for graceful shutdown
        signal.signal(signal.SIGINT, self._handle_exit)
        signal.signal(signal.SIGTERM, self._handle_exit)

    def _handle_exit(self, signum, frame):
        logger.info("Termination signal received. Shutting down Basketball Scraper Daemon...")
        self.running = False

    def run_cycle(self, days_back: int = 1, days_forward: int = 3, target_leagues: Optional[List[str]] = None):
        """
        Executes a single data acquisition cycle.
        """
        logger.info("Starting basketball data acquisition cycle (horizon -%dd to +%dd)...", days_back, days_forward)
        try:
            summary = self.pipeline.ingest_horizon(
                days_back=days_back,
                days_forward=days_forward,
                target_leagues=target_leagues
            )
            logger.info("Acquisition cycle completed successfully: %s", summary)
            return summary
        except Exception as e:
            logger.error("Error during basketball acquisition cycle: %s", e)
            return {}

    def start(self):
        """
        Runs continuous loop with configured sleep interval.
        """
        logger.info("Starting Basketball Scraper Daemon (polling interval: %ds)...", self.interval)
        while self.running:
            self.run_cycle()
            if self.running:
                logger.info("Sleeping for %d seconds until next cycle...", self.interval)
                time.sleep(self.interval)

    def stop(self):
        self.running = False
        self.pipeline.close()
        self.db.close()


def main():
    parser = argparse.ArgumentParser(description="Oddsbanta Autonomous Basketball Scraper Daemon")
    parser.add_argument("--once", "--run-once", dest="once", action="store_true", help="Run a single acquisition cycle and exit")
    parser.add_argument("--days-back", type=int, default=1, help="Number of past days to check for scores")
    parser.add_argument("--days-forward", type=int, default=3, help="Number of forward days to schedule")
    parser.add_argument("--leagues", nargs="+", help="Specific league codes to ingest (e.g. NBA WNBA)")
    args = parser.parse_args()

    daemon = BasketballScraperDaemon()
    if args.once:
        daemon.run_cycle(days_back=args.days_back, days_forward=args.days_forward, target_leagues=args.leagues)
        daemon.stop()
    else:
        daemon.start()


if __name__ == "__main__":
    main()
