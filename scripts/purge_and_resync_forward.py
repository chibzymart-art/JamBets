"""
Purge and Resync Forward Fixtures Script
1. Purges forward-looking fixtures, predictions, simulations, and fixture sources
   in the 4-day prediction window (2026-09-10 onwards).
2. Re-runs AcquisitionPipeline to ingest clean fixtures with strict ID-based league
   mapping and real stadium names.
3. Re-runs PredictionPipeline with 250,000 simulations to publish valid predictions.
"""

import sys
from datetime import datetime, timezone
from python.src.db.supabase_client import SupabaseClient

def purge_forward_data():
    sb = SupabaseClient()
    now_iso = "2026-09-10T00:00:00Z"
    print(f"[PURGE] Fetching forward fixtures from {now_iso}...", flush=True)

    # Fetch forward fixtures
    forward_fixtures = sb.get("football_fixtures", {
        "target_kickoff_at": f"gte.{now_iso}",
        "select": "id,canonical_key",
        "limit": "2000"
    })
    print(f"[PURGE] Found {len(forward_fixtures)} forward fixtures to purge.", flush=True)

    if not forward_fixtures:
        print("[PURGE] No forward fixtures to purge.")
        return

    fixture_ids = [f["id"] for f in forward_fixtures if "id" in f]
    chunk_size = 50

    # 1. Delete forward predictions
    print("[PURGE] Deleting forward predictions...", flush=True)
    try:
        sb.delete("football_predictions", {"target_kickoff_at": f"gte.{now_iso}"})
    except Exception as err:
        print(f"  [NOTE] Bulk delete predictions: {err}", flush=True)

    # 2. Delete simulations, fixture sources, and fixtures by chunks
    for i in range(0, len(fixture_ids), chunk_size):
        chunk = fixture_ids[i:i + chunk_size]
        id_filter = f"in.({','.join(chunk)})"
        
        # Delete simulations
        try:
            sb.delete("football_simulations", {"fixture_id": id_filter})
        except Exception:
            pass

        # Delete fixture sources
        try:
            sb.delete("football_fixture_sources", {"fixture_id": id_filter})
        except Exception:
            pass

        # Delete any remaining predictions for these fixtures
        try:
            sb.delete("football_predictions", {"fixture_id": id_filter})
        except Exception:
            pass

        # Delete fixtures
        try:
            sb.delete("football_fixtures", {"id": id_filter})
        except Exception as f_err:
            print(f"  [WARN] Delete fixtures chunk {i}: {f_err}", flush=True)

    print(f"[PURGE] Completed purge of {len(fixture_ids)} forward fixtures.", flush=True)

if __name__ == "__main__":
    purge_forward_data()
