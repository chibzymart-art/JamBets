"""
Oddsbanta — Isolated Corners Specialist Engine (Ground-Up Rebuild)
Mathematical Model: Negative Binomial Set-Piece GLM & Over-Dispersion Model (r = 8.5).
Dynamic Data: Zero hardcoded baselines, zero placeholders.
Markets: Strictly evaluates Over 7.5 Corners and Over 8.5 Corners per user directive.
Decoupled: Writes exclusively to public.corner_predictions.
"""

import sys
import os
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.db.universal_data_store import UniversalDataStore
from python.src.corners.corners_data_provider import CornersDataProvider
from python.src.corners.corner_intent_engine import CornerIntentEngine
from python.src.corners.negative_binomial_corners import NegativeBinomialCornersModel
from python.src.corners.corners_ai_scout import CornersAiScout


class CornersEngine:
    """
    Autonomous worker engine for Corners Specialist predictions.
    Computes dynamic competition baselines, empirical club metrics,
    Match Corner Intent Index (MCII), and Negative Binomial tail probabilities.
    Evaluates lines strictly between 7.5 and 9.5 (Over 7.5, Over 8.5, Over 9.5).
    """

    def __init__(self, db: Optional[CloudSupabaseClient] = None):
        self.db = db or CloudSupabaseClient()
        self.data_provider = CornersDataProvider(self.db)

    def run(self, max_fixtures: int = 500, wipe_all: bool = True) -> Dict[str, Any]:
        print("🚩 [CornersEngine] Launching Dynamic Corners Specialist Engine (7.5 - 9.5)...")
        now = datetime.now(timezone.utc)
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()
        lock_window_iso = (now + timedelta(hours=48)).isoformat()

        # 1. Load dynamic dataset (zero hardcoded numbers)
        ds_stats = self.data_provider.load_dynamic_dataset()
        print(f"📈 [CornersEngine] Ingestion complete: {ds_stats}")

        # 2. Reset/Wipe existing corner predictions if requested per user directive
        if wipe_all:
            print("🧹 [CornersEngine] Archiving existing pending/void corner predictions for fresh run...")
            try:
                self.db.patch("corner_predictions", {
                    "publication_status": "archived"
                }, {
                    "settlement_status": "in.(pending,void)"
                })
                print("✨ [CornersEngine] Successfully marked prior active/void corner predictions as archived.")
            except Exception as e:
                print(f"⚠️ [CornersEngine] Notice during reset: {e}")

        # 3. Query existing predictions to respect 48-hour lock & settlement status (if any preserved)
        existing = self.db.get("corner_predictions", {
            "select": "id,fixture_id,target_kickoff_at,settlement_status,market,publication_status",
            "limit": "1000"
        })
        existing_map = {(p["fixture_id"], p.get("market")): p["id"] for p in existing}
        existing_pending_map = {p["fixture_id"]: p["id"] for p in existing if p.get("settlement_status") == "pending" and p.get("publication_status") != "archived"}
        locked_fixture_ids = set()
        for p in existing:
            if p.get("publication_status") == "archived":
                continue
            if p.get("settlement_status") in ("won", "lost"):
                locked_fixture_ids.add(p["fixture_id"])
            elif not wipe_all and p.get("target_kickoff_at") and p["target_kickoff_at"] <= lock_window_iso:
                locked_fixture_ids.add(p["fixture_id"])

        # 4. Fetch scheduled upcoming fixtures across 4-day window
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "select": "id,home_team_id,away_team_id,target_kickoff_at,league_id",
            "limit": str(max_fixtures)
        })

        to_insert = []
        updated_count = 0
        skipped_locked = 0
        skipped_unwhitelisted = 0
        skipped_insufficient_edge = 0

        store = UniversalDataStore.get_instance(db=self.db)

        for f in fixtures:
            fid = f["id"]
            lid = f.get("league_id")

            hid = f.get("home_team_id")
            aid = f.get("away_team_id")
            h_profile = self.data_provider.club_profiles.get(hid)
            a_profile = self.data_provider.club_profiles.get(aid)
            h_name = h_profile.team_name if h_profile else ""
            a_name = a_profile.team_name if a_profile else ""

            # Quality Gate 1: Whitelist Tier 1 & Tier 2 professional leagues (National League floor, no women's)
            if not self.data_provider.is_league_whitelisted(lid, home_team=h_name, away_team=a_name):
                skipped_unwhitelisted += 1
                continue

            if fid in locked_fixture_ids:
                skipped_locked += 1
                continue

            # Quality Gate 2: Data Sufficiency
            if not h_profile or not a_profile:
                skipped_insufficient_edge += 1
                continue

            league_metrics = self.data_provider.get_dynamic_league_baseline(lid)

            # Enrich with live FotMob statistics if available
            self.data_provider.enrich_club_live(h_profile, league_code=league_metrics.league_code)
            self.data_provider.enrich_club_live(a_profile, league_code=league_metrics.league_code)

            # Dynamic Match Corner Intent Index (MCII)
            intent = CornerIntentEngine.evaluate(
                h_profile,
                a_profile,
                league_metrics,
                competition_code=league_metrics.league_code
            )

            # H2H pace retrieval
            h2h = store.get_h2h(h_profile.team_name, a_profile.team_name)

            # Quality Gates 3 & 4: Negative Binomial Tail Modeling (7.5 - 9.5 range)
            eval_res = NegativeBinomialCornersModel.evaluate_matchup(
                h_profile,
                a_profile,
                league_metrics,
                intent,
                h2h=h2h
            )

            if not eval_res:
                skipped_insufficient_edge += 1
                continue

            # Quality Gate 5: Grounded AI Tactical Scout Generation
            rationale = CornersAiScout.generate_rationale(
                home_name=h_profile.team_name,
                away_name=a_profile.team_name,
                league_name=league_metrics.league_name,
                market=eval_res["market"],
                probability=eval_res["probability"],
                predicted_total=eval_res["predicted_total_corners"],
                intent_data={"tactical_tag": eval_res["corner_tier"]}
            )

            density_tag = f"[DENSITY:{eval_res['over_7_5_pct']}/{eval_res['over_8_5_pct']}/{eval_res['over_9_5_pct']}]"
            notes = f"{density_tag} {rationale}"

            payload = {
                "fixture_id": fid,
                "prediction": eval_res["prediction"],
                "market": eval_res["market"],
                "probability": eval_res["probability"],
                "confidence_category": eval_res["confidence_category"],
                "corner_tier": eval_res["corner_tier"],
                "predicted_total_corners": eval_res["predicted_total_corners"],
                "home_corners_avg": eval_res["home_corners_avg"],
                "away_corners_avg": eval_res["away_corners_avg"],
                "over_8_5_prob": eval_res["over_8_5_prob"],
                "over_9_5_prob": eval_res["over_9_5_prob"],
                "over_10_5_prob": eval_res["over_10_5_prob"],
                "target_kickoff_at": f["target_kickoff_at"],
                "settlement_status": "pending",
                "publication_status": "published",
                "settlement_notes": notes
            }

            if fid in existing_pending_map:
                pred_id = existing_pending_map[fid]
                self.db.patch("corner_predictions", payload, {"id": f"eq.{pred_id}"})
                updated_count += 1
            elif (fid, eval_res["market"]) in existing_map:
                pred_id = existing_map[(fid, eval_res["market"])]
                self.db.patch("corner_predictions", payload, {"id": f"eq.{pred_id}"})
                updated_count += 1
            else:
                to_insert.append(payload)

        # 5. Batch insert fresh high-conviction predictions
        inserted_count = 0
        for i in range(0, len(to_insert), 50):
            batch = to_insert[i:i+50]
            res = self.db.post("corner_predictions", batch)
            inserted_count += len(res) if res else len(batch)

        total_published = inserted_count + updated_count
        print(f"✅ [CornersEngine] Completed: {total_published} High-Conviction Corner picks published "
              f"({inserted_count} new, {updated_count} updated, {skipped_locked} locked, "
              f"{skipped_unwhitelisted} unwhitelisted/amateur, {skipped_insufficient_edge} filtered).")

        return {
            "engine": "corners_engine",
            "published": total_published,
            "inserted": inserted_count,
            "updated": updated_count,
            "skipped_locked": skipped_locked,
            "skipped_unwhitelisted": skipped_unwhitelisted,
            "skipped_insufficient_edge": skipped_insufficient_edge,
            "total_fixtures_evaluated": len(fixtures)
        }


if __name__ == "__main__":
    engine = CornersEngine()
    summary = engine.run()
    print("Summary:", summary)
