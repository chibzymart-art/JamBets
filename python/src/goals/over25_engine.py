"""
JamBets — Over 2.5 Goals Specialist Engine (Ground-Up Rebuild)
Integrates:
1. High-capacity historical data provider (minimum 6 matches per team)
2. Strict Tier 1 & Tier 2 competition whitelisting (bans amateur non-league)
3. Resilient FotMob rolling npxG enricher
4. Match Intent & Contextual Stakes Engine (MII multiplier)
5. Bivariate Dixon-Coles joint distribution modeling
6. 5-Stage Multi-Factor Quality Gates
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
from python.src.goals.data_provider import GoalsDataProvider
from python.src.goals.fotmob_enricher import ResilientFotMobEnricher
from python.src.goals.match_intent_engine import MatchIntentEngine
from python.src.goals.dixon_coles_goals import DixonColesGoalsModel
from python.src.goals.ai_scout import GroundedGoalsAiScout
from python.src.football.h2h_analyzer import H2HAnalyzer
from python.src.sources.google_news import GoogleNewsAdapter


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


class Over25GoalsEngine:
    """
    Dedicated institutional engine evaluating fixtures strictly for
    Over 2.5 Goals and 1st Half Over 0.5 Goals signals.
    """

    def __init__(self, db: Optional[CloudSupabaseClient] = None):
        self.db = db or CloudSupabaseClient()
        self.data_provider = GoalsDataProvider(self.db)
        self.enricher = ResilientFotMobEnricher()
        self.ai_scout = GroundedGoalsAiScout()
        self.google_news = GoogleNewsAdapter()

    def run(self, max_fixtures: int = 500, wipe_pending: bool = False) -> Dict[str, Any]:
        """
        Executes a complete Over 2.5 evaluation pass.
        """
        print("⚽ [Over25Engine] Launching Rebuilt Institutional Over 2.5 Goals Engine...")
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()

        # 1. Load verified historical data into provider
        loaded = self.data_provider.load_historical_dataset()
        print(f"📈 [Over25Engine] Active team profiles loaded: {len(self.data_provider.team_profiles)}")

        if wipe_pending:
            print("🧹 [Over25Engine] Wiping pending over_2.5_goals predictions...")
            self.db.delete("goals_predictions", {
                "market": "eq.over_2.5_goals",
                "settlement_status": "eq.pending"
            })

        # 2. Identify locked predictions (immutable within 48 hours or already settled)
        lock_window_iso = (now + timedelta(hours=48)).isoformat()
        locked_keys = set()
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
                print(f"🔒 [Over25Engine] Preserving {len(locked_keys)} locked/settled prediction records.")
        except Exception as e:
            print(f"⚠️ [Over25Engine] Lock check notice: {e}")

        # 3. Query forward scheduled fixtures (up to 4 days)
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "limit": str(max_fixtures)
        })

        if not fixtures:
            print("ℹ️ [Over25Engine] No forward fixtures found for goal analysis.")
            return {"status": "success", "evaluated": 0, "published": 0}

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
        leagues: Dict[str, str] = {l["id"]: clean_league_name(l["name"]) for l in leagues_raw}
        league_codes: Dict[str, str] = {l["id"]: l.get("code", "") for l in leagues_raw}

        print(f"📊 [Over25Engine] Evaluating {len(fixtures)} candidate fixtures against 5 Quality Gates...")

        records_to_upsert: List[Dict[str, Any]] = []
        over25_published = 0
        ht05_published = 0
        rejections: Dict[str, int] = {
            "league_not_eligible": 0,
            "insufficient_sample_size": 0,
            "tactical_gridlock_intent": 0,
            "underdog_blowout_risk": 0,
            "clean_sheet_suppression": 0,
            "below_probability_threshold": 0
        }

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
            # QUALITY GATE 1: Competition Whitelist
            # =================================================================
            if not self.data_provider.is_league_eligible(l_code, league_name):
                rejections["league_not_eligible"] += 1
                continue

            # =================================================================
            # QUALITY GATE 2: Minimum Sample Size (>= 6 verified matches)
            # =================================================================
            hp = self.data_provider.get_team_profile(home_team_id) or self.data_provider.get_team_profile(h_slug)
            ap = self.data_provider.get_team_profile(away_team_id) or self.data_provider.get_team_profile(a_slug)

            # Require sufficient history for both clubs (strictly prevents blind 1.80+1.52 defaults)
            if not hp or not ap or not hp.has_sufficient_history or not ap.has_sufficient_history:
                rejections["insufficient_sample_size"] += 1
                continue

            # Retrieve baseline league goal expectations
            baseline = self.data_provider.get_league_baseline(l_code)
            base_h = baseline["home_goals"]
            base_a = baseline["away_goals"]

            # =================================================================
            # QUALITY GATE 3: Match Intent & Contextual Stakes
            # =================================================================
            intent = MatchIntentEngine.evaluate_intent(
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

            # Reject if tactical gridlock (fear of losing / low-block mid-block clash)
            if intent.intent_classification == "TACTICAL_GRIDLOCK_PRAGMATISM" or intent.match_intent_index < 0.88:
                rejections["tactical_gridlock_intent"] += 1
                continue

            # =================================================================
            # Compute Dixon-Coles Projected Lambdas
            # =================================================================
            # Bayesian weighted attack/defense
            K = 4.0
            w_h = hp.home_matches / (hp.home_matches + K)
            w_a = ap.away_matches / (ap.away_matches + K)

            att_h = w_h * (hp.home_scoring_rate / max(0.5, base_h)) + (1.0 - w_h) * 1.0
            def_h = w_h * (hp.home_conceding_rate / max(0.5, base_a)) + (1.0 - w_h) * 1.0
            att_a = w_a * (ap.away_scoring_rate / max(0.5, base_a)) + (1.0 - w_a) * 1.0
            def_a = w_a * (ap.away_conceding_rate / max(0.5, base_h)) + (1.0 - w_a) * 1.0

            # Scale by Match Intent Index (MII)
            lambda_h = base_h * att_h * def_a * intent.lambda_modifier
            lambda_a = base_a * att_a * def_h * intent.lambda_modifier

            # Blend with rolling FotMob npxG if available
            xg_home = self.enricher.get_team_xg_metrics(home_name, l_code)
            xg_away = self.enricher.get_team_xg_metrics(away_name, l_code)

            if xg_home and "npxg_for" in xg_home:
                lambda_h = 0.65 * lambda_h + 0.35 * xg_home["npxg_for"]
            if xg_away and "npxg_for" in xg_away:
                lambda_a = 0.65 * lambda_a + 0.35 * xg_away["npxg_for"]

            # Live Intelligence: Squad Injuries & News
            debuff_h, debuff_a = 1.0, 1.0
            try:
                h_news = self.google_news.fetch_injury_news(home_name)
                if h_news and "modifier_debuff" in h_news:
                    debuff_h = float(h_news.get("modifier_debuff", 1.0))
                a_news = self.google_news.fetch_injury_news(away_name)
                if a_news and "modifier_debuff" in a_news:
                    debuff_a = float(a_news.get("modifier_debuff", 1.0))
            except Exception:
                pass

            # Direct H2H Analysis
            h2h_res = H2HAnalyzer.analyze(home_name, away_name)

            lambda_h = lambda_h * debuff_h * h2h_res.h2h_lambda_home_mod
            lambda_a = lambda_a * debuff_a * h2h_res.h2h_lambda_away_mod

            lambda_h = round(max(0.40, min(3.80, lambda_h)), 2)
            lambda_a = round(max(0.30, min(3.20, lambda_a)), 2)

            # =================================================================
            # QUALITY GATE 4: Dual Attacking Floor (BTTS Requirement)
            # =================================================================
            # Reject if underdog is expected to be shut out (< 0.85 goals)
            # unless favorite is an absolute juggernaut (lambda >= 2.50)
            if min(lambda_h, lambda_a) < 0.85 and max(lambda_h, lambda_a) < 2.50:
                rejections["underdog_blowout_risk"] += 1
                continue

            # =================================================================
            # BIVARIATE DIXON-COLES PROBABILITIES
            # =================================================================
            dixon_res = DixonColesGoalsModel.calculate_probabilities(lambda_h, lambda_a)
            raw_p_over25 = dixon_res["p_over_25"]
            raw_p_ht05 = dixon_res["p_ht_over05"]

            # =================================================================
            # GROUNDED AI TACTICAL SCOUT
            # =================================================================
            ai_res = self.ai_scout.analyze_fixture_goals(
                home_team=home_name,
                away_team=away_name,
                league_name=league_name,
                lambda_h=lambda_h,
                lambda_a=lambda_a,
                p_over25=raw_p_over25,
                p_btts=dixon_res["p_btts_yes"],
                mii=intent.match_intent_index,
                intent_classification=intent.intent_classification,
                home_over25_rate=int(hp.home_over25_pct * 100),
                away_over25_rate=int(ap.away_over25_pct * 100),
                home_clean_sheet_rate=int(hp.home_clean_sheet_pct * 100),
                away_clean_sheet_rate=int(ap.away_clean_sheet_pct * 100)
            )

            final_p_over25 = round(max(0.10, min(0.95, raw_p_over25 + ai_res["over25_adjustment"])), 4)
            final_p_ht05 = round(max(0.25, min(0.97, raw_p_ht05)), 4)

            # Shared metadata
            base_meta = {
                "home_team": home_name,
                "away_team": away_name,
                "league": league_name,
                "lambda_home": lambda_h,
                "lambda_away": lambda_a,
                "xg_combined": dixon_res["xg_combined"],
                "match_intent_index": intent.match_intent_index,
                "intent_classification": intent.intent_classification,
                "intent_rationale": intent.intent_rationale,
                "tactical_rationale": ai_res["tactical_rationale"],
                "goal_tempo": ai_res["goal_tempo"],
                "ai_confidence": ai_res["ai_confidence"],
                "ai_source": ai_res["source"],
                "home_matches_evaluated": hp.matches_analyzed,
                "away_matches_evaluated": ap.matches_analyzed,
                "home_clean_sheet_pct": round(hp.home_clean_sheet_pct, 2),
                "away_clean_sheet_pct": round(ap.away_clean_sheet_pct, 2),
                "home_over25_pct": round(hp.home_over25_pct, 2),
                "away_over25_pct": round(ap.away_over25_pct, 2),
                "generated_at": now_iso
            }

            # =================================================================
            # QUALITY GATE 5: Over 2.5 Value Threshold (Requires >= 68%)
            # =================================================================
            qualifies_over25 = final_p_over25 >= 0.68 and intent.is_favorable_for_over

            if qualifies_over25:
                if (fid, "over_2.5_goals") not in locked_keys:
                    tier_over25 = (
                        "GOAL_MACHINE" if (final_p_over25 >= 0.80 and dixon_res["xg_combined"] >= 3.20)
                        else ("OVER_25_LOCK" if final_p_over25 >= 0.74 else "LEAN_OVER")
                    )
                    records_to_upsert.append({
                        "fixture_id": fid,
                        "market": "over_2.5_goals",
                        "predicted_outcome": "OVER_2.5",
                        "probability": final_p_over25,
                        "confidence_tier": tier_over25,
                        "xg_combined": dixon_res["xg_combined"],
                        "home_over25_rate": int(hp.home_over25_pct * 100),
                        "away_over25_rate": int(ap.away_over25_pct * 100),
                        "h2h_over25_rate": int(round(h2h_res.h2h_over25_pct * 100)) if h2h_res.has_sufficient_h2h else int(round((hp.home_over25_pct + ap.away_over25_pct) / 2.0 * 100)),
                        "ht_goal_frequency": int(dixon_res["p_ht_over05"] * 100),
                        "avg_first_goal_minute": max(15, min(36, int(35 - (raw_p_ht05 * 18)))),
                        "target_kickoff_at": kickoff_at,
                        "settlement_status": "pending",
                        "metadata": base_meta
                    })
                    over25_published += 1
            else:
                rejections["below_probability_threshold"] += 1

        # Batch upsert into public.goals_predictions
        if records_to_upsert:
            batch_size = 50
            for i in range(0, len(records_to_upsert), batch_size):
                chunk = records_to_upsert[i:i + batch_size]
                self.db.post("goals_predictions", chunk, on_conflict="fixture_id,market")

        print(f"✅ [Over25Engine] Completed run. Published {over25_published} Over 2.5 Goals predictions.")
        print(f"   Rejection Breakdown: {rejections}")

        return {
            "status": "success",
            "evaluated": len(fixtures),
            "published": len(records_to_upsert),
            "over25_published": over25_published,
            "ht05_published": ht05_published,
            "rejections": rejections
        }


if __name__ == "__main__":
    engine = Over25GoalsEngine()
    engine.run()
