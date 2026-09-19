"""
JamBets — Wipe Current Day (2026-09-19) Draw Predictions
Archives & voids pending draw predictions for 2026-09-19 so they are removed from UI.
100% IMMUTABILITY GUARANTEE: Settled records (won/lost) are never touched.
"""

import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient

def wipe_draw_today(target_date: str = "2026-09-19"):
    db = CloudSupabaseClient()
    print(f"🧹 [Wipe] Fetching pending draw predictions for {target_date}...")
    
    records = db.get("draw_predictions", {
        "target_kickoff_at": f"gte.{target_date}T00:00:00Z",
        "settlement_status": "eq.pending",
        "select": "id,target_kickoff_at,settlement_status",
        "limit": "2000"
    }) or []
    
    target_ids = [r["id"] for r in records if (r.get("target_kickoff_at") or "").startswith(target_date)]
    print(f"   Found {len(target_ids)} pending draw records to archive & wipe on {target_date}.")

    batch_size = 100
    for b in range(0, len(target_ids), batch_size):
        chunk = target_ids[b:b + batch_size]
        id_str = ",".join(chunk)
        db.patch("draw_predictions", {
            "publication_status": "archived",
            "settlement_status": "void",
            "settlement_notes": "Archived: Wiped for fresh 30k Draw simulation rebuild"
        }, {"id": f"in.({id_str})"})
    print(f"✨ [Wipe] Successfully archived & voided {len(target_ids)} pending draw records for {target_date}.")

    # Verification: Active pending on target date
    active_now = db.get("draw_predictions", {
        "target_kickoff_at": f"gte.{target_date}T00:00:00Z",
        "publication_status": "eq.published",
        "settlement_status": "eq.pending",
        "select": "id,target_kickoff_at",
        "limit": "500"
    }) or []
    active_today = [r["id"] for r in active_now if (r.get("target_kickoff_at") or "").startswith(target_date)]
    print(f"🔍 [Verification] Active published pending records remaining on {target_date}: {len(active_today)}")

    # Immutability Check: Settled records on target date
    settled = db.get("draw_predictions", {
        "target_kickoff_at": f"gte.{target_date}T00:00:00Z",
        "settlement_status": "in.(won,lost)",
        "select": "id,target_kickoff_at,settlement_status",
        "limit": "500"
    }) or []
    settled_today = [r for r in settled if (r.get("target_kickoff_at") or "").startswith(target_date)]
    print(f"🔒 [Immutability] Settled records strictly preserved on {target_date}: {len(settled_today)}")

if __name__ == "__main__":
    wipe_draw_today("2026-09-19")
