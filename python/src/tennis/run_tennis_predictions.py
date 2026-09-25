"""
Oddsbanta — Master Autonomous Tennis Prediction & Simulation Runner
Phase 1: Precision CLI Runner, Fresh Data Scraping & 4-Day Horizon

Features:
- Scrapes live ATP & WTA rankings and updates surface-specific Elo ratings
- Pulls live scoreboards across a rolling 4-day horizon (protecting the 2-day cadence off-day)
- Evaluates analytical Markov models & executes 250,000 Monte Carlo match simulations
- Categorizes high-conviction markets: Bangers (85%+), Top Picks (74%+), Moneyline, Set Handicap
- Decoupled settlement pass for recent 48-hour concluded matches
- Supports zero-mutation --dry-run mode for pre-flight testing and CI validation
- CLI runner or continuous 48-hour background daemon
"""

import sys
import time
import signal
import logging
import argparse
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Any, Optional

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
if str(PROJECT_ROOT / "python") not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT / "python"))

from python.src.tennis.db import TennisDbClient
from python.src.tennis.scraper.pipeline import TennisIngestionPipeline
from python.src.tennis.prediction_engine import TennisPredictionEngine
from python.src.tennis.settlement import TennisSettlementEngine
from python.src.alerts.email_notifier import send_pipeline_failure_alert

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [TENNIS-PREDICTIONS] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("tennis.predictions.runner")


def run_prediction_cycle(
    days_ahead: int = 4,
    simulations_count: int = 250000,
    sync_rankings: bool = True,
    dry_run: bool = False,
    run_settlement: bool = True
) -> Dict[str, Any]:
    """
    Executes a complete fresh-data scrape, Monte Carlo simulation, and settlement cycle.
    """
    start_t = time.time()
    db = TennisDbClient()
    pipeline = TennisIngestionPipeline(db_client=db)
    predictor = TennisPredictionEngine(db_client=db, simulations_count=simulations_count)
    settler = TennisSettlementEngine(db_client=db)

    mode_str = "DRY-RUN (Simulated, zero database mutations)" if dry_run else "LIVE (Cloud Supabase Active)"
    print("==================================================================")
    print(" Oddsbanta — Autonomous Tennis Prediction & Simulation Engine")
    print(f" Timestamp:        {datetime.now(timezone.utc).isoformat()}")
    print(f" Mode:             {mode_str}")
    print(f" Forward Horizon:  {days_ahead} Days (Covers 48-hour off-day)")
    print(f" MC Simulations:   {simulations_count:,} per match")
    print(f" Sync Rankings:    {sync_rankings}")
    print("==================================================================\n")

    summary = {
        "status": "success",
        "dry_run": dry_run,
        "players_synced": 0,
        "fixtures_synced": 0,
        "predictions_evaluated": 0,
        "predictions_published": 0,
        "bangers": 0,
        "top_picks": 0,
        "settlement_evaluated": 0,
        "settled": 0,
        "duration_seconds": 0.0
    }

    try:
        # 1. Fresh Data Scrape: Sync ATP & WTA Official Rankings & Surface Elos
        if sync_rankings:
            print("[STEP 1] Scraping fresh ATP & WTA rankings & calibrating surface Elos...", flush=True)
            synced_players = pipeline.sync_player_rankings(tours=["atp", "wta"], dry_run=dry_run)
            summary["players_synced"] = synced_players
            print(f"  [OK] Synchronized {synced_players} professional player profiles\n", flush=True)

        # 2. Ingest Rolling 4-Day Forward Scoreboards
        print(f"[STEP 2] Scraping live scoreboards for active tournament horizon (Next {days_ahead} days)...", flush=True)
        sync_stats = pipeline.sync_live_scoreboard(
            tours=["atp", "wta"],
            days_ahead=days_ahead,
            strict_upcoming_only=True,
            dry_run=dry_run
        )
        summary["fixtures_synced"] = sync_stats["fixtures_synced"]
        print(f"  [OK] Ingested {sync_stats['fixtures_synced']} upcoming scheduled singles fixtures", flush=True)
        print(f"  [OK] Concluded matches updated: {sync_stats['completed_updated']}\n", flush=True)

        # 3. Execute Markov & 250k Monte Carlo Predictions
        print(f"[STEP 3] Running Markov Chain analysis & {simulations_count:,} Monte Carlo match draws...", flush=True)
        fixtures_to_predict = sync_stats.get("fixtures") if dry_run else None
        pred_stats = predictor.generate_all_predictions(
            limit=500,
            fixtures=fixtures_to_predict,
            dry_run=dry_run
        )
        summary["predictions_evaluated"] = pred_stats["evaluated"]
        summary["predictions_published"] = pred_stats["published"]
        summary["bangers"] = pred_stats["bangers"]
        summary["top_picks"] = pred_stats["top_picks"]
        summary["no_safe_bankers"] = pred_stats["no_safe_bankers"]

        print(f"  [OK] Evaluated: {pred_stats['evaluated']} fixtures", flush=True)
        print(f"  [OK] Published: {pred_stats['published']} predictions", flush=True)
        print(f"  [OK] Bangers (85%+ / Elite): {pred_stats['bangers']}", flush=True)
        print(f"  [OK] Top Picks (74-84%):     {pred_stats['top_picks']}", flush=True)
        print(f"  [OK] No Safe Banker (Skip):  {pred_stats['no_safe_bankers']}\n", flush=True)

        # 4. Decoupled Settlement Audit Pass
        if run_settlement:
            print("[STEP 4] Running decoupled precision settlement pass on recent 48-hour fixtures...", flush=True)
            settle_res = settler.run_precision_settlement_cycle(lookback_hours=48, dry_run=dry_run)
            summary["settlement_evaluated"] = settle_res.get("pending_evaluated", 0)
            summary["settled"] = settle_res.get("settled", 0)
            summary["settlement_won"] = settle_res.get("won", 0)
            summary["settlement_lost"] = settle_res.get("lost", 0)
            summary["settlement_void"] = settle_res.get("void", 0)
            print(f"  [OK] Settlement evaluated: {settle_res.get('pending_evaluated', 0)}", flush=True)
            print(f"  [OK] Settled: {settle_res.get('settled', 0)} (Won: {settle_res.get('won', 0)}, Lost: {settle_res.get('lost', 0)}, Void: {settle_res.get('void', 0)})\n", flush=True)

        summary["duration_seconds"] = round(time.time() - start_t, 2)
        print("==================================================================")
        print(" Tennis Prediction Engine Cycle Complete")
        print(f" Total Duration:   {summary['duration_seconds']}s")
        print(f" Mode:             {mode_str}")
        print("==================================================================\n")

    except Exception as e:
        logger.error("Error during Tennis Prediction Engine execution: %s", e, exc_info=True)
        summary["status"] = "error"
        summary["error"] = str(e)
        if not dry_run:
            try:
                send_pipeline_failure_alert(
                    "Tennis Prediction Engine",
                    e,
                    {"days_ahead": days_ahead, "simulations": simulations_count}
                )
            except Exception as alert_err:
                logger.error("Failed to send failure email alert: %s", alert_err)

    finally:
        pipeline.close()
        db.close()

    return summary


def main():
    parser = argparse.ArgumentParser(
        description="Oddsbanta Master Autonomous Tennis Prediction & Simulation Engine Runner"
    )
    parser.add_argument(
        "--days-ahead",
        type=int,
        default=4,
        help="Forward horizon window in days to scrape and predict (default: 4)"
    )
    parser.add_argument(
        "--simulations",
        type=int,
        default=250000,
        help="Number of Monte Carlo simulations per match (default: 250000)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate entire pipeline without mutating Cloud Supabase"
    )
    parser.add_argument(
        "--skip-rankings",
        action="store_true",
        help="Skip scraping ATP/WTA rankings"
    )
    parser.add_argument(
        "--skip-settlement",
        action="store_true",
        help="Skip the settlement evaluation pass"
    )
    parser.add_argument(
        "--daemon",
        action="store_true",
        help="Run continuously in the background on an interval schedule"
    )
    parser.add_argument(
        "--interval-hours",
        type=int,
        default=48,
        help="Loop interval in hours when running as daemon (default: 48)"
    )

    args = parser.parse_args()

    if args.daemon:
        logger.info("Starting Tennis Prediction Engine Daemon (Loop Interval: %d hours)...", args.interval_hours)
        interval_seconds = args.interval_hours * 3600
        while True:
            run_prediction_cycle(
                days_ahead=args.days_ahead,
                simulations_count=args.simulations,
                sync_rankings=not args.skip_rankings,
                dry_run=args.dry_run,
                run_settlement=not args.skip_settlement
            )
            logger.info("Daemon sleeping for %d hours until next cycle...", args.interval_hours)
            time.sleep(interval_seconds)
    else:
        summary = run_prediction_cycle(
            days_ahead=args.days_ahead,
            simulations_count=args.simulations,
            sync_rankings=not args.skip_rankings,
            dry_run=args.dry_run,
            run_settlement=not args.skip_settlement
        )
        if summary.get("status") == "error":
            sys.exit(1)


if __name__ == "__main__":
    main()
