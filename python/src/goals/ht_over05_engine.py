"""
JamBets — Standalone 1st Half Over 0.5 Goals Blitz Engine
Mathematical Model: Bivariate Half-Time Dixon-Coles Poisson + First-Half Match Intent Index (FHTI).
Strictly decoupled: Independently evaluates, qualifies, and publishes to public.goals_predictions.
Zero reliance on or cross-talk with the full-time Over 2.5 engine.
"""

import sys
import os
import math
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

# Ensure project root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.goals.data_provider import GoalsDataProvider, WHITELISTED_LEAGUE_CODES
from python.src.goals.fotmob_enricher import ResilientFotMobEnricher
from python.src.goals.ht_dixon_coles import HalfTimeDixonColesModel
from python.src.goals.first_half_intent_engine import FirstHalfIntentEngine
from python.src.goals.ai_scout import GroundedGoalsAiScout


class HtOver05GoalsEngine:
    """
    Dedicated quantitative specialist engine for First-Half Over 0.5 Goals Blitz.
    """

    # First-half standard historical ratio relative to full-time baseline (~44% in elite leagues)
    DEFAULT_HT_RATIO = 0.44

    def __init__(self, db: Optional[CloudSupabaseClient] = None):
        self.db = db or CloudSupabaseClient()
        self.data_provider = GoalsDataProvider(db=self.db)
        self.enricher = ResilientFotMobEnricher()
        self.ai_scout = GroundedGoalsAiScout()

    def run(self, max_fixtures: int = 500, wipe_pending: bool = False) -> Dict[str, Any]:
        print("⏱️ [HtOver05Engine] Launching Standalone 1H Over 0.5 Goals Blitz Engine...")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()

        # 1. Ingest multi-week verified historical dataset
        loaded = self.data_provider.load_historical_dataset()
        print(f"📈 [HtOver05Engine] Active team profiles loaded: {len(self.data_provider.team_profiles)}")

        if wipe_pending:
            print("🧹 [HtOver05Engine] Wiping pending ht_over_0.5_goals predictions...")
            self.db.delete("goals_predictions", {
                "market": "eq.ht_over_0.5_goals",
                "settlement_status": "eq.pending"
            })

        # 2. Identify locked predictions (immutable within 48 hours or already settled)
        lock_window_iso = (now + timedelta(hours=48)).isoformat()
        locked_keys = set()
        try:
            existing = self.db.get("goals_predictions", {
                "market": "eq.ht_over_0.5_goals",
                "select": "id,fixture_id,market,target_kickoff_at,settlement_status",
                "limit": "1000"
            })
            for p in existing:
                fid = p["fixture_id"]
                status = p.get("settlement_status", "pending")
                kickoff = p.get("target_kickoff_at", "")
                if status in ("won", "lost", "void") or (kickoff and kickoff <= lock_window_iso):
                    locked_keys.add((fid, "ht_over_0.5_goals"))
            print(f"🔒 [HtOver05Engine] Preserving {len(locked_keys)} locked/settled 1H prediction records.")
        except Exception as e:
            print(f"⚠️ [HtOver05Engine] Lock check notice: {e}")

        # 3. Query forward scheduled fixtures (up to 4 days)
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "limit": str(max_fixtures)
        })

        if not fixtures:
            print("ℹ️ [HtOver05Engine] No forward candidate fixtures found.")
            return {"status": "success", "published": 0, "evaluated": 0}

        # Query team names
        team_ids = list(set(
            [f.get("home_team_id") for f in fixtures if f.get("home_team_id")] +
            [f.get("away_team_id") for f in fixtures if f.get("away_team_id")]
        ))
        teams: Dict[str, str] = {}
        for i in range(0, len(team_ids), 50):
            chunk = team_ids[i:i + 50]
            id_list = ','.join(chunk)
            for t in self.db.get("football_teams", {"id": f"in.({id_list})"}):
                teams[t["id"]] = t.get("short_name") or t.get("name")

        # Query leagues
        leagues_raw = self.db.get("football_leagues", {"limit": "500"})
        leagues: Dict[str, str] = {l["id"]: l["name"] for l in leagues_raw}
        league_codes: Dict[str, str] = {l["id"]: l.get("code", "") for l in leagues_raw}

        print(f"📊 [HtOver05Engine] Evaluating {len(fixtures)} candidate fixtures against 5 Quality Gates...")

        published_count = 0
        rejections = {
            "league_not_eligible": 0,
            "insufficient_sample_size": 0,
            "first_half_gridlock_intent": 0,
            "low_early_goal_expectancy": 0,
            "below_probability_threshold": 0
        }

        records_to_upsert: List[Dict[str, Any]] = []

        for f in fixtures:
            fid = f["id"]
            kickoff_at = f.get("target_kickoff_at")
            if not kickoff_at:
                continue

            try:
                k_dt = datetime.fromisoformat(kickoff_at.replace("Z", "+00:00"))
                if k_dt < (now - timedelta(minutes=5)) or k_dt > (now + timedelta(days=4)):
                    continue
            except Exception:
                continue

            canonical_key = f.get("canonical_key") or ""
            parts = canonical_key.split(":") if ":" in canonical_key else []
            l_code = parts[0] if len(parts) > 0 else league_codes.get(f.get("league_id"), "")
            h_slug = parts[1] if len(parts) > 1 else ""
            a_slug = parts[2] if len(parts) > 2 else ""

            home_team_id = f.get("home_team_id")
            away_team_id = f.get("away_team_id")
            home_name = teams.get(home_team_id) or h_slug
            away_name = teams.get(away_team_id) or a_slug
            league_name = leagues.get(f.get("league_id")) or "Football League"

            if not home_name or not away_name:
                continue

            # =================================================================
            # QUALITY GATE 1: League Whitelist
            # =================================================================
            if not self.data_provider.is_league_eligible(l_code, league_name):
                rejections["league_not_eligible"] += 1
                continue

            # =================================================================
            # QUALITY GATE 2: Sufficient Historical Sample Size
            # =================================================================
            hp = self.data_provider.get_team_profile(home_team_id) or self.data_provider.get_team_profile(h_slug)
            ap = self.data_provider.get_team_profile(away_team_id) or self.data_provider.get_team_profile(a_slug)

            if not hp or not ap or not hp.has_sufficient_history or not ap.has_sufficient_history:
                rejections["insufficient_sample_size"] += 1
                continue

            # Baseline 1H goal expectation for league
            baseline = self.data_provider.get_league_baseline(l_code)
            base_ht_h = baseline["home_goals"] * self.DEFAULT_HT_RATIO
            base_ht_a = baseline["away_goals"] * self.DEFAULT_HT_RATIO

            # =================================================================
            # QUALITY GATE 3: First-Half Match Intent & Early Urgency
            # =================================================================
            intent = FirstHalfIntentEngine.evaluate_first_half_intent(
                home_team=home_name,
                away_team=away_name,
                league_code=l_code,
                league_name=league_name,
                competition_stage=f.get("competition_stage"),
                home_clean_sheet_pct=hp.home_clean_sheet_pct,
                away_clean_sheet_pct=ap.away_clean_sheet_pct,
                home_scoring_rate=hp.home_scoring_rate,
                away_scoring_rate=ap.away_scoring_rate,
                metadata=f.get("metadata")
            )

            # Reject low-block early stalemates or high-friction cagey openings
            if not intent.is_favorable_for_ht05 or intent.first_half_intent_index < 0.86:
                rejections["first_half_gridlock_intent"] += 1
                continue

            # =================================================================
            # Compute Half-Time Projected Lambdas
            # =================================================================
            K = 4.0
            w_h = hp.home_matches / (hp.home_matches + K)
            w_a = ap.away_matches / (ap.away_matches + K)

            att_h = w_h * (hp.home_scoring_rate / max(0.5, baseline["home_goals"])) + (1.0 - w_h) * 1.0
            def_h = w_h * (hp.home_conceding_rate / max(0.5, baseline["away_goals"])) + (1.0 - w_h) * 1.0
            att_a = w_a * (ap.away_scoring_rate / max(0.5, baseline["away_goals"])) + (1.0 - w_a) * 1.0
            def_a = w_a * (ap.away_conceding_rate / max(0.5, baseline["home_goals"])) + (1.0 - w_a) * 1.0

            # Scale base 1H rates by attack/defense and First-Half Intent Index (FHTI)
            lambda_ht_h = base_ht_h * att_h * def_a * intent.lambda_ht_modifier
            lambda_ht_a = base_ht_a * att_a * def_h * intent.lambda_ht_modifier

            # Blend with rolling FotMob xG if available
            xg_home = self.enricher.get_team_xg_metrics(home_name, l_code)
            xg_away = self.enricher.get_team_xg_metrics(away_name, l_code)
            if xg_home and "npxg_for" in xg_home:
                lambda_ht_h = 0.70 * lambda_ht_h + 0.30 * (xg_home["npxg_for"] * self.DEFAULT_HT_RATIO)
            if xg_away and "npxg_for" in xg_away:
                lambda_ht_a = 0.70 * lambda_ht_a + 0.30 * (xg_away["npxg_for"] * self.DEFAULT_HT_RATIO)

            lambda_ht_h = round(max(0.20, min(2.40, lambda_ht_h)), 2)
            lambda_ht_a = round(max(0.15, min(2.00, lambda_ht_a)), 2)
            combined_ht_lambda = lambda_ht_h + lambda_ht_a

            # =================================================================
            # QUALITY GATE 4: 1H Goal Expectancy Floor
            # Combined 1H expected goals must be >= 1.05
            # =================================================================
            if combined_ht_lambda < 1.05:
                rejections["low_early_goal_expectancy"] += 1
                continue

            # =================================================================
            # BIVARIATE HALF-TIME DIXON-COLES PROBABILITIES
            # =================================================================
            dixon_ht = HalfTimeDixonColesModel.calculate_probabilities(lambda_ht_h, lambda_ht_a)
            raw_p_ht05 = dixon_ht["p_ht_over05"]

            # =================================================================
            # GROUNDED AI TACTICAL SCOUT
            # =================================================================
            ai_res = self.ai_scout.analyze_fixture_goals(
                home_team=home_name,
                away_team=away_name,
                league_name=league_name,
                lambda_h=round(lambda_ht_h / self.DEFAULT_HT_RATIO, 2),
                lambda_a=round(lambda_ht_a / self.DEFAULT_HT_RATIO, 2),
                p_over25=raw_p_ht05,
                p_btts=dixon_ht["p_btts_ht"],
                mii=intent.first_half_intent_index,
                intent_classification=intent.intent_classification,
                home_over25_rate=int(hp.home_over25_pct * 100),
                away_over25_rate=int(ap.away_over25_pct * 100),
                home_clean_sheet_rate=int(hp.home_clean_sheet_pct * 100),
                away_clean_sheet_rate=int(ap.away_clean_sheet_pct * 100)
            )

            final_p_ht05 = round(max(0.25, min(0.97, raw_p_ht05)), 4)

            # =================================================================
            # QUALITY GATE 5: High-Conviction Probability Threshold (>= 76%)
            # =================================================================
            if final_p_ht05 < 0.76:
                rejections["below_probability_threshold"] += 1
                continue

            # Check locked predictions
            if (fid, "ht_over_0.5_goals") in locked_keys:
                continue

            # Determine Tier
            # EARLY_STRIKE: Prob >= 82% & FHTI >= 1.05; TEMPO_HIGH: 76% <= Prob < 82%
            if final_p_ht05 >= 0.82 and intent.first_half_intent_index >= 1.05:
                tier = "EARLY_STRIKE"
            else:
                tier = "TEMPO_HIGH"

            # Shared Metadata
            meta = {
                "home_team": home_name,
                "away_team": away_name,
                "league": league_name,
                "lambda_ht_home": lambda_ht_h,
                "lambda_ht_away": lambda_ht_a,
                "lambda_ht_combined": dixon_ht["lambda_ht_combined"],
                "first_half_intent_index": intent.first_half_intent_index,
                "early_strike_tempo": intent.early_strike_tempo,
                "intent_classification": intent.intent_classification,
                "intent_rationale": intent.intent_rationale,
                "tactical_rationale": ai_res["tactical_rationale"],
                "goal_tempo": ai_res["goal_tempo"],
                "ai_confidence": ai_res["ai_confidence"],
                "ai_source": ai_res["source"],
                "expected_first_goal_minute": dixon_ht["expected_first_goal_minute"],
                "home_matches_evaluated": hp.matches_analyzed,
                "away_matches_evaluated": ap.matches_analyzed,
                "home_clean_sheet_pct": round(hp.home_clean_sheet_pct, 2),
                "away_clean_sheet_pct": round(ap.away_clean_sheet_pct, 2),
                "generated_at": now_iso
            }

            records_to_upsert.append({
                "fixture_id": fid,
                "market": "ht_over_0.5_goals",
                "predicted_outcome": "HT_OVER_0.5",
                "probability": final_p_ht05,
                "confidence_tier": tier,
                "xg_combined": round(dixon_ht["lambda_ht_combined"] / self.DEFAULT_HT_RATIO, 2),
                "home_over25_rate": int(hp.home_over25_pct * 100),
                "away_over25_rate": int(ap.away_over25_pct * 100),
                "h2h_over25_rate": int(round((hp.home_over25_pct + ap.away_over25_pct) / 2.0 * 100)),
                "ht_goal_frequency": int(final_p_ht05 * 100),
                "avg_first_goal_minute": dixon_ht["expected_first_goal_minute"],
                "target_kickoff_at": kickoff_at,
                "settlement_status": "pending",
                "metadata": meta
            })
            published_count += 1

        # Batch upsert into public.goals_predictions
        if records_to_upsert:
            batch_size = 50
            for i in range(0, len(records_to_upsert), batch_size):
                chunk = records_to_upsert[i:i + batch_size]
                try:
                    self.db.post("goals_predictions", chunk, on_conflict="fixture_id,market")
                except Exception as e:
                    print(f"⚠️ [HtOver05Engine] Batch insert notice: {e}")

        print(f"✅ [HtOver05Engine] Completed run. Published {published_count} 1H Over 0.5 Goals Blitz predictions.")
        print(f"   Rejection Breakdown: {rejections}")

        return {
            "status": "success",
            "published": published_count,
            "rejections": rejections
        }
