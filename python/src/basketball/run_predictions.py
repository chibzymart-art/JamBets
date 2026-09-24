"""
Oddsbanta — Master Basketball Prediction Runner
Phase 3: Automated 250,000 Monte Carlo Simulation Cycle

Fetches upcoming scheduled basketball fixtures, runs the 250,000 Monte Carlo pass,
and persists calibrated predictions to public.basketball_predictions.
"""

import sys
import logging
import argparse
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List

from python.src.basketball.db import BasketballDbClient
from python.src.basketball.models import BasketballFourFactors
from python.src.basketball.prediction_engine import BasketballPredictionEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [BASKETBALL-PREDICTIONS] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("basketball.run_predictions")


def run_basketball_predictions(days_forward: int = 3, num_sims: int = 250000) -> Dict[str, Any]:
    """
    Simulates and persists predictions for all upcoming fixtures.
    """
    db = BasketballDbClient()
    engine = BasketballPredictionEngine()

    now = datetime.now(timezone.utc)
    start_iso = now.isoformat()
    end_iso = (now + timedelta(days=days_forward)).isoformat()

    logger.info("Fetching upcoming basketball fixtures from %s to %s...", start_iso, end_iso)
    fixtures = db.get_upcoming_fixtures(start_iso, end_iso)
    logger.info("Found %d scheduled fixtures to evaluate", len(fixtures))

    total_evaluated = 0
    total_saved = 0
    tier_counts = {}

    for fix in fixtures:
        try:
            fix_id = fix["id"]
            league = fix.get("league", {})
            league_code = league.get("code", "NBA")

            home = fix.get("home_team", {})
            away = fix.get("away_team", {})

            home_name = home.get("canonical_name", "Home Team")
            away_name = away.get("canonical_name", "Away Team")

            home_pace = float(home.get("pace") or 99.5)
            away_pace = float(away.get("pace") or 99.5)

            home_ortg = float(home.get("offensive_rating") or 112.0)
            home_drtg = float(home.get("defensive_rating") or 112.0)
            away_ortg = float(away.get("offensive_rating") or 112.0)
            away_drtg = float(away.get("defensive_rating") or 112.0)

            # Four Factors
            home_ff_raw = home.get("four_factors") or {}
            away_ff_raw = away.get("four_factors") or {}

            home_ff = BasketballFourFactors(
                efg_pct=float(home_ff_raw.get("efg_pct", 0.535)),
                tov_pct=float(home_ff_raw.get("tov_pct", 0.125)),
                orb_pct=float(home_ff_raw.get("orb_pct", 0.250)),
                ftr=float(home_ff_raw.get("ftr", 0.220)),
            )
            away_ff = BasketballFourFactors(
                efg_pct=float(away_ff_raw.get("efg_pct", 0.535)),
                tov_pct=float(away_ff_raw.get("tov_pct", 0.125)),
                orb_pct=float(away_ff_raw.get("orb_pct", 0.250)),
                ftr=float(away_ff_raw.get("ftr", 0.220)),
            )

            # Rest & Fatigue
            home_rest = int(fix.get("home_rest_days") or 1)
            away_rest = int(fix.get("away_rest_days") or 1)
            is_home_b2b = bool(fix.get("is_home_b2b", False))
            is_away_b2b = bool(fix.get("is_away_b2b", False))

            # Market Lines
            spread = fix.get("market_spread")
            total = fix.get("market_total")
            home_ml = fix.get("home_moneyline_odds")
            away_ml = fix.get("away_moneyline_odds")

            target_dt = datetime.fromisoformat(fix["target_kickoff_at"].replace("Z", "+00:00"))

            # Run 250k Monte Carlo Simulation
            pred = engine.generate_prediction(
                fixture_id=fix_id,
                league_code=league_code,
                home_team_name=home_name,
                away_team_name=away_name,
                home_pace=home_pace,
                away_pace=away_pace,
                home_ortg=home_ortg,
                home_drtg=home_drtg,
                away_ortg=away_ortg,
                away_drtg=away_drtg,
                home_ff=home_ff,
                away_ff=away_ff,
                home_rest_days=home_rest,
                away_rest_days=away_rest,
                is_home_b2b=is_home_b2b,
                is_away_b2b=is_away_b2b,
                market_spread=float(spread) if spread is not None else None,
                market_total=float(total) if total is not None else None,
                home_ml_odds=float(home_ml) if home_ml is not None else None,
                away_ml_odds=float(away_ml) if away_ml is not None else None,
                target_kickoff_at=target_dt,
                num_simulations=num_sims
            )

            total_evaluated += 1
            tier_name = pred.confidence_category.value
            tier_counts[tier_name] = tier_counts.get(tier_name, 0) + 1

            # Prepare DB record
            pred_record = {
                "fixture_id": pred.fixture_id,
                "market": pred.market.value,
                "prediction": pred.prediction,
                "probability": pred.probability,
                "confidence_category": pred.confidence_category.value,
                "secondary_predictions": pred.secondary_predictions,
                "simulations_count": pred.simulations_count,
                "simulated_home_score": pred.simulated_home_score,
                "simulated_away_score": pred.simulated_away_score,
                "edge_percentage": pred.edge_percentage,
                "fair_odds": pred.fair_odds,
                "market_odds": pred.market_odds,
                "tier_required": pred.tier_required,
                "publication_status": pred.publication_status,
                "target_kickoff_at": pred.target_kickoff_at.isoformat(),
                "metadata": pred.metadata,
                "settlement_status": "pending",
            }

            res = db.save_prediction(pred_record)
            if res and "id" in res:
                total_saved += 1
                logger.info(
                    "Simulated %s vs %s -> %s (%s, %.1f%% Prob)",
                    home_name, away_name, pred.prediction, tier_name, pred.probability * 100.0
                )

        except Exception as e:
            logger.error("Failed to generate prediction for fixture %s: %s", fix.get("id"), e)
            continue

    summary = {
        "fixtures_found": len(fixtures),
        "total_evaluated": total_evaluated,
        "total_saved": total_saved,
        "tier_distribution": tier_counts
    }
    logger.info("Basketball Simulation Pass Completed: %s", summary)
    db.close()
    return summary


def main():
    parser = argparse.ArgumentParser(description="Oddsbanta Autonomous Basketball Prediction Runner")
    parser.add_argument("--days", "--days-forward", dest="days", type=int, default=3, help="Days forward to simulate")
    parser.add_argument("--sims", "--num-sims", dest="sims", type=int, default=250000, help="Number of Monte Carlo iterations per fixture")
    args = parser.parse_args()

    run_basketball_predictions(days_forward=args.days, num_sims=args.sims)


if __name__ == "__main__":
    main()
