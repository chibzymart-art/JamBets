"""
Oddsbanta — Isolated Draw Hunter Equilibrium Engine (Phase 5)
Mathematical Model: Zero-Inflated Skellam Distribution & Tactical Parity Model.
Integrated with:
- UniversalDataStore (Multi-season 6,500+ match history)
- Real Head-to-Head (H2H) Historical Analyzer
- Universal Match Motivation & Stakes Matrix (Derbies, 1st-leg cup caution)

Strictly decoupled: Writes exclusively to public.draw_predictions.
Zero cross-talk with Home Win, Away Win, Corners, or Goals engines.
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
from python.src.db.universal_data_store import UniversalDataStore, UnifiedTeamProfile
from python.src.football.h2h_analyzer import H2HAnalyzer
from python.src.football.match_motivation import MatchMotivationEngine
from python.src.football.identity import normalize_team_name
from python.src.football.league_filter import is_fixture_eligible


class DrawModel:
    """
    Mathematical model evaluating Draw probabilities via Zero-Inflated Skellam Distribution.
    A match between Poisson(lambda_H) and Poisson(lambda_A) results in a goal difference
    governed by the Skellam distribution Sk(lambda_H, lambda_A).
    """

    @staticmethod
    def modified_bessel_i0(z: float, terms: int = 15) -> float:
        """
        Computes the modified Bessel function of the first kind of order zero, I_0(z).
        Series representation: sum_{k=0}^inf ( (z^2 / 4)^k / (k!)^2 )
        """
        ans = 1.0
        term = 1.0
        z_half_sq = (z * z) / 4.0
        for k in range(1, terms + 1):
            term *= z_half_sq / (k * k)
            ans += term
            if term < 1e-12:
                break
        return ans

    @classmethod
    def skellam_draw_probability(cls, lambda_h: float, lambda_a: float) -> float:
        """
        Theoretical probability of a draw under independent Poisson processes:
        P(X_H - X_A = 0) = exp(-(lambda_h + lambda_a)) * I_0(2 * sqrt(lambda_h * lambda_a))
        """
        if lambda_h <= 0 or lambda_a <= 0:
            return 0.30
        z = 2.0 * math.sqrt(lambda_h * lambda_a)
        exp_decay = math.exp(-(lambda_h + lambda_a))
        i0 = cls.modified_bessel_i0(z)
        return exp_decay * i0

    @classmethod
    def evaluate_fixture(
        cls,
        home_norm: str,
        away_norm: str,
        league_code: str = "OTHER",
        p_h: Optional[UnifiedTeamProfile] = None,
        p_a: Optional[UnifiedTeamProfile] = None,
        data_store: Optional[UniversalDataStore] = None
    ) -> Dict[str, Any]:
        """
        Evaluates draw probability, tactical equilibrium score (TES), and low-scoring density (LSD)
        using multi-season data, real H2H, and match purpose.
        """
        h_m = p_h.home_matches if p_h else 0
        a_m = p_a.away_matches if p_a else 0

        # Baseline League Parameters
        base_h = 1.45
        base_a = 1.15
        k_shrink = 3.0

        if p_h and h_m > 0:
            raw_h_att = p_h.home_scoring_rate / base_h
            raw_h_def = p_h.home_conceding_rate / base_a
            alpha_h = (h_m * raw_h_att + k_shrink * 1.0) / (h_m + k_shrink)
            beta_h = (h_m * raw_h_def + k_shrink * 1.0) / (h_m + k_shrink)
            home_draw_rate = p_h.home_draws / h_m
        else:
            alpha_h, beta_h = 1.0, 1.0
            home_draw_rate = 0.26

        if p_a and a_m > 0:
            raw_a_att = p_a.away_scoring_rate / base_a
            raw_a_def = p_a.away_conceding_rate / base_h
            alpha_a = (a_m * raw_a_att + k_shrink * 1.0) / (a_m + k_shrink)
            beta_a = (a_m * raw_a_def + k_shrink * 1.0) / (a_m + k_shrink)
            away_draw_rate = p_a.away_draws / a_m
        else:
            alpha_a, beta_a = 1.0, 1.0
            away_draw_rate = 0.25

        lambda_h = alpha_h * beta_a * 1.18 * 1.25
        lambda_a = alpha_a * beta_h * 1.25

        # Tactical Context: Real H2H & Match Motivation
        h2h_res = H2HAnalyzer.analyze(home_norm, away_norm, data_store=data_store)
        motivation_res = MatchMotivationEngine.evaluate(home_norm, away_norm, league_code)

        lambda_h = lambda_h * h2h_res.h2h_lambda_home_mod * motivation_res.lambda_home_mod
        lambda_a = lambda_a * h2h_res.h2h_lambda_away_mod * motivation_res.lambda_away_mod

        lambda_h = round(max(0.40, min(3.50, lambda_h)), 2)
        lambda_a = round(max(0.35, min(3.20, lambda_a)), 2)

        # 1. Base Skellam Draw Probability
        base_skellam = cls.skellam_draw_probability(lambda_h, lambda_a)

        # 2. Tactical Equilibrium Score (TES)
        # Measures symmetry of expected goals: TES -> 1.0 when lambda_h == lambda_a
        goal_sum = lambda_h + lambda_a
        tes = 1.0 - (abs(lambda_h - lambda_a) / max(0.1, goal_sum))

        # 3. Low-Scoring Density (LSD)
        # In low-scoring matches (0-0, 1-1), draw rates skyrocket
        p_00 = math.exp(-goal_sum)
        p_11 = (lambda_h * lambda_a) * math.exp(-goal_sum)
        lsd = p_00 + p_11

        # 4. Zero-Inflated Draw Calibration
        # Draws in high-equilibrium matches have empirical bonus, scaled by derby/motivation
        draw_tendency = (home_draw_rate + away_draw_rate) / 2.0
        if h2h_res.has_sufficient_h2h:
            draw_tendency = 0.65 * draw_tendency + 0.35 * h2h_res.draw_pct

        inflated_prob = base_skellam * (0.85 + (0.35 * tes) + (0.30 * lsd) + (0.25 * draw_tendency)) * motivation_res.draw_mod
        final_prob = round(max(0.18, min(0.48, inflated_prob)), 4)

        # Tiers & Confidence
        # In 3-way markets, standard draw probability is ~26%. Prob >= 32% represents massive +EV edge!
        if final_prob >= 0.35:
            stalemate_tier = "STALEMATE_LOCK"
            confidence_category = "BANGER"
        elif final_prob >= 0.31:
            stalemate_tier = "DEADLOCK_VALUE"
            confidence_category = "TOP PICK"
        elif final_prob >= 0.28:
            stalemate_tier = "MUTUAL_POINT"
            confidence_category = "MID_CONFIDENCE"
        else:
            stalemate_tier = "BALANCED"
            confidence_category = "SKIP"

        h2h_tag = f" [H2H Draws: {h2h_res.draws}/{h2h_res.encounters_count}]" if h2h_res.has_sufficient_h2h else ""
        rationale = f"Tactical equilibrium ({tes:.2f}) and low-scoring density ({lsd:.2f}) indicate high stalemate risk.{h2h_tag} {motivation_res.tactical_rationale}"

        return {
            "probability": final_prob,
            "confidence_category": confidence_category,
            "stalemate_tier": stalemate_tier,
            "tactical_equilibrium_score": round(tes, 4),
            "low_scoring_density": round(lsd, 4),
            "lambda_home": round(lambda_h, 2),
            "lambda_away": round(lambda_a, 2),
            "tactical_rationale": rationale
        }


class DrawEngine:
    """
    Autonomous worker engine for Draw Hunter predictions.
    Reads active fixtures, performs Zero-Inflated Skellam calibration, and saves to draw_predictions.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()
        self.data_store = UniversalDataStore.get_instance(db=self.db)

    def run(self, max_fixtures: int = 500, wipe_pending: bool = False) -> Dict[str, Any]:
        print("⚖️ [DrawEngine] Launching Draw Hunter Equilibrium Engine with Universal Data...")
        now = datetime.now(timezone.utc)
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        lock_window_iso = (now + timedelta(hours=48)).isoformat()

        if wipe_pending:
            print("🧹 [DrawEngine] Archiving existing pending/void predictions...")
            try:
                dr_pending = self.db.get("draw_predictions", {
                    "settlement_status": "in.(pending,void)",
                    "target_kickoff_at": f"gte.{min_kickoff}",
                    "select": "id",
                    "limit": "5000"
                }) or []
                dr_ids = [r["id"] for r in dr_pending]
                for b in range(0, len(dr_ids), 100):
                    chunk = dr_ids[b:b + 100]
                    self.db.patch("draw_predictions", {
                        "publication_status": "archived",
                        "settlement_status": "void",
                        "settlement_notes": "Archived: Wiped for fresh Draw rebuild"
                    }, {"id": f"in.({','.join(chunk)})"})
                print(f"✨ [DrawEngine] Successfully archived {len(dr_ids)} pending predictions.")
            except Exception as e:
                print(f"⚠️ [DrawEngine] Notice during reset: {e}")

        # 1. Warm up universal data store
        self.data_store.warm_up()

        # 2. Check locked predictions within 48h to preserve immutability
        existing = self.db.get("draw_predictions", {
            "select": "id,fixture_id,target_kickoff_at,settlement_status,publication_status",
            "limit": "5000"
        })
        existing_map = {p["fixture_id"]: p["id"] for p in (existing or [])}
        locked_fixture_ids = set()
        for p in (existing or []):
            if p.get("publication_status") == "archived" or p.get("settlement_status") == "void":
                continue
            if p.get("settlement_status") in ("won", "lost"):
                locked_fixture_ids.add(p["fixture_id"])
            elif not wipe_pending and p.get("target_kickoff_at") and p["target_kickoff_at"] <= lock_window_iso:
                locked_fixture_ids.add(p["fixture_id"])

        # 3. Fetch scheduled upcoming fixtures
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "select": "id,home_team_id,away_team_id,target_kickoff_at,league_id,canonical_key",
            "limit": str(max_fixtures)
        })

        team_ids = list(set(
            [f.get("home_team_id") for f in (fixtures or []) if f.get("home_team_id")] +
            [f.get("away_team_id") for f in (fixtures or []) if f.get("away_team_id")]
        ))
        team_name_map = {}
        for i in range(0, len(team_ids), 50):
            chunk = team_ids[i:i + 50]
            id_list = ','.join(chunk)
            for t in self.db.get("football_teams", {"id": f"in.({id_list})", "select": "id,name"}):
                team_name_map[t["id"]] = t.get("name")

        to_insert = []
        updated_count = 0
        skipped_count = 0

        for f in (fixtures or []):
            fid = f["id"]
            if fid in locked_fixture_ids:
                skipped_count += 1
                continue

            hid = f.get("home_team_id")
            aid = f.get("away_team_id")
            ckey = f.get("canonical_key") or ""
            parts = ckey.split(":") if ":" in ckey else []

            h_name = team_name_map.get(hid) or (parts[1] if len(parts) > 1 else str(hid))
            a_name = team_name_map.get(aid) or (parts[2] if len(parts) > 2 else str(aid))
            l_code = parts[0] if parts else "OTHER"

            # Filter out sub-National League, youth, and women's football
            if not is_fixture_eligible(league_code=l_code, home_team=h_name, away_team=a_name):
                skipped_count += 1
                continue

            p_h = self.data_store.get_profile(hid or h_name)
            p_a = self.data_store.get_profile(aid or a_name)

            eval_res = DrawModel.evaluate_fixture(
                home_norm=h_name,
                away_norm=a_name,
                league_code=l_code,
                p_h=p_h,
                p_a=p_a,
                data_store=self.data_store
            )

            # Institutional Quality Gate for Draws:
            # Standard draw probability is ~26%. Any probability >= 31.0% represents elite value!
            if eval_res["probability"] < 0.31:
                continue

            payload = {
                "fixture_id": fid,
                "prediction": "Draw",
                "market": "draw",
                "probability": eval_res["probability"],
                "confidence_category": eval_res["confidence_category"],
                "stalemate_tier": eval_res["stalemate_tier"],
                "tactical_equilibrium_score": eval_res["tactical_equilibrium_score"],
                "low_scoring_density": eval_res["low_scoring_density"],
                "settlement_notes": f"[{eval_res['stalemate_tier']}] {eval_res['tactical_rationale']}",
                "target_kickoff_at": f["target_kickoff_at"],
                "settlement_status": "pending",
                "publication_status": "published"
            }

            if fid in existing_map:
                pred_id = existing_map[fid]
                self.db.patch("draw_predictions", payload, {"id": f"eq.{pred_id}"})
                updated_count += 1
            else:
                to_insert.append(payload)

        # Batch insert
        inserted_count = 0
        for i in range(0, len(to_insert), 50):
            batch = to_insert[i:i + 50]
            res = self.db.post("draw_predictions", batch)
            inserted_count += len(res) if res else len(batch)

        total_published = inserted_count + updated_count
        print(f"✅ [DrawEngine] Published {total_published} Stalemate/Draw picks "
              f"({inserted_count} new, {updated_count} updated, {skipped_count} locked).")

        return {
            "engine": "draw_engine",
            "published": total_published,
            "inserted": inserted_count,
            "updated": updated_count,
            "skipped_locked": skipped_count
        }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Oddsbanta Draw Hunter Engine")
    parser.add_argument("--wipe-pending", action="store_true", help="Wipe pending and void predictions before running")
    args = parser.parse_args()

    engine = DrawEngine()
    summary = engine.run(wipe_pending=args.wipe_pending)
    print("Execution Summary:", summary)
