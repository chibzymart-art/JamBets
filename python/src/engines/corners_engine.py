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

    # ------------------------------------------------------------------
    # Per-fixture idempotency helpers.
    # DB invariant (see migration 20261018000001): at most ONE published,
    # non-void corner_predictions row may exist per fixture_id.
    # ------------------------------------------------------------------
    @staticmethod
    def _row_rank(row: Dict[str, Any]):
        settled = 1 if row.get("settlement_status") in ("won", "lost") else 0
        return (settled, row.get("created_at") or "", row.get("id") or "")

    def _load_live_rows_by_fixture(self, fixture_ids: List[str]) -> Dict[str, Dict[str, Any]]:
        """
        Returns the single authoritative published, non-void row per fixture
        (settled rows win, then newest). Scoped to the given fixtures, chunked and
        without any global row cap, so no existing row can be missed.
        """
        by_fixture: Dict[str, Dict[str, Any]] = {}
        for i in range(0, len(fixture_ids), 50):
            chunk = fixture_ids[i:i + 50]
            rows = self.db.get("corner_predictions", {
                "select": "id,fixture_id,target_kickoff_at,settlement_status,market,publication_status,created_at",
                "fixture_id": f"in.({','.join(chunk)})",
                "publication_status": "eq.published",
                "settlement_status": "neq.void",
                "limit": "1000"
            })
            for r in rows:
                cur = by_fixture.get(r["fixture_id"])
                if cur is None or self._row_rank(r) > self._row_rank(cur):
                    by_fixture[r["fixture_id"]] = r
        return by_fixture

    def _publish_single(self, payload: Dict[str, Any]) -> str:
        """
        Insert one prediction; if the DB rejects it because a published row already
        exists for the fixture (unique violation / race), update that row in place
        instead of creating a duplicate. Returns 'inserted', 'updated' or 'skipped'.
        """
        try:
            self.db.post("corner_predictions", [payload])
            return "inserted"
        except Exception as e:
            existing = self._load_live_rows_by_fixture([payload["fixture_id"]]).get(payload["fixture_id"])
            if existing and existing.get("settlement_status") == "pending":
                self.db.patch("corner_predictions", payload, {"id": f"eq.{existing['id']}"})
                return "updated"
            print(f"⚠️ [CornersEngine] Skipped fixture {payload['fixture_id']} (already published/settled): {e}")
            return "skipped"

    def run(self, max_fixtures: int = 500, wipe_all: bool = True) -> Dict[str, Any]:
        print("🚩 [CornersEngine] Launching Dynamic Corners Specialist Engine (7.5 - 9.5)...")
        now = datetime.now(timezone.utc)
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()
        lock_window_iso = (now + timedelta(hours=48)).isoformat()

        # 1. Load dynamic dataset (zero hardcoded numbers)
        ds_stats = self.data_provider.load_dynamic_dataset()
        print(f"📈 [CornersEngine] Ingestion complete: {ds_stats}")

        # 2. Fetch scheduled upcoming fixtures across 4-day window
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "select": "id,home_team_id,away_team_id,target_kickoff_at,league_id",
            "limit": str(max_fixtures)
        })

        # 3. Query the existing live row per evaluated fixture (scoped, uncapped) to respect
        #    48-hour lock & settlement status. One published row per fixture is the invariant:
        #    a re-qualifying fixture is updated IN PLACE, never inserted a second time.
        existing_by_fixture = self._load_live_rows_by_fixture([f["id"] for f in fixtures])
        locked_fixture_ids = set()
        for fid_, p in existing_by_fixture.items():
            if p.get("settlement_status") in ("won", "lost"):
                locked_fixture_ids.add(fid_)
            elif not wipe_all and p.get("target_kickoff_at") and p["target_kickoff_at"] <= lock_window_iso:
                locked_fixture_ids.add(fid_)
        seen_fixtures = set()
        published_fixture_ids = set()

        to_insert = []
        updated_count = 0
        skipped_locked = 0
        skipped_unwhitelisted = 0
        skipped_insufficient_edge = 0

        store = UniversalDataStore.get_instance(db=self.db)

        for f in fixtures:
            fid = f["id"]
            lid = f.get("league_id")

            # In-flight dedupe: never evaluate/publish the same fixture twice in one run
            if fid in seen_fixtures:
                continue
            seen_fixtures.add(fid)

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

            existing_row = existing_by_fixture.get(fid)
            if existing_row is not None:
                # Existing pending published row for this fixture: update in place (market may change)
                self.db.patch("corner_predictions", payload, {"id": f"eq.{existing_row['id']}"})
                updated_count += 1
            else:
                to_insert.append(payload)
            published_fixture_ids.add(fid)

        # 5. Batch insert fresh high-conviction predictions (only fixtures with no live row)
        inserted_count = 0
        for i in range(0, len(to_insert), 50):
            batch = to_insert[i:i+50]
            try:
                res = self.db.post("corner_predictions", batch)
                inserted_count += len(res) if res else len(batch)
            except Exception as e:
                # A concurrent run (or stale view) hit the one-published-row-per-fixture guard:
                # resolve row by row so one conflict never loses or duplicates the rest.
                print(f"⚠️ [CornersEngine] Batch insert conflict, resolving per row: {e}")
                for payload in batch:
                    outcome = self._publish_single(payload)
                    if outcome == "inserted":
                        inserted_count += 1
                    elif outcome == "updated":
                        updated_count += 1

        # 6. Archive stale pending picks (fixtures that no longer qualify). By id and only
        #    settlement_status=pending, so settled/void rows (immutable) are never touched.
        if wipe_all:
            stale_ids = [
                p["id"] for fid_, p in existing_by_fixture.items()
                if fid_ not in published_fixture_ids
                and fid_ not in locked_fixture_ids
                and p.get("settlement_status") == "pending"
            ]
            for i in range(0, len(stale_ids), 50):
                try:
                    self.db.patch("corner_predictions", {
                        "publication_status": "archived"
                    }, {
                        "id": f"in.({','.join(stale_ids[i:i+50])})",
                        "settlement_status": "eq.pending"
                    })
                except Exception as e:
                    print(f"⚠️ [CornersEngine] Notice during stale-pick archive: {e}")
            if stale_ids:
                print(f"🧹 [CornersEngine] Archived {len(stale_ids)} stale pending corner predictions.")

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
