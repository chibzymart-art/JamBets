"""
JamBets — Dedicated Corners Specialist Settlement Engine
Evaluates and settles Over 7.5 and Over 8.5 corner predictions based exclusively
on verified, official match corner statistics scraped directly from official boxscores.
Completely isolated and decoupled from other market engines.
Zero synthetic, fabricated, or goal-based fallback counts permitted.
"""

import sys
import os
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.corners.corner_stats_scraper import CornerStatsScraper


class CornersSettlementEngine:
    """
    Dedicated, isolated settlement engine for Corner Specialist predictions.
    Orchestrates authentic corner scraping via CornerStatsScraper and settles
    exclusively on verified data.
    """

    def __init__(self, db: Optional[CloudSupabaseClient] = None):
        self.db = db or CloudSupabaseClient()
        self.scraper = CornerStatsScraper()

    def settle(self) -> Dict[str, Any]:
        """
        Scans pending corner predictions, scrapes missing official corner boxscores,
        and deterministically settles completed matches.
        """
        print("🚩 [CornersSettlementEngine] Starting Dedicated Corner Settlement Pass...")
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Fetch pending published corner predictions
        pending_preds = self.db.get("corner_predictions", {
            "settlement_status": "eq.pending",
            "publication_status": "neq.archived",
            "limit": "300"
        })

        if not pending_preds:
            print("ℹ️ [CornersSettlementEngine] No pending corner predictions to settle.")
            return {"status": "success", "settled": 0, "won": 0, "lost": 0, "pending": 0}

        print(f"📊 [CornersSettlementEngine] Found {len(pending_preds)} pending corner predictions.")

        # 2. Batch fetch corresponding fixtures
        fixture_ids = list(set([p["fixture_id"] for p in pending_preds if p.get("fixture_id")]))
        fixtures_map: Dict[str, Dict[str, Any]] = {}

        for i in range(0, len(fixture_ids), 50):
            chunk = fixture_ids[i:i + 50]
            f_list = self.db.get("football_fixtures", {
                "id": f"in.({','.join(chunk)})",
                "select": "id,league_id,home_team_id,away_team_id,status,period,home_score,away_score,corners_home,corners_away,target_kickoff_at"
            })
            for f in f_list:
                fixtures_map[f["id"]] = f

        settled_count = 0
        won_count = 0
        lost_count = 0
        void_count = 0
        awaiting_stats_count = 0

        for pred in pending_preds:
            if pred.get("settlement_status") in ("won", "lost", "void"):
                continue

            pid = pred["id"]
            fid = pred.get("fixture_id")
            market = pred.get("market", "")
            prediction_text = pred.get("prediction", "")
            fixture = fixtures_map.get(fid)

            if not fixture:
                continue

            status = (fixture.get("status") or "").lower()
            period = (fixture.get("period") or "").upper()

            # Handle cancelled / postponed / abandoned fixtures -> Protected VOID
            if status in ["postponed", "cancelled", "abandoned"]:
                void_notes = f"Match {status.upper()} — Protected void settlement."
                self.db.patch("corner_predictions", {
                    "settlement_status": "void",
                    "settled_at": now_iso,
                    "settlement_notes": void_notes
                }, {"id": f"eq.{pid}"})
                self.db.post("corner_settlements", {
                    "prediction_id": pid,
                    "fixture_id": fid,
                    "market": market,
                    "status": "void",
                    "total_corners": None,
                    "home_corners": None,
                    "away_corners": None,
                    "settled_at": now_iso,
                    "notes": void_notes
                }, on_conflict="prediction_id")
                void_count += 1
                settled_count += 1
                continue

            is_finished = status in ["finished", "ft", "aet", "pen", "settled"] or period == "FT"
            if not is_finished:
                # Match has not finished yet
                continue

            # Check if fixture already has official corner stats
            ch = fixture.get("corners_home")
            ca = fixture.get("corners_away")

            # If missing, scrape official boxscores via dedicated CornerStatsScraper
            if ch is None or ca is None:
                scraped_corners = self.scraper.enrich_fixture_corners(fixture, self.db)
                if scraped_corners:
                    ch, ca = scraped_corners
                    # Update local cache
                    fixture["corners_home"] = ch
                    fixture["corners_away"] = ca

            # If still missing official corner counts after scraping, hold in pending
            if ch is None or ca is None:
                awaiting_stats_count += 1
                continue

            # Standard line threshold evaluation:
            # Over 7.5 requires >= 8 corners to win
            # Over 8.5 requires >= 9 corners to win
            line = 8.5
            if "7.5" in market or "7.5" in prediction_text:
                line = 7.5
            elif "8.5" in market or "8.5" in prediction_text:
                line = 8.5

            total_corners = int(ch) + int(ca)
            is_won = total_corners > line
            status_result = "won" if is_won else "lost"

            actual_str = f"{total_corners} corners ({ch}H - {ca}A)"
            verified_notes = f"Verified: Total Corners {total_corners} ({ch} Home - {ca} Away) vs Line {line}"

            # 1. Update corner_predictions record
            self.db.patch("corner_predictions", {
                "settlement_status": status_result,
                "actual_corners": actual_str,
                "settled_at": now_iso,
                "settlement_notes": verified_notes
            }, {"id": f"eq.{pid}"})

            # 2. Insert into isolated audit settlement table
            self.db.post("corner_settlements", {
                "prediction_id": pid,
                "fixture_id": fid,
                "market": market,
                "status": status_result,
                "total_corners": total_corners,
                "home_corners": int(ch),
                "away_corners": int(ca),
                "settled_at": now_iso,
                "notes": verified_notes
            }, on_conflict="prediction_id")

            settled_count += 1
            if is_won:
                won_count += 1
            else:
                lost_count += 1

            print(f"  ✅ [CornersSettlementEngine] Settled {prediction_text} on fixture {fid}: "
                  f"{status_result.upper()} | {verified_notes}")

        summary = {
            "status": "success",
            "settled": settled_count,
            "won": won_count,
            "lost": lost_count,
            "void": void_count,
            "awaiting_stats": awaiting_stats_count,
            "total_pending_evaluated": len(pending_preds),
            "timestamp": now_iso
        }
        print(f"🏁 [CornersSettlementEngine] Settlement pass complete: {summary}")
        return summary


if __name__ == "__main__":
    engine = CornersSettlementEngine()
    res = engine.settle()
    print("Execution Result:", res)
