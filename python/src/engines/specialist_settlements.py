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
        """Runs settlement passes across all four decoupled engines."""
        print("🎯 [SpecialistSettlement] Starting decoupled settlement cycle...")
        home_res = self.settle_home_wins()
        away_res = self.settle_away_wins()
        draw_res = self.settle_draws()
        corner_res = self.settle_corners()

        summary = {
            "home_win": home_res,
            "away_win": away_res,
            "draw": draw_res,
            "corners": corner_res,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        print(f"✅ [SpecialistSettlement] Cycle complete: {summary}")
        return summary

    def _get_finished_fixtures_map(self, fixture_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """Batches retrieval of finished match scores."""
        if not fixture_ids:
            return {}
        res = self.db.get("football_fixtures", {
            "id": f"in.({','.join(fixture_ids[:150])})",
            "select": "id,status,home_score,away_score,corners_home,corners_away,target_kickoff_at"
        })
        return {f["id"]: f for f in res}

    def settle_home_wins(self) -> Dict[str, int]:
        """Settles pending home win predictions."""
        pending = self.db.get("home_win_predictions", {
            "settlement_status": "eq.pending",
            "select": "id,fixture_id,probability",
            "limit": "200"
        })
        if not pending:
            return {"settled": 0, "won": 0, "lost": 0}

        f_map = self._get_finished_fixtures_map([p["fixture_id"] for p in pending])
        settled_count = won_count = lost_count = 0

        for p in pending:
            f = f_map.get(p["fixture_id"])
            if not f or f.get("status") not in ("finished", "ft", "settled"):
                continue

            hs = f.get("home_score")
            as_ = f.get("away_score")
            if hs is None or as_ is None:
                continue

            status = "won" if hs > as_ else "lost"
            score_str = f"{hs}-{as_}"
            now_iso = datetime.now(timezone.utc).isoformat()

            # 1. Update prediction record
            self.db.patch("home_win_predictions", {
                "settlement_status": status,
                "actual_score": score_str,
                "settled_at": now_iso
            }, {"id": f"eq.{p['id']}"})

            # 2. Insert into isolated audit settlement table
            self.db.post("home_win_settlements", {
                "prediction_id": p["id"],
                "fixture_id": p["fixture_id"],
                "status": status,
                "final_score": score_str,
                "settled_at": now_iso,
                "notes": f"Settled: Home {hs} - {as_} Away"
            }, on_conflict="prediction_id")

            settled_count += 1
            if status == "won": won_count += 1
            else: lost_count += 1

        return {"settled": settled_count, "won": won_count, "lost": lost_count}

    def settle_away_wins(self) -> Dict[str, int]:
        """Settles pending away win predictions."""
        pending = self.db.get("away_win_predictions", {
            "settlement_status": "eq.pending",
            "select": "id,fixture_id,probability",
            "limit": "200"
        })
        if not pending:
            return {"settled": 0, "won": 0, "lost": 0}

        f_map = self._get_finished_fixtures_map([p["fixture_id"] for p in pending])
        settled_count = won_count = lost_count = 0

        for p in pending:
            f = f_map.get(p["fixture_id"])
            if not f or f.get("status") not in ("finished", "ft", "settled"):
                continue

            hs = f.get("home_score")
            as_ = f.get("away_score")
            if hs is None or as_ is None:
                continue

            status = "won" if as_ > hs else "lost"
            score_str = f"{hs}-{as_}"
            now_iso = datetime.now(timezone.utc).isoformat()

            self.db.patch("away_win_predictions", {
                "settlement_status": status,
                "actual_score": score_str,
                "settled_at": now_iso
            }, {"id": f"eq.{p['id']}"})

            self.db.post("away_win_settlements", {
                "prediction_id": p["id"],
                "fixture_id": p["fixture_id"],
                "status": status,
                "final_score": score_str,
                "settled_at": now_iso,
                "notes": f"Settled: Away Win {as_} > {hs}"
            }, on_conflict="prediction_id")

            settled_count += 1
            if status == "won": won_count += 1
            else: lost_count += 1

        return {"settled": settled_count, "won": won_count, "lost": lost_count}

    def settle_draws(self) -> Dict[str, int]:
        """Settles pending draw predictions."""
        pending = self.db.get("draw_predictions", {
            "settlement_status": "eq.pending",
            "select": "id,fixture_id,probability",
            "limit": "200"
        })
        if not pending:
            return {"settled": 0, "won": 0, "lost": 0}

        f_map = self._get_finished_fixtures_map([p["fixture_id"] for p in pending])
        settled_count = won_count = lost_count = 0

        for p in pending:
            f = f_map.get(p["fixture_id"])
            if not f or f.get("status") not in ("finished", "ft", "settled"):
                continue

            hs = f.get("home_score")
            as_ = f.get("away_score")
            if hs is None or as_ is None:
                continue

            status = "won" if hs == as_ else "lost"
            score_str = f"{hs}-{as_}"
            now_iso = datetime.now(timezone.utc).isoformat()

            self.db.patch("draw_predictions", {
                "settlement_status": status,
                "actual_score": score_str,
                "settled_at": now_iso
            }, {"id": f"eq.{p['id']}"})

            self.db.post("draw_settlements", {
                "prediction_id": p["id"],
                "fixture_id": p["fixture_id"],
                "status": status,
                "final_score": score_str,
                "settled_at": now_iso,
                "notes": f"Settled: Draw {score_str}"
            }, on_conflict="prediction_id")

            settled_count += 1
            if status == "won": won_count += 1
            else: lost_count += 1

        return {"settled": settled_count, "won": won_count, "lost": lost_count}

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
