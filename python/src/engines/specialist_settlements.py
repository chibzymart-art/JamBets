"""
Oddsbanta — Decoupled Specialist Settlements Pipeline
Independently settles:
1. Home Win predictions -> public.home_win_settlements
2. Away Win predictions -> public.away_win_settlements
3. Draw predictions     -> public.draw_settlements
4. Corner predictions   -> public.corner_settlements

Enforces strict audit logging and settlement immutability.
"""

import sys
import os
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient


class SpecialistSettlementPipeline:
    """
    Independent settlement pipeline for all 4 specialist markets.
    Evaluates completed football fixtures and logs official immutable settlement records.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()

    def settle_all(self) -> Dict[str, Any]:
        """Runs settlement passes across decoupled specialist engines."""
        print("🎯 [SpecialistSettlement] Starting decoupled settlement cycle...")
        corner_res = self.settle_corners()

        summary = {
            "corners": corner_res,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        print(f"✅ [SpecialistSettlement] Cycle complete: {summary}")
        return summary

    def settle_corners(self) -> Dict[str, int]:
        """Settles pending corner predictions via the dedicated CornersSettlementEngine."""
        from python.src.corners.corners_settlement_engine import CornersSettlementEngine
        engine = CornersSettlementEngine(self.db)
        res = engine.settle()
        return {
            "settled": res.get("settled", 0),
            "won": res.get("won", 0),
            "lost": res.get("lost", 0)
        }


if __name__ == "__main__":
    pipeline = SpecialistSettlementPipeline()
    res = pipeline.settle_all()
    print("Settlement result:", res)
