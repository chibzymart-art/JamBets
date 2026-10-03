"""
Phase 3 Database Upgrade:
Upgrades legacy won predictions in public.tennis_predictions so that their
secondary_predictions array is upgraded from legacy duplicate match_winner
to the 4 dynamic derivative markets (game_handicap, first_set_winner, set_handicap, total_games_over_under).
Preserves settlement_status ('won'), settled_at, actual_result, and settlement_notes.
"""

import os
import sys
import json
from datetime import datetime, timezone

sys.path.insert(0, os.path.abspath("."))
sys.path.insert(0, os.path.abspath("python"))

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

from python.src.tennis.db import TennisDbClient
from python.src.tennis.prediction_engine import TennisPredictionEngine


def upgrade_settled_predictions():
    print("=" * 80)
    print(" PHASE 3: UPGRADE SETTLED TENNIS PREDICTIONS TO DYNAMIC DERIVATIVE MARKETS")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 80)

    db = TennisDbClient()
    engine = TennisPredictionEngine(db_client=db, simulations_count=50000)

    # 1. Fetch won predictions
    resp = db.client.get(
        "/tennis_predictions",
        params={
            "settlement_status": "eq.won",
            "select": "id,fixture_id,settlement_status,settled_at,settlement_notes,actual_result,secondary_predictions",
            "order": "target_kickoff_at.desc",
            "limit": "200"
        }
    )
    resp.raise_for_status()
    won_preds = resp.json()

    print(f"\n[QUERY] Found {len(won_preds)} won predictions to evaluate.")

    # Filter to those that contain legacy match_winner
    targets = []
    for p in won_preds:
        secs = p.get("secondary_predictions") or []
        markets = [s.get("market") for s in secs]
        if "match_winner" in markets or "game_handicap" not in markets:
            targets.append(p)

    print(f"[TARGETS] {len(targets)} records require secondary market upgrade.\n")

    if not targets:
        print("[DONE] No records need updating.")
        return

    # Fetch corresponding fixtures in batch
    fixture_ids = [t["fixture_id"] for t in targets]
    # Fetch in chunks of 50 to avoid URL length issues
    chunk_size = 40
    fixture_map = {}
    for i in range(0, len(fixture_ids), chunk_size):
        chunk = fixture_ids[i:i + chunk_size]
        f_resp = db.client.get(
            "/tennis_fixtures",
            params={
                "id": f"in.({','.join(chunk)})",
                "select": "*,tournament:tennis_tournaments(*),player1:tennis_players!tennis_fixtures_player1_id_fkey(*),player2:tennis_players!tennis_fixtures_player2_id_fkey(*)"
            }
        )
        f_resp.raise_for_status()
        for fix in f_resp.json():
            fixture_map[fix["id"]] = fix

    print(f"[FIXTURES] Successfully retrieved {len(fixture_map)} fixtures from Supabase.\n")

    updated_count = 0
    for idx, p in enumerate(targets, start=1):
        pred_id = p["id"]
        f_id = p["fixture_id"]
        fixture = fixture_map.get(f_id)

        if not fixture:
            print(f"[{idx}/{len(targets)}] Fixture {f_id} not found in DB, skipping.")
            continue

        p1_name = (fixture.get("player1") or {}).get("display_name", "P1")
        p2_name = (fixture.get("player2") or {}).get("display_name", "P2")
        print(f"[{idx}/{len(targets)}] Calibrating derivative markets: {p1_name} vs {p2_name}...", end=" ", flush=True)

        try:
            new_pred = engine.generate_prediction_for_fixture(fixture)
            if not new_pred or not new_pred.get("secondary_predictions"):
                print("❌ Simulation returned no secondary markets.")
                continue

            # Patch only secondary_predictions and metadata, keeping settlement intact
            patch_data = {
                "secondary_predictions": new_pred["secondary_predictions"],
                "metadata": {
                    **(new_pred.get("metadata") or {}),
                    "phase3_calibrated_at": datetime.now(timezone.utc).isoformat()
                }
            }

            patch_resp = db.client.patch(
                "/tennis_predictions",
                json=patch_data,
                params={"id": f"eq.{pred_id}"}
            )
            patch_resp.raise_for_status()
            updated_count += 1
            print(f"✅ Upgraded ({len(new_pred['secondary_predictions'])} derivative markets)")

        except Exception as e:
            print(f"❌ Error: {e}")

    print("\n" + "=" * 80)
    print(f" UPGRADE COMPLETE: {updated_count} / {len(targets)} won predictions successfully updated.")
    print("=" * 80)


if __name__ == "__main__":
    upgrade_settled_predictions()
