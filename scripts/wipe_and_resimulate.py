"""
JamBets - Clean Wipe and Recapture Script
Wipes predictions, simulations, and forward fixtures for fresh 5-day capture.
"""
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from python.src.db.supabase_client import CloudSupabaseClient

def wipe_data():
    sb = CloudSupabaseClient()
    print("Beginning clean database wipe for forward prediction window (>= 2026-09-10)...")
    
    # 1. Delete all predictions
    print("1. Deleting football_predictions...")
    try:
        # Delete with target_kickoff_at gte 2026-09-10 or all
        res = sb.delete("football_predictions", {"id": "neq.00000000-0000-0000-0000-000000000000"})
        print(f"   [OK] Deleted predictions ({len(res)} returned)")
    except Exception as e:
        print(f"   [NOTE] Error deleting predictions: {e}")

    # 2. Delete simulations
    print("2. Deleting football_simulations...")
    try:
        res = sb.delete("football_simulations", {"id": "neq.00000000-0000-0000-0000-000000000000"})
        print(f"   [OK] Deleted simulations ({len(res)} returned)")
    except Exception as e:
        print(f"   [NOTE] Error deleting simulations: {e}")

    # 3. Delete forward fixtures (>= 2026-09-10T00:00:00Z)
    print("3. Deleting forward football_fixtures (target_kickoff_at >= 2026-09-10T00:00:00Z)...")
    try:
        res = sb.delete("football_fixtures", {"target_kickoff_at": "gte.2026-09-10T00:00:00Z"})
        print(f"   [OK] Deleted forward fixtures ({len(res)} returned)")
    except Exception as e:
        print(f"   [NOTE] Error deleting fixtures: {e}")

    print("Database wipe complete.")

if __name__ == "__main__":
    wipe_data()
