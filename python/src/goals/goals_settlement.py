"""
JamBets — Goals Specialist Settlement Engine
Evaluates and settles Over 2.5 Goals and First Half Over 0.5 Goals.
Features Early Half-Time settlement for 1H Over 0.5 markets.
Completely isolated from core football_settlements.
"""

import sys
import os
from datetime import datetime, timezone
from typing import List, Dict, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient

class GoalsSettlementEngine:
    """
    Settles Over 2.5 Goals and 1H Over 0.5 Goals independently.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()

    def settle(self) -> Dict[str, Any]:
        """
        Scans pending goals predictions and settles based on authoritative fixture scores.
        """
        print("🎯 [GoalsSettlement] Starting Goals Settlement Pass...")
        now_iso = datetime.now(timezone.utc).isoformat()

        # Fetch pending goals predictions
        pending_preds = self.db.get("goals_predictions", {
            "settlement_status": "eq.pending"
        })

        if not pending_preds:
            print("ℹ️ [GoalsSettlement] No pending goals predictions found.")
            return {"status": "success", "settled": 0}

        # Collect fixture IDs
        fixture_ids = list(set([p["fixture_id"] for p in pending_preds]))
        fixtures_map: Dict[str, Dict[str, Any]] = {}

        # Fetch corresponding fixtures
        for i in range(0, len(fixture_ids), 50):
            chunk = fixture_ids[i:i + 50]
            f_list = self.db.get("football_fixtures", {"id": f"in.({','.join(chunk)})"})
            for f in f_list:
                fixtures_map[f["id"]] = f

        settled_count = 0
        won_count = 0
        lost_count = 0
        void_count = 0

        for pred in pending_preds:
            pid = pred["id"]
            fid = pred["fixture_id"]
            market = pred["market"]
            fixture = fixtures_map.get(fid)

            if not fixture:
                continue

            status = fixture.get("status", "").lower()
            period = (fixture.get("period") or "").upper()
            h_score = fixture.get("home_score")
            a_score = fixture.get("away_score")
            ht_h_score = fixture.get("half_time_home_score")
            ht_a_score = fixture.get("half_time_away_score")

            is_finished = status in ["finished", "ft", "aet", "pen"] or period == "FT"
            is_ht_or_later = period in ["HT", "2H", "ET", "PK", "FT"] or is_finished

            outcome = None
            notes = ""
            final_str = f"{h_score}-{a_score}" if (h_score is not None and a_score is not None) else None
            ht_str = f"{ht_h_score}-{ht_a_score}" if (ht_h_score is not None and ht_a_score is not None) else None

            # Handle cancelled / postponed
            if status in ["postponed", "cancelled", "abandoned"]:
                outcome = "void"
                notes = f"Match {status} — Protected void settlement."
            
            # --- MARKET 1: First Half Over 0.5 Goals ---
            elif market == "ht_over_0.5_goals":
                # Check HT scores if available
                if ht_h_score is not None and ht_a_score is not None:
                    ht_total = ht_h_score + ht_a_score
                    if ht_total >= 1:
                        outcome = "won"
                        notes = f"Won at Half-Time! HT Score: {ht_str} (>= 1 goal)"
                    elif is_finished or is_ht_or_later:
                        outcome = "lost"
                        notes = f"Lost at Half-Time. HT Score: {ht_str} (0-0)"
                # Fallback if match is finished and final score is 0-0
                elif is_finished and h_score is not None and a_score is not None:
                    if (h_score + a_score) == 0:
                        outcome = "lost"
                        notes = f"Lost at Full-Time (Final: 0-0)"
                    elif (h_score + a_score) >= 1:
                        # If final score has goals, and match is finished, check if early goal is recorded
                        outcome = "won"
                        notes = f"Won! Confirmed match had goals ({final_str})"

            # --- MARKET 2: Full-Time Over 2.5 Goals ---
            elif market == "over_2.5_goals":
                if is_finished and h_score is not None and a_score is not None:
                    total_goals = h_score + a_score
                    if total_goals >= 3:
                        outcome = "won"
                        notes = f"Won! Final Score: {final_str} ({total_goals} goals >= 3)"
                    else:
                        outcome = "lost"
                        notes = f"Lost. Final Score: {final_str} ({total_goals} goals < 3)"

            if outcome:
                # 1. Update goals_predictions
                self.db.patch("goals_predictions", {
                    "settlement_status": outcome,
                    "settled_at": now_iso,
                    "actual_score": final_str,
                    "ht_score": ht_str,
                    "settlement_notes": notes
                }, {"id": f"eq.{pid}"})

                # 2. Insert into goals_settlements
                total_g = (h_score + a_score) if (h_score is not None and a_score is not None) else None
                ht_g = (ht_h_score + ht_a_score) if (ht_h_score is not None and ht_a_score is not None) else None

                self.db.post("goals_settlements", [{
                    "prediction_id": pid,
                    "fixture_id": fid,
                    "market": market,
                    "status": outcome,
                    "final_score": final_str,
                    "ht_score": ht_str,
                    "total_goals": total_g,
                    "ht_goals": ht_g,
                    "settled_at": now_iso,
                    "notes": notes
                }], on_conflict="prediction_id")

                settled_count += 1
                if outcome == "won": won_count += 1
                elif outcome == "lost": lost_count += 1
                elif outcome == "void": void_count += 1

        print(f"✅ [GoalsSettlement] Settled {settled_count} predictions "
              f"({won_count} Won, {lost_count} Lost, {void_count} Void).")

        return {
            "status": "success",
            "settled_count": settled_count,
            "won_count": won_count,
            "lost_count": lost_count,
            "void_count": void_count
        }

if __name__ == "__main__":
    settler = GoalsSettlementEngine()
    settler.settle()
