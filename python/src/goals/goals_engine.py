"""
Addsbanta — Goals Specialist Analysis & Simulation Engine (Phase 11 Upgrade)
Autonomous pipeline generating pure Over 2.5 Goals and First Half Over 0.5 Goals predictions.
Driven by genuine empirical team attack/defense ratings, FotMob rolling xG metrics,
and Gemini AI tactical reasoning layer.
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
from python.src.goals.goals_model import GoalsModel, EmpiricalStatsRegistry
from python.src.goals.goals_scraper_enricher import GoalsScraperEnricher
from python.src.goals.ai_scout import GoalsAiScout


def clean_league_name(name: str) -> str:
    if not name:
        return "Football League"
    fixes = {
        "Brasileiro Srie A": "Brasileirão Série A",
        "Liga Profesional de Ftbol": "Liga Profesional de Fútbol",
        "Sper Lig": "Süper Lig",
    }
    for bad, good in fixes.items():
        name = name.replace(bad, good)
    return name


class GoalsEngine:
    """
    Dedicated engine evaluating upcoming fixtures strictly for
    Over 2.5 Goals and 1st Half Over 0.5 Goals signals.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()
        self.registry = EmpiricalStatsRegistry.get_instance()
        self.enricher = GoalsScraperEnricher()
        self.ai_scout = GoalsAiScout()

    def run(self, max_fixtures: int = 500, wipe: bool = False) -> Dict[str, Any]:
        """
        Executes a complete goals simulation & prediction pass.
        Returns summary statistics.
        """
        print("⚽ [GoalsEngine] Starting Upgraded Goals Specialist Engine (Empirical + FotMob + Gemini AI)...")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()

        # 1. Load empirical match records from DB into Registry
        loaded_count = self.registry.load_from_db(self.db)
        print(f"📈 [GoalsEngine] Ingested {loaded_count} settled matches into Empirical Goal Registry.")
        print(f"    League Baselines: Home Goals={self.registry.global_averages['home_goals_per_game']}, "
              f"Away Goals={self.registry.global_averages['away_goals_per_game']}, "
              f"HT 0.5 Rate={self.registry.global_averages['ht_over05_rate']*100:.1f}%, "
              f"Over 2.5 Rate={self.registry.global_averages['over25_rate']*100:.1f}%")

        # 1b. Fetch locked predictions within Current Day & Next Day (48-hour window) and any settled records
        lock_window_iso = (now + timedelta(hours=48)).isoformat()
        locked_keys = set()

        if not wipe:
            try:
                locked_48h = self.db.get("goals_predictions", {
                    "target_kickoff_at": f"lte.{lock_window_iso}",
                    "select": "fixture_id,market"
                })
                for p in (locked_48h or []):
                    locked_keys.add((p.get("fixture_id"), p.get("market")))

                settled_preds = self.db.get("goals_predictions", {
                    "settlement_status": "in.(won,lost,void)",
                    "select": "fixture_id,market"
                })
                for p in (settled_preds or []):
                    locked_keys.add((p.get("fixture_id"), p.get("market")))

                if locked_keys:
                    print(f"🔒 [GoalsEngine] Identified {len(locked_keys)} locked prediction records (Current Day, Next Day, or Settled).")
                    print("   These records are strictly IMMUTABLE and will NEVER be recalculated or overwritten.")
            except Exception as e:
                print(f"⚠️ [GoalsEngine] Error querying locked predictions: {e}")

        if wipe:
            print("🧹 [GoalsEngine] Wiping existing goals_predictions table for fresh regeneration...")
            self.db.delete("goals_predictions", {"id": "neq.00000000-0000-0000-0000-000000000000"})

        # 2. Fetch eligible current and future scheduled fixtures (strictly current time to forward 4 days)
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "limit": str(max_fixtures)
        })

        if not fixtures:
            print("ℹ️ [GoalsEngine] No active/future fixtures found for goal analysis.")
            return {"status": "success", "processed": 0, "published": 0}

        # Query all teams for these fixtures specifically
        team_ids = list(set([f.get("home_team_id") for f in fixtures if f.get("home_team_id")] +
                            [f.get("away_team_id") for f in fixtures if f.get("away_team_id")]))
        teams: Dict[str, str] = {}
        for i in range(0, len(team_ids), 50):
            chunk = team_ids[i:i + 50]
            id_list = ','.join(chunk)
            for t in self.db.get("football_teams", {"id": f"in.({id_list})"}):
                teams[t["id"]] = t.get("short_name") or t.get("name")

        # Query leagues
        leagues_raw = self.db.get("football_leagues", {"limit": "500"})
        leagues: Dict[str, str] = {l["id"]: clean_league_name(l["name"]) for l in leagues_raw}
        league_codes: Dict[str, str] = {l["code"]: clean_league_name(l["name"]) for l in leagues_raw if l.get("code")}

        print(f"📊 [GoalsEngine] Evaluating {len(fixtures)} fixtures for Goal signals...")

        over25_count = 0
        ht05_count = 0
        locked_skipped_count = 0
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

            # Team & League resolution
            canonical_key = f.get("canonical_key") or ""
            parts = canonical_key.split(":") if ":" in canonical_key else []
            l_code = parts[0] if len(parts) > 0 else ""
            h_slug = parts[1] if len(parts) > 1 else ""
            a_slug = parts[2] if len(parts) > 2 else ""

            home_team_id = f.get("home_team_id")
            away_team_id = f.get("away_team_id")
            home_name = teams.get(home_team_id) or h_slug
            away_name = teams.get(away_team_id) or a_slug
            league_name = leagues.get(f.get("league_id")) or league_codes.get(l_code) or "Football League"
            league_name = clean_league_name(league_name)

            if not home_name or not away_name or home_name in ("Home Team", "Club") or away_name in ("Away Team", "Club"):
                continue

            # Retrieve rolling npxG from FotMob enricher if available
            xg_home = self.enricher.get_team_xg_metrics(home_name, l_code)
            xg_away = self.enricher.get_team_xg_metrics(away_name, l_code)

            # Evaluate with genuine empirical mathematical model
            eval_res = GoalsModel.evaluate_fixture_goals(
                home_team_id=home_team_id,
                away_team_id=away_team_id,
                home_team_name=home_name,
                away_team_name=away_name,
                league_name=league_name,
                xg_metrics_home=xg_home,
                xg_metrics_away=xg_away,
                registry=self.registry
            )

            raw_p_over25 = eval_res["prob_over25"]
            raw_p_ht05 = eval_res["prob_ht_05"]

            # AI Tactical Scout Analysis
            ai_res = self.ai_scout.analyze_fixture_goals(
                home_team=home_name,
                away_team=away_name,
                league=league_name,
                lambda_home=eval_res["lambda_home"],
                lambda_away=eval_res["lambda_away"],
                prob_over25=raw_p_over25,
                prob_ht05=raw_p_ht05,
                home_o25_rate=eval_res["home_over25_rate"],
                away_o25_rate=eval_res["away_over25_rate"],
                ht_goal_frequency=eval_res["ht_goal_frequency"]
            )

            # Final calibrated probabilities combining empirical math + AI qualitative scout
            final_p_over25 = round(max(0.10, min(0.95, raw_p_over25 + ai_res["over25_adjustment"])), 4)
            final_p_ht05 = round(max(0.25, min(0.97, raw_p_ht05 + ai_res["ht05_adjustment"])), 4)

            # Upgraded Strict +EV Thresholds:
            # Over 2.5 requires >= 64% | 1H Over 0.5 requires >= 74%
            qualifies_over25 = final_p_over25 >= 0.64
            qualifies_ht05 = final_p_ht05 >= 0.74

            # Shared metadata
            base_meta = {
                "lambda_home": eval_res["lambda_home"],
                "lambda_away": eval_res["lambda_away"],
                "lambda_ht_home": eval_res["lambda_ht_home"],
                "lambda_ht_away": eval_res["lambda_ht_away"],
                "home_team": home_name,
                "away_team": away_name,
                "league": league_name,
                "generated_at": now_iso,
                "tactical_rationale": ai_res["tactical_rationale"],
                "goal_tempo": ai_res["goal_tempo"],
                "ai_confidence": ai_res["ai_confidence"],
                "ai_source": ai_res["source"],
                "home_matches_evaluated": eval_res["home_matches_evaluated"],
                "away_matches_evaluated": eval_res["away_matches_evaluated"]
            }

            # -------------------------------------------------------------
            # MARKET 1: Over 2.5 Goals (Completely Decoupled & Independent)
            # -------------------------------------------------------------
            if qualifies_over25:
                if (fid, "over_2.5_goals") in locked_keys:
                    locked_skipped_count += 1
                else:
                    tier_over25 = "GOAL_MACHINE" if final_p_over25 >= 0.78 else ("OVER_25_LOCK" if final_p_over25 >= 0.70 else "LEAN_OVER")
                    records_to_upsert.append({
                        "fixture_id": fid,
                        "market": "over_2.5_goals",
                        "predicted_outcome": "OVER_2.5",
                        "probability": final_p_over25,
                        "confidence_tier": tier_over25,
                        "xg_combined": eval_res["xg_combined"],
                        "home_over25_rate": eval_res["home_over25_rate"],
                        "away_over25_rate": eval_res["away_over25_rate"],
                        "h2h_over25_rate": eval_res["h2h_over25_rate"],
                        "ht_goal_frequency": eval_res["ht_goal_frequency"],
                        "avg_first_goal_minute": eval_res["avg_first_goal_minute"],
                        "target_kickoff_at": kickoff_at,
                        "settlement_status": "pending",
                        "metadata": base_meta
                    })
                    over25_count += 1

            # -------------------------------------------------------------
            # MARKET 2: 1H Over 0.5 Goals (Completely Decoupled & Independent)
            # -------------------------------------------------------------
            if qualifies_ht05:
                if (fid, "ht_over_0.5_goals") in locked_keys:
                    locked_skipped_count += 1
                else:
                    tier_ht05 = "EARLY_STRIKE" if final_p_ht05 >= 0.82 else ("TEMPO_HIGH" if final_p_ht05 >= 0.76 else "LEAN_OVER")
                    records_to_upsert.append({
                        "fixture_id": fid,
                        "market": "ht_over_0.5_goals",
                        "predicted_outcome": "HT_OVER_0.5",
                        "probability": final_p_ht05,
                        "confidence_tier": tier_ht05,
                        "xg_combined": eval_res["xg_combined"],
                        "home_over25_rate": eval_res["home_over25_rate"],
                        "away_over25_rate": eval_res["away_over25_rate"],
                        "h2h_over25_rate": eval_res["h2h_over25_rate"],
                        "ht_goal_frequency": eval_res["ht_goal_frequency"],
                        "avg_first_goal_minute": eval_res["avg_first_goal_minute"],
                        "target_kickoff_at": kickoff_at,
                        "settlement_status": "pending",
                        "metadata": base_meta
                    })
                    ht05_count += 1

        # Batch upsert into public.goals_predictions
        if records_to_upsert:
            batch_size = 50
            for i in range(0, len(records_to_upsert), batch_size):
                chunk = records_to_upsert[i:i + batch_size]
                self.db.post("goals_predictions", chunk, on_conflict="fixture_id,market")

        print(f"✅ [GoalsEngine] Published {len(records_to_upsert)} calibrated goals predictions "
              f"({over25_count} Over 2.5 Goals, {ht05_count} 1H Over 0.5 Goals, {locked_skipped_count} protected by 2-day lock).")

        return {
            "status": "success",
            "evaluated": len(fixtures),
            "published": len(records_to_upsert),
            "over25_count": over25_count,
            "ht05_count": ht05_count,
            "locked_skipped_count": locked_skipped_count
        }


if __name__ == "__main__":
    engine = GoalsEngine()
    engine.run()
