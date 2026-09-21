"""
Oddsbanta — Autonomous Tennis Predictor CLI
Phase 3: Hierarchical Markov-Chain & Monte Carlo Simulation Engine

CLI interface to execute the Prediction Engine on demand.
"""

import sys
import logging
import argparse
from datetime import datetime

from .prediction_engine import TennisPredictionEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [TENNIS-PREDICTOR] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("tennis.predict")


def main():
    parser = argparse.ArgumentParser(description="Oddsbanta Autonomous Tennis Prediction Engine")
    parser.add_argument("--limit", type=int, default=200, help="Max fixtures to analyze (default: 200)")
    parser.add_argument("--simulations", type=int, default=250000, help="Simulations count per match (default: 250000)")
    args = parser.parse_args()

    logger.info("Initializing Tennis Prediction Engine (%d Monte Carlo simulations per match)...", args.simulations)
    engine = TennisPredictionEngine(simulations_count=args.simulations)
    stats = engine.generate_all_predictions(limit=args.limit)

    logger.info("Prediction generation cycle completed successfully: %s", stats)


if __name__ == "__main__":
    main()
