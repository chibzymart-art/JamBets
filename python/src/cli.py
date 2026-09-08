"""
JamBets — Football Data Acquisition CLI
Entry point for running acquisition jobs, listing configured leagues, and verifying data.
"""

import os
import sys
import json
from datetime import datetime, timezone
from pathlib import Path

# Ensure workspace root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from python.src.config import LEAGUE_REGISTRY
from python.src.football.pipeline import AcquisitionPipeline


def main():
    print("==================================================================")
    print(" JamBets — Football Data Acquisition Runner")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("==================================================================")

    # Display configured leagues count
    print(f"\n[INFO] Configured Competitions in Registry: {len(LEAGUE_REGISTRY)}")
    for code, league in list(LEAGUE_REGISTRY.items())[:10]:
        print(f"  • [{code}] {league.name} ({league.country}) - Tier {league.tier}")
    print(f"  ... and {len(LEAGUE_REGISTRY) - 10} more competitions.")

    # Initialize Pipeline
    print("\n[INFO] Initializing Acquisition Pipeline with Cloud Supabase...")
    pipeline = AcquisitionPipeline()

    # Sync and acquire from representative leagues (Major + Smaller)
    sample_leagues = ["ENG_PL", "ESP_LL", "ITA_SA", "GER_BL", "FRA_L1", "EUR_CL", "ENG_CH", "NED_ED", "USA_MLS", "BRA_SA"]
    print(f"\n[INFO] Running live acquisition for {len(sample_leagues)} active leagues...")
    metrics = pipeline.run_acquisition(leagues=sample_leagues)

    print("\n------------------------------------------------------------------")
    print(" Pipeline Execution Metrics:")
    print("------------------------------------------------------------------")
    for k, v in metrics.items():
        print(f"  {k:30}: {v}")
    print("==================================================================")


if __name__ == "__main__":
    main()
