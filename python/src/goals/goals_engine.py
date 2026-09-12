"""
JamBets — Goals Specialist Analysis & Simulation Engine
Autonomous pipeline generating pure Over 2.5 Goals and First Half Over 0.5 Goals predictions.
Runs strictly independently from the core banker prediction engine.
"""

import sys
import os
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

# Ensure project root is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.goals.goals_model import GoalsModel

class GoalsEngine:
    """
    Dedicated engine evaluating upcoming fixtures strictly for
    Over 2.5 Goals and 1st Half Over 0.5 Goals signals.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()

    def run(self, max_fixtures: int = 500) -> Dict[str, Any]:
        """
        Executes a complete goals simulation & prediction pass.
        Returns summary statistics.
        """
        print("⚽ [GoalsEngine] Starting Goals Specialist Simulation Pass...")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        # Strictly current time and future (max 4 days ahead). Never past games.
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()

        # 1. Fetch eligible current and future scheduled fixtures (Strictly current to 4 days ahead, NOT past games)
        # Read-only query against football_fixtures
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "limit": str(max_fixtures)
        })

        if not fixtures:
            print("ℹ️ [GoalsEngine] No active/future fixtures found for goal analysis.")
            return {"status": "success", "processed": 0, "published": 0}

        # Cache league names and team names
        leagues = {l['id']: l['name'] for l in self.db.get("football_leagues")}
        teams = {t['id']: t['name'] for t in self.db.get("football_teams")}

        print(f"📊 [GoalsEngine] Evaluating {len(fixtures)} fixtures for Goal signals (Strictly current to 4 days ahead)...")

        over25_count = 0
        ht05_count = 0
        records_to_upsert: List[Dict[str, Any]] = []

        for f in fixtures:
            fid = f["id"]
            status = (f.get("status") or "").lower()
            if status in ("finished", "ft", "cancelled", "postponed"):
                continue

            kickoff_at = f.get("target_kickoff_at")
            if not kickoff_at:
                continue

            try:
                k_dt = datetime.fromisoformat(kickoff_at.replace("Z", "+00:00"))
                if k_dt < (now - timedelta(minutes=5)) or k_dt > (now + timedelta(days=4)):
                    continue
            except Exception:
                continue
            home_name = teams.get(f.get("home_team_id"), "Home Team")
            away_name = teams.get(f.get("away_team_id"), "Away Team")
            league_name = leagues.get(f.get("league_id"), "Football League")
            kickoff_at = f["target_kickoff_at"]

            # Evaluate with specialized mathematical model
            eval_res = GoalsModel.evaluate_fixture_goals(
                fixture_id=fid,
                home_team=home_name,
                away_team=away_name,
                league_name=league_name
            )

            p_over25 = eval_res["prob_over25"]
            p_ht05 = eval_res["prob_ht_05"]

            # Market 1: Over 2.5 Goals (Threshold: >= 60%)
            if p_over25 >= 0.60:
                tier = "GOAL_MACHINE" if p_over25 >= 0.75 else ("OVER_25_LOCK" if p_over25 >= 0.68 else "LEAN_OVER")
                records_to_upsert.append({
                    "fixture_id": fid,
                    "market": "over_2.5_goals",
                    "predicted_outcome": "OVER_2.5",
                    "probability": p_over25,
                    "confidence_tier": tier,
                    "xg_combined": eval_res["xg_combined"],
                    "home_over25_rate": eval_res["home_over25_rate"],
                    "away_over25_rate": eval_res["away_over25_rate"],
                    "h2h_over25_rate": eval_res["h2h_over25_rate"],
                    "ht_goal_frequency": eval_res["ht_goal_frequency"],
                    "avg_first_goal_minute": eval_res["avg_first_goal_minute"],
                    "target_kickoff_at": kickoff_at,
                    "settlement_status": "pending",
                    "metadata": {
                        "lambda_home": eval_res["lambda_home"],
                        "lambda_away": eval_res["lambda_away"],
                        "home_team": home_name,
                        "away_team": away_name,
                        "league": league_name,
                        "generated_at": now_iso
                    }
                })
                over25_count += 1

            # Market 2: First Half Over 0.5 Goals (Threshold: >= 72%)
            if p_ht05 >= 0.72:
                tier = "EARLY_STRIKE" if p_ht05 >= 0.82 else "TEMPO_HIGH"
                records_to_upsert.append({
                    "fixture_id": fid,
                    "market": "ht_over_0.5_goals",
                    "predicted_outcome": "HT_OVER_0.5",
                    "probability": p_ht05,
                    "confidence_tier": tier,
                    "xg_combined": eval_res["xg_combined"],
                    "home_over25_rate": eval_res["home_over25_rate"],
                    "away_over25_rate": eval_res["away_over25_rate"],
                    "h2h_over25_rate": eval_res["h2h_over25_rate"],
                    "ht_goal_frequency": eval_res["ht_goal_frequency"],
                    "avg_first_goal_minute": eval_res["avg_first_goal_minute"],
                    "target_kickoff_at": kickoff_at,
                    "settlement_status": "pending",
                    "metadata": {
                        "lambda_home": eval_res["lambda_home"],
                        "lambda_away": eval_res["lambda_away"],
                        "home_team": home_name,
                        "away_team": away_name,
                        "league": league_name,
                        "generated_at": now_iso
                    }
                })
                ht05_count += 1

        # 2. Batch upsert into public.goals_predictions
        if records_to_upsert:
            # Batch in chunks of 50 to respect PostgREST limits
            batch_size = 50
            for i in range(0, len(records_to_upsert), batch_size):
                chunk = records_to_upsert[i:i + batch_size]
                self.db.post("goals_predictions", chunk, on_conflict="fixture_id,market")

        print(f"✅ [GoalsEngine] Published {len(records_to_upsert)} goals predictions "
              f"({over25_count} Over 2.5 Goals, {ht05_count} 1H Over 0.5 Goals).")

        return {
            "status": "success",
            "fixtures_evaluated": len(fixtures),
            "total_predictions": len(records_to_upsert),
            "over_25_count": over25_count,
            "ht_05_count": ht05_count
        }

if __name__ == "__main__":
    engine = GoalsEngine()
    engine.run()
