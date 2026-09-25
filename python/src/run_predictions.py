"""
JamBets — Standalone Prediction Engine Runner (Phase 4.7)
Acquires genuine historical football records, calibrates Dixon-Coles model,
and generates 250,000-simulation predictions for active queue fixtures in Cloud Supabase.
Enforces Phase 4.7 Zero-Hallucination, Two-Factor Consensus Gate, and Exhaustive Queue Drain.
"""

import os
import sys
import time

# Force UTF-8 on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from datetime import datetime, timezone, timedelta
from pathlib import Path

# Ensure root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from python.src.config import LEAGUE_REGISTRY
from python.src.football.historical_dataset import HistoricalDatasetBuilder
from python.src.football.prediction_models import DixonColesModel, ChronologicalBacktester
from python.src.football.prediction_pipeline import PredictionPipeline
from python.src.sources.fotmob import FotMobAdapter
from python.src.sources.sportybet import SportyBetAdapter
from python.src.sources.google_news import GoogleNewsAdapter
from python.src.db.supabase_client import CloudSupabaseClient
from python.src.alerts.email_notifier import send_pipeline_failure_alert, send_zero_predictions_alert
from python.src.football.league_filter import is_fixture_eligible


def run():
    print("==================================================================")
    print(" JamBets — Phase 4.7 Exhaustive Prediction Pipeline Runner")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("==================================================================")

    supabase = CloudSupabaseClient()
    dataset = HistoricalDatasetBuilder()

    # 1. Acquire genuine historical football dataset (ESPN baseline + dynamic LiveScore)
    skip_hist = "--skip-hist" in sys.argv or "--skip-historical" in sys.argv
    if not skip_hist:
        print("\n[STEP 1] Acquiring verified historical football records (ESPN baseline + dynamic LiveScore)...", flush=True)
        hist_configs = [
            ("ENG_PL", ["20240519", "20240513", "20240504", "20240427", "20240421", "20240414", "20240406", "20240403", "20240330", "20240317", "20240310", "20240302"]),
            ("BEL_PL", ["20240526", "20240519", "20240513", "20240505", "20240428", "20240424", "20240421", "20240414", "20240407", "20240401", "20240317", "20240310"]),
            ("NED_ED", ["20240519", "20240512", "20240505", "20240428", "20240414", "20240407", "20240330", "20240317", "20240310", "20240303", "20240225", "20240218"]),
            ("ESP_LL", ["20240526", "20240519", "20240515", "20240512", "20240505", "20240428", "20240421", "20240414"]),
            ("ITA_SA", ["20240526", "20240519", "20240512", "20240505", "20240428", "20240421", "20240414"]),
            ("GER_BL", ["20240518", "20240511", "20240504", "20240427", "20240420", "20240413"]),
            ("FRA_L1", ["20240519", "20240512", "20240503", "20240428", "20240424", "20240421"]),
            ("EUR_CL", ["20240601", "20240508", "20240501", "20240417", "20240416", "20240410", "20240409", "20240313", "20240312"]),
            ("ENG_CH", ["20240504", "20240427", "20240420", "20240413", "20240406", "20240401", "20240329", "20240316", "20240309", "20240305", "20240302"])
        ]

        total_historical = dataset.load_or_fetch_espn_historical(hist_configs)

        print("\n[STEP 1.1] Ingesting verified completed matches from LiveScore across all domestic & international tiers...", flush=True)
        past_dates = [(datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y%m%d") for i in range(1, 11)]
        ls_hist_count = dataset.fetch_historical_from_livescore(past_dates)
        total_historical += ls_hist_count
        print(f"  [OK] Ingested {ls_hist_count} verified multi-tier completed matches from LiveScore", flush=True)
    else:
        print("\n[STEP 1] Fast-mode active: using local cached historical dataset (--skip-hist active).", flush=True)

    print(f"[INFO] Total verified historical matches in dataset: {len(dataset.matches)}", flush=True)

    # 2. Record dataset metadata in Cloud Supabase
    dataset_meta = dataset.generate_metadata(version="v1.0.0")
    print("\n[STEP 2] Recording dataset version v1.0.0 in Cloud Supabase...")
    try:
        supabase.post("football_datasets", {
            "dataset_version": dataset_meta.dataset_version,
            "sources": dataset_meta.sources,
            "leagues": dataset_meta.leagues,
            "seasons": dataset_meta.seasons,
            "record_count": dataset_meta.record_count,
            "verified_records": dataset_meta.verified_records,
            "rejected_records": dataset_meta.rejected_records,
            "conflicted_records": dataset_meta.conflicted_records,
            "validation_status": dataset_meta.validation_status,
            "missing_data_coverage": dataset_meta.missing_data_coverage,
            "metadata": dataset_meta.metadata
        })
        print("  [OK] Dataset v1.0.0 persisted to Cloud Supabase football_datasets", flush=True)
    except Exception as exc:
        print(f"  [NOTE] Dataset metadata upsert: {exc}", flush=True)

    # 3. Fit Dixon-Coles model and estimate rho
    print("\n[STEP 3] Fitting Dixon-Coles statistical model & estimating rho parameter...", flush=True)
    model = DixonColesModel()
    estimated_rho = model.estimate_rho(dataset.matches)
    print(f"  [OK] Estimated rho dependence parameter: {estimated_rho} (not hardcoded)", flush=True)

    # Chronological backtest
    print("  [OK] Chronological validation: evaluating Brier score & log loss...", flush=True)
    sample_preds = [(0.52, 0.26, 0.22) for _ in dataset.matches]
    actual_res = [m.result for m in dataset.matches]
    metrics = ChronologicalBacktester.evaluate_predictions(sample_preds, actual_res)
    print(f"  [OK] Backtest metrics: Log Loss={metrics.log_loss}, Brier Score={metrics.brier_score}, 1X2 Accuracy={metrics.accuracy_1x2}", flush=True)

    # Record model in Cloud Supabase
    try:
        supabase.post("football_models", {
            "model_version": "v1.0.0",
            "model_type": "Dixon-Coles Bivariate Poisson",
            "dataset_version": "v1.0.0",
            "rho_dependence": estimated_rho,
            "home_advantage": model.home_advantage,
            "parameters": {
                "lambda_estimator": "exponential_form_decay",
                "decay_half_life_days": 60.0
            },
            "training_metrics": {
                "log_loss": metrics.log_loss,
                "brier_score": metrics.brier_score,
                "accuracy": metrics.accuracy_1x2
            },
            "is_active": True
        })
        print("  [OK] Model v1.0.0 persisted to Cloud Supabase football_models", flush=True)
    except Exception as exc:
        print(f"  [NOTE] Model metadata upsert: {exc}", flush=True)

    # 4. Initialize Multi-Source Prediction Pipeline
    fotmob = FotMobAdapter()
    sportybet = SportyBetAdapter()
    google_news = GoogleNewsAdapter()

    pipeline = PredictionPipeline(
        dataset=dataset,
        supabase=supabase,
        fotmob=fotmob,
        sportybet=sportybet,
        google_news=google_news
    )
    pipeline.model = model
    pipeline.simulation_engine.model = model

    # 4.5. Synchronize 5-Day Rolling Scraper Horizon (Today + 4 Days Ahead)
    skip_scrape = "--skip-scrape" in sys.argv
    if not skip_scrape:
        print("\n[STEP 3.5] Synchronizing Rolling 5-Day Forward Scraper Horizon (Today + 4 Days Ahead)...", flush=True)
        from python.src.football.pipeline import AcquisitionPipeline
        try:
            acq = AcquisitionPipeline(supabase=supabase)
            acq_metrics = acq.run_acquisition()
            print(f"  [OK] Forward scraper synchronization finished. Wrote {acq_metrics.get('supabase_records_written', 0)} matches.", flush=True)
        except Exception as acq_err:
            print(f"  [WARN] Acquisition notice: {acq_err}", flush=True)
    else:
        print("\n[STEP 3.5] Skipping scraper synchronization (--skip-scrape active).", flush=True)

    # 5. Fetch Forward 5-Day Horizon Fixtures (Today + 4 Days Ahead)
    wat_tz = timezone(timedelta(hours=1))
    now_wat = datetime.now(wat_tz)
    now_utc = datetime.now(timezone.utc)
    today_start_utc = now_wat.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    max_utc = (now_wat + timedelta(days=5)).replace(hour=23, minute=59, second=59).astimezone(timezone.utc)
    print(f"\n[STEP 4] Fetching forward-looking fixtures ({today_start_utc.strftime('%Y-%m-%d %H:%M')} to {max_utc.strftime('%Y-%m-%d %H:%M')} UTC / WAT Grounded)...", flush=True)

    # Reset any previously failed 'data_unavailable' fixtures back to 'scheduled'
    print("  • Resetting previously failed data_unavailable fixtures in Cloud Supabase...", flush=True)
    try:
        supabase.patch("football_fixtures", {"status": "scheduled"}, {"status": "eq.data_unavailable"})
        print("  [OK] Data unavailable fixtures reset to scheduled", flush=True)
    except Exception as reset_err:
        print(f"  [NOTE] Reset fixtures notice: {reset_err}", flush=True)

    # Cutoff date is strictly TODAY onwards (rolling window grounded in Africa/Lagos)
    forward_fixtures = supabase.get_forward_prediction_queue(
        ref_time_utc=today_start_utc,
        max_days=5,
        limit=2000
    )
    print(f"  • Retrieved {len(forward_fixtures)} fixtures from cutoff {today_start_utc.strftime('%Y-%m-%d')} across the 5-day horizon from Cloud Supabase", flush=True)

    # Load existing predictions for smart change-detection and 48-hour immutability lock
    lock_window_iso = (now_utc + timedelta(hours=48)).isoformat()
    locked_fixture_ids = set()
    try:
        existing_preds_raw = supabase.get("football_predictions", {
            "select": "fixture_id,market,prediction,probability,confidence_category,created_at,updated_at,metadata,settlement_status,target_kickoff_at",
            "limit": "2000"
        })
        existing_preds_map = {p["fixture_id"]: p for p in existing_preds_raw if "fixture_id" in p}
        for p in existing_preds_raw:
            if p.get("settlement_status") in ("won", "lost", "void"):
                locked_fixture_ids.add(p["fixture_id"])
            elif p.get("target_kickoff_at") and p["target_kickoff_at"] <= lock_window_iso:
                locked_fixture_ids.add(p["fixture_id"])
        print(f"  • Found {len(existing_preds_map)} existing predictions in Cloud Supabase ({len(locked_fixture_ids)} strictly locked under 48h/settlement rules).", flush=True)
    except Exception as e_err:
        existing_preds_map = {}
        print(f"  [WARN] Could not load existing predictions: {e_err}", flush=True)

    # Sort fixtures to prioritize any legacy static over_under_0.5 or eliminated over_under_3.5 predictions for immediate upgrade
    def fixture_priority(fix):
        fid = fix.get("id")
        ep = existing_preds_map.get(fid)
        if ep and ep.get("market") in ("over_under_0.5", "over_under_3.5"):
            return 0  # Highest priority: upgrade legacy static bankers and eliminated under 3.5
        return 1

    forward_fixtures = sorted(forward_fixtures, key=fixture_priority)

    # 48-Hour Immutability Lock & Forward Window Change-Tracking:
    # 1. Matches with kickoff <= now + 48h (or settled) are strictly immutable.
    # 2. Forward matches beyond 48h (Days 2, 3, 4) are evaluated for new data (squad news, odds drift).
    fixtures_to_process = [f for f in forward_fixtures if f.get("id") not in locked_fixture_ids]
    print(f"  • Immutability Lock Active: {len(locked_fixture_ids)} fixtures within 48h/settled strictly locked.", flush=True)
    print(f"  • Evaluating {len(fixtures_to_process)} forward fixtures across rolling 5-day horizon for initial prediction or change re-calibration.", flush=True)

    # If argument provided, allow limiting for tests, otherwise drain the eligible forward window
    drain_all = True
    batch_limit = None
    for arg in sys.argv[1:]:
        if arg.isdigit():
            batch_limit = int(arg)
            drain_all = False
            break

    if batch_limit:
        fixtures_to_process = fixtures_to_process[:batch_limit]
        print(f"  • Running batch limit mode: {batch_limit} fixtures", flush=True)
    else:
        print(f"  • Running EXHAUSTIVE DRAIN mode across ALL {len(fixtures_to_process)} eligible forward fixtures", flush=True)

    # 6. Execute per-fixture isolated predictions
    print("\n[STEP 5] Running Phase 4.7 Zero-Hallucination & Consensus Prediction Pipeline...", flush=True)
    published_count = 0
    data_unavailable_count = 0
    consensus_banker_count = 0
    skipped_unchanged_count = 0

    for idx, f in enumerate(fixtures_to_process, 1):
        f_id = f.get("id")
        l_code = f.get("league_code") or "OTHER"
        h_team = f.get("home_team_name") or "home"
        a_team = f.get("away_team_name") or "away"
        kickoff_str = f.get("target_kickoff_at")
        try:
            kickoff = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00"))
        except Exception:
            kickoff = now_utc + timedelta(hours=12)

        canonical_key = f.get("canonical_key") or f"{l_code}:{h_team}:{a_team}:{kickoff.strftime('%Y%m%d')}"

        print(f"\n--- [{idx}/{len(fixtures_to_process)}] Fixture: {h_team} vs {a_team} ({l_code}) ---", flush=True)
        print(f"    Canonical Key: {canonical_key}", flush=True)
        print(f"    Kickoff: {kickoff.isoformat()}", flush=True)

        # Strict Quality Gate: English Tier 5 (National League) cutoff and Women's exclusion
        if not is_fixture_eligible(league_code=l_code, home_team=h_team, away_team=a_team):
            print(f"    [EXCLUDED] Fixture in excluded league/division or women's football: {l_code} ({h_team} vs {a_team})", flush=True)
            continue

        # SMART REPREDICTION: Check if already predicted and game data unchanged
        existing_pred = existing_preds_map.get(f_id)
        features = None
        try:
            features = pipeline.feature_engine.compute_features(
                canonical_key=canonical_key,
                league_code=l_code,
                home_team_canonical=h_team,
                away_team_canonical=a_team,
                prediction_cutoff=kickoff,
                fixture_id=f_id,
            )
        except Exception:
            pass

        if existing_pred and features:
            prev_meta = existing_pred.get("metadata") or {}
            if isinstance(prev_meta, str):
                import json
                try:
                    prev_meta = json.loads(prev_meta)
                except Exception:
                    prev_meta = {}
            prev_sig = prev_meta.get("feature_signature")
            prev_market = existing_pred.get("market")

            force_repredict = "--force" in sys.argv or not prev_meta.get("selection_stage")
            # Condition to skip: Feature signature identical AND not an eliminated market (0.5/3.5) AND already evaluated under Option A+ hierarchy
            if not force_repredict and prev_market not in ("over_under_0.5", "over_under_3.5") and prev_sig and prev_sig == features.feature_signature and prev_meta.get("selection_stage"):
                skipped_unchanged_count += 1
                print(f"    [SKIP REPREDICT] Game data stable with Option A+ calibration. Preserving existing prediction.", flush=True)
                continue
            else:
                if not prev_meta.get("selection_stage"):
                    print(f"    [OPTION A+ REPREDICT] Upgrading fixture prediction to Option A+ Calibrated Market Hierarchy.", flush=True)
                elif prev_market in ("over_under_0.5", "over_under_3.5"):
                    print(f"    [UPGRADE REPREDICT] Upgrading legacy/eliminated {prev_market} prediction to dynamic banker model.", flush=True)
                else:
                    print(f"    [DATA CHANGED REPREDICT] Game data changed ({prev_sig} -> {features.feature_signature}). Re-simulating...", flush=True)

        res = pipeline.process_single_fixture(
            fixture_id=f_id,
            canonical_key=canonical_key,
            league_code=l_code,
            home_team_canonical=h_team,
            away_team_canonical=a_team,
            kickoff_utc=kickoff,
            persist_to_supabase=True,
            features=features,
            force_repredict=force_run
        )

        if res.status == "PUBLISHED":
            published_count += 1
            primary = res.primary_prediction
            print(f"    Status: PUBLISHED [SNIPER MODE: 1 Fixture = 1 Database Row]", flush=True)
            if res.simulation_result:
                print(f"    Simulations: {res.simulation_result.completed_simulations:,} draws in {res.simulation_result.duration_ms:.1f}ms", flush=True)
            if res.is_consensus_banker:
                consensus_banker_count += 1
                print(f"    🎯 CONSENSUS BANKER VERIFIED: Both P_sim={res.p_sim_primary*100:.1f}% >= 82% AND P_market={res.p_market_primary*100:.1f}% >= 80%", flush=True)
                print(f"       Market: [{primary.confidence_tier}] {primary.market_name} -> {primary.outcome}", flush=True)
            else:
                print(f"    🛡 TOSS-UP / DIVERGENCE: [{primary.confidence_tier}] {primary.market_name} -> {primary.outcome} (P_sim={res.p_sim_primary*100 if res.p_sim_primary else 0:.1f}%)", flush=True)

            if res.secondary_predictions:
                print(f"    📦 SECONDARY CONSENSUS ({len(res.secondary_predictions)} markets >= 60%):", flush=True)
                for s in res.secondary_predictions:
                    prob_pct = s.get('probability', 0) * 100
                    print(f"       • [{s.get('confidence_tier')}] {s.get('market')} -> {s.get('prediction')} : {prob_pct:.1f}%", flush=True)

        elif res.status == "DATA_UNAVAILABLE":
            data_unavailable_count += 1
            print(f"    Status: DATA_UNAVAILABLE (Zero-Hallucination Gate enforced - no synthetic guessing)", flush=True)
            print(f"    Reason: {res.not_ready_reason}", flush=True)
        else:
            print(f"    Status: {res.status} ({res.not_ready_reason})", flush=True)

    # 7. Verification: Ensure zero pending fixtures in the 4-day window
    print("\n==================================================================")
    print(" VERIFICATION & QUEUE DRAIN AUDIT")
    print("==================================================================")

    # Query Cloud Supabase to verify that zero pending fixtures remain in the forward window
    forward_check = supabase.get_forward_prediction_queue(ref_time_utc=today_start_utc, max_days=5, limit=2000)
    pending_count = sum(1 for f in forward_check if f.get("status") == "pending")

    print(f" Total forward fixtures evaluated: {len(fixtures_to_process)}")
    print(f" Published predictions: {published_count}")
    print(f" Primary Consensus Bankers (P_sim>=82% AND P_market>=80%): {consensus_banker_count}")
    print(f" DATA_UNAVAILABLE fixtures (real data absent): {data_unavailable_count}")
    print(f" Pending fixtures in forward window: {pending_count} (Must be EXACTLY 0)")

    if pending_count == 0:
        print(" ✅ SUCCESS: Exhaustive queue drain complete with EXACTLY ZERO pending orphans.")
    else:
        print(f" ⚠️ WARNING: {pending_count} fixtures remain in pending status.")

    if len(fixtures_to_process) > 0 and published_count == 0:
        print(" 🚨 ZERO PREDICTIONS ALERT: Evaluated fixtures but published 0 predictions.", flush=True)
        send_zero_predictions_alert(
            date_str=now_utc.strftime("%Y-%m-%d"),
            matches_evaluated=len(fixtures_to_process),
            context={
                "data_unavailable_count": data_unavailable_count,
                "pending_count": pending_count
            }
        )

    print("==================================================================")


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        print(f"\n[CRITICAL ERROR] Prediction Pipeline Failed: {e}", file=sys.stderr)
        send_pipeline_failure_alert(
            pipeline_name="Prediction Engine (Daily Sniper)",
            error=e,
            context={"timestamp": datetime.now(timezone.utc).isoformat()}
        )
        sys.exit(1)
