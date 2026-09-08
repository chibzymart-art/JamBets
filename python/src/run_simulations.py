"""
JamBets — Standalone Phase 5 Monte Carlo Simulation Engine Runner
Executes per-fixture 250,000 Monte Carlo simulation runs on eligible fixtures in Cloud Supabase.
"""

import sys
import os

# Force UTF-8 on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from python.src.config import LEAGUE_REGISTRY
from python.src.football.historical_dataset import HistoricalDatasetBuilder
from python.src.football.prematch_features import PreMatchFeatureEngine
from python.src.football.prediction_models import DixonColesModel
from python.src.football.simulation_pipeline import SimulationPipeline
from python.src.db.supabase_client import CloudSupabaseClient


def run():
    print("==================================================================")
    print(" JamBets — Phase 5: Per-Fixture 250,000 Monte Carlo Simulation Runner")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("==================================================================")

    supabase = CloudSupabaseClient()
    dataset = HistoricalDatasetBuilder()

    # 1. Acquire genuine historical football dataset
    print("\n[STEP 1] Ingesting verified historical matches from ESPN API...", flush=True)
    hist_configs = [
        ("ENG_PL", ["20240519", "20240513", "20240504", "20240427", "20240421", "20240414", "20240406", "20240403", "20240330", "20240317", "20240310", "20240302"]),
        ("BEL_PL", ["20240526", "20240519", "20240513", "20240505", "20240428", "20240424", "20240421", "20240414", "20240407", "20240401", "20240317", "20240310"]),
        ("NED_ED", ["20240519", "20240512", "20240505", "20240428", "20240414", "20240407", "20240330", "20240317", "20240310", "20240303", "20240225", "20240218"]),
        ("ESP_LL", ["20240526", "20240519", "20240515", "20240512", "20240505", "20240428", "20240421", "20240414"]),
        ("ITA_SA", ["20240526", "20240519", "20240512", "20240505", "20240428", "20240421", "20240414"]),
        ("GER_BL", ["20240518", "20240511", "20240504", "20240427", "20240420", "20240413"]),
        ("FRA_L1", ["20240519", "20240512", "20240503", "20240428", "20240424", "20240421"]),
        ("EUR_CL", ["20240601", "20240508", "20240501", "20240417", "20240416", "20240410", "20240409", "20240313", "20240312"])
    ]

    total_hist = 0
    for l_code, dates in hist_configs:
        count = dataset.fetch_historical_from_espn(l_code, dates)
        total_hist += count
        print(f"  • [{l_code}] Ingested {count} verified matches", flush=True)

    print(f"[INFO] Historical dataset contains {len(dataset.matches)} verified matches", flush=True)

    # 2. Calibrate Model
    print("\n[STEP 2] Calibrating Dixon-Coles model & estimating rho parameter...", flush=True)
    model = DixonColesModel()
    estimated_rho = model.estimate_rho(dataset.matches)
    print(f"  [OK] Estimated rho: {estimated_rho} (dynamic, not hardcoded)", flush=True)

    # 3. Initialize Feature Engine & Pipeline
    feature_engine = PreMatchFeatureEngine(dataset=dataset)
    pipeline = SimulationPipeline(model=model, supabase=supabase)

    # 4. Fetch Prediction Queue Fixtures
    print("\n[STEP 3] Fetching candidate fixtures from Cloud Supabase prediction queue...", flush=True)
    fixtures = supabase.get_prediction_queue(limit=25)
    print(f"  • Retrieved {len(fixtures)} candidate fixtures", flush=True)

    # 5. Execute Per-Fixture 250,000 Monte Carlo Simulation Runs
    print("\n[STEP 4] Executing isolated per-fixture 250,000 Monte Carlo simulations...", flush=True)
    completed_sims = 0
    not_ready_count = 0
    total_qualifying = 0

    for idx, f in enumerate(fixtures, 1):
        f_id = f.get("id")
        canonical_key = f.get("canonical_key")
        l_code = f.get("league_code")
        h_team = f.get("home_team_name")
        a_team = f.get("away_team_name")
        kickoff_str = f.get("target_kickoff_at")
        kickoff = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00"))

        print(f"\n--- [{idx}/{len(fixtures)}] Fixture: {h_team} vs {a_team} ({l_code}) ---", flush=True)
        print(f"    Canonical Key: {canonical_key}", flush=True)
        print(f"    Kickoff: {kickoff.isoformat()}", flush=True)

        # Feature Extraction with Zero Leakage
        features = feature_engine.extract_features(
            fixture_id=f_id,
            canonical_key=canonical_key,
            league_code=l_code,
            home_team_canonical=h_team,
            away_team_canonical=a_team,
            prediction_cutoff=kickoff
        )

        if not features.is_ready:
            not_ready_count += 1
            print(f"    [GATE] NOT_READY: {features.not_ready_reason}", flush=True)
            print("    [RESULT] 0 simulations executed, 0 predictions published", flush=True)
            continue

        # Execute Phase 5 Simulation Pipeline
        res = pipeline.process_fixture_simulation(
            fixture_id=f_id,
            canonical_key=canonical_key,
            features=features,
            kickoff_utc=kickoff,
            persist_to_supabase=True
        )

        if res.status == "PUBLISHED":
            completed_sims += 1
            sim = res.simulation_result
            total_qualifying += len(res.qualifying_predictions)
            print(f"    [STATUS] COMPLETED: Exactly {sim.completed_simulations:,} iterations in {sim.duration_ms:.1f}ms", flush=True)
            print(f"    [JOB ID] {sim.job.simulation_job_id} | RNG: {sim.job.rng_algorithm} | Seed: {sim.job.seed}", flush=True)
            print(f"    [SANITY] Mutually exclusive sums: 1X2={sim.sanity_report.sum_1x2}%, BTTS={sim.sanity_report.sum_btts}% (Valid: {sim.sanity_report.is_valid})", flush=True)
            print(f"    [HALF-TIME] 1H Avg Goals: {sim.first_half_avg_goals}, 2H Avg Goals: {sim.second_half_avg_goals}", flush=True)
            print(f"    [QUALIFYING] {len(res.qualifying_predictions)} markets published (>=45.00%):", flush=True)
            for q in res.qualifying_predictions:
                print(f"      • [{q.confidence_tier:15}] {q.market_name:15} -> {q.outcome:12} : {q.probability_pct:.2f}%", flush=True)

        elif res.status == "SIMULATION_FAILED":
            print(f"    [GATE] SIMULATION FAILED: {res.not_ready_reason}", flush=True)
        else:
            print(f"    [STATUS] {res.status}", flush=True)

    print("\n==================================================================", flush=True)
    print(" Phase 5 Monte Carlo Simulation Execution Summary:", flush=True)
    print(f"  • Total Candidate Fixtures Evaluated: {len(fixtures)}", flush=True)
    print(f"  • Completed 250,000 Simulation Jobs: {completed_sims}", flush=True)
    print(f"  • Total Simulated Draws: {completed_sims * 250000:,}", flush=True)
    print(f"  • NOT_READY (Zero Leakage/Data Gate): {not_ready_count}", flush=True)
    print(f"  • Total Published Markets (>=45%): {total_qualifying}", flush=True)
    print("==================================================================", flush=True)


if __name__ == "__main__":
    run()
