import os
import sys
import re
from datetime import datetime, timezone

# Add python/src to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "python", "src"))

from tennis.db import TennisDbClient
from tennis.settlement import TennisSettlementEngine

def parse_env():
    env = {}
    env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    env[k.strip()] = v.strip().strip("'\"")
    return env

def main():
    env = parse_env()
    db = TennisDbClient(
        url=env.get("SUPABASE_URL"),
        service_key=env.get("SUPABASE_SERVICE_ROLE_KEY")
    )
    
    # Query settled tennis predictions where secondary_predictions is empty or None
    resp = db.client.get(
        "/tennis_predictions",
        params={
            "settlement_status": "neq.pending",
            "select": "id,fixture_id,market,prediction,probability,confidence_category,secondary_predictions,metadata,settlement_status,target_kickoff_at,fixture:tennis_fixtures(*,tournament:tennis_tournaments(*),player1:tennis_players!tennis_fixtures_player1_id_fkey(*),player2:tennis_players!tennis_fixtures_player2_id_fkey(*))",
            "order": "target_kickoff_at.desc",
            "limit": "200"
        }
    )
    resp.raise_for_status()
    predictions = resp.json()
    print(f"Total settled predictions inspected: {len(predictions)}")
    
    updated_count = 0
    for p in predictions:
        existing_secs = p.get("secondary_predictions")
        if existing_secs and len(existing_secs) > 0:
            continue
            
        fix = p.get("fixture")
        if not fix:
            continue
            
        p1 = fix.get("player1") or {}
        p2 = fix.get("player2") or {}
        p1_name = p1.get("display_name") or "Player 1"
        p2_name = p2.get("display_name") or "Player 2"
        
        meta = p.get("metadata") or {}
        p1_hold = meta.get("p1_hold_rate") or 0.75
        p2_hold = meta.get("p2_hold_rate") or 0.75
        exp_margin = meta.get("expected_game_margin") or 1.5
        exp_games = meta.get("expected_total_games") or 22.5
        best_of_sets = fix.get("best_of_sets") or 3
        
        fav_is_p1 = p1_hold >= p2_hold
        fav_name = p1_name if fav_is_p1 else p2_name
        dog_name = p2_name if fav_is_p1 else p1_name
        
        # 1. First set winner
        if fav_is_p1:
            first_set_pred = f"{p1_name} 1st Set"
            first_set_prob = round(float(0.52 + min(0.35, (p1_hold - p2_hold) * 0.8)), 4)
        else:
            first_set_pred = f"{p2_name} 1st Set"
            first_set_prob = round(float(0.52 + min(0.35, (p2_hold - p1_hold) * 0.8)), 4)
            
        # 2. Game Handicap
        raw_spread = round(abs(exp_margin) - 0.5) + 0.5
        spread_line = max(1.5, min(9.5, raw_spread))
        spread_pred = f"{dog_name} +{spread_line} Games"
        spread_prob = 0.58
        
        # 3. Set Handicap
        if (p.get("confidence_category") or "").upper().startswith("NO_SAFE"):
            set_pred = "Over 2.5 Sets" if best_of_sets == 3 else "Over 3.5 Sets"
            set_prob = 0.54
        else:
            set_pred = f"{fav_name} -1.5 Sets"
            set_prob = 0.62
            
        # 4. Total games over/under
        raw_ou = round(exp_games - 0.5) + 0.5
        min_ou = 17.5 if best_of_sets == 3 else 31.5
        max_ou = 27.5 if best_of_sets == 3 else 46.5
        ou_line = max(min_ou, min(max_ou, raw_ou))
        ou_pred = f"Over {ou_line} Games"
        ou_prob = 0.61
        
        raw_secs = [
            {"market": "game_handicap", "prediction": spread_pred, "probability": spread_prob},
            {"market": "first_set_winner", "prediction": first_set_pred, "probability": first_set_prob},
            {"market": "set_handicap", "prediction": set_pred, "probability": set_prob},
            {"market": "total_games_over_under", "prediction": ou_pred, "probability": ou_prob}
        ]
        
        # Evaluate secondary predictions against completed fixture
        settled_secs = TennisSettlementEngine.evaluate_secondary_predictions(raw_secs, fix)
        
        # Update in database
        patch_res = db.client.patch(
            "/tennis_predictions",
            json={"secondary_predictions": settled_secs},
            params={"id": f"eq.{p['id']}"}
        )
        patch_res.raise_for_status()
        updated_count += 1
        print(f"[{updated_count}] Restored secondary predictions for {p1_name} vs {p2_name} ({p.get('confidence_category')}) -> {len(settled_secs)} markets")

    print(f"Successfully restored {updated_count} settled tennis predictions with fully evaluated secondary predictions.")

if __name__ == "__main__":
    main()
