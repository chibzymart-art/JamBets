"""
Oddsbanta — Isolated Draw Hunter Equilibrium Engine
Mathematical Model: Zero-Inflated Skellam Distribution & Tactical Parity Model.
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

from python.src.db.supabase_client import CloudSupabaseClient


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
    def evaluate_fixture(cls, home_stats: Dict[str, Any], away_stats: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates draw probability, tactical equilibrium score (TES), and low-scoring density (LSD).
        """
        home_matches = home_stats.get("home_matches", 0)
        away_matches = away_stats.get("away_matches", 0)

        # Priors
        if home_matches < 3:
            lambda_h = 1.45
            home_draw_rate = 0.26
        else:
            lambda_h = max(0.5, min(3.2, home_stats.get("home_goals_for", 0) / home_matches))
            home_draw_rate = home_stats.get("home_draws", 0) / home_matches

        if away_matches < 3:
            lambda_a = 1.15
            away_draw_rate = 0.25
        else:
            lambda_a = max(0.4, min(3.0, away_stats.get("away_goals_for", 0) / away_matches))
            away_draw_rate = away_stats.get("away_draws", 0) / away_matches

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
        # Draws in high-equilibrium matches have empirical bonus
        draw_tendency = (home_draw_rate + away_draw_rate) / 2.0
        inflated_prob = base_skellam * (0.85 + (0.35 * tes) + (0.30 * lsd) + (0.25 * draw_tendency))
        final_prob = round(max(0.18, min(0.46, inflated_prob)), 4)

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

        return {
            "probability": final_prob,
            "confidence_category": confidence_category,
            "stalemate_tier": stalemate_tier,
            "tactical_equilibrium_score": round(tes, 4),
            "low_scoring_density": round(lsd, 4),
            "lambda_home": round(lambda_h, 2),
            "lambda_away": round(lambda_a, 2)
        }


class DrawEngine:
    """
    Autonomous worker engine for Draw Hunter predictions.
    Reads active fixtures, performs Zero-Inflated Skellam calibration, and saves to draw_predictions.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()

    def run(self, max_fixtures: int = 500) -> Dict[str, Any]:
        print("⚖️ [DrawEngine] Launching Draw Hunter Equilibrium Engine...")
        now = datetime.now(timezone.utc)
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()
        lock_window_iso = (now + timedelta(hours=48)).isoformat()

        # 1. Fetch finished matches to build empirical profiles
        finished = self.db.get("football_fixtures", {
            "status": "in.(finished,ft,settled)",
            "select": "home_team_id,away_team_id,home_score,away_score",
            "limit": "1000"
        })

        team_stats: Dict[str, Dict[str, int]] = {}
        for f in finished:
            hid = f.get("home_team_id")
            aid = f.get("away_team_id")
            hs = f.get("home_score")
            as_ = f.get("away_score")
            if hs is None or as_ is None:
                continue

            for tid in (hid, aid):
                if tid and tid not in team_stats:
                    team_stats[tid] = {
                        "home_matches": 0, "home_draws": 0, "home_goals_for": 0, "home_goals_against": 0,
                        "away_matches": 0, "away_draws": 0, "away_goals_for": 0, "away_goals_against": 0
                    }

            team_stats[hid]["home_matches"] += 1
            team_stats[hid]["home_goals_for"] += hs
            team_stats[hid]["home_goals_against"] += as_
            if hs == as_:
                team_stats[hid]["home_draws"] += 1

            team_stats[aid]["away_matches"] += 1
            team_stats[aid]["away_goals_for"] += as_
            team_stats[aid]["away_goals_against"] += hs
            if as_ == hs:
                team_stats[aid]["away_draws"] += 1


        print(f"📊 [DrawEngine] Compiled empirical profiles for {len(team_stats)} clubs.")

        # 2. Check locked predictions within 48h to preserve immutability
        existing = self.db.get("draw_predictions", {
            "select": "id,fixture_id,target_kickoff_at,settlement_status",
            "limit": "1000"
        })
        existing_map = {p["fixture_id"]: p["id"] for p in existing}
        locked_fixture_ids = set()
        for p in existing:
            if p.get("settlement_status") in ("won", "lost", "void"):
                locked_fixture_ids.add(p["fixture_id"])
            elif p.get("target_kickoff_at") and p["target_kickoff_at"] <= lock_window_iso:
                locked_fixture_ids.add(p["fixture_id"])

        # 3. Fetch scheduled upcoming fixtures
        fixtures = self.db.get("football_fixtures", {
            "status": "in.(scheduled,live,in_progress,halftime)",
            "target_kickoff_at": f"gte.{min_kickoff}",
            "order": "target_kickoff_at.asc",
            "select": "id,home_team_id,away_team_id,target_kickoff_at,league_id",
            "limit": str(max_fixtures)
        })

        to_insert = []
        updated_count = 0
        skipped_count = 0

        for f in fixtures:
            fid = f["id"]
            if fid in locked_fixture_ids:
                skipped_count += 1
                continue

            hid = f.get("home_team_id")
            aid = f.get("away_team_id")
            h_profile = team_stats.get(hid, {})
            a_profile = team_stats.get(aid, {})

            eval_res = DrawModel.evaluate_fixture(h_profile, a_profile)

            # Draw threshold: >= 27.5% qualifies for Draw Hunter pick
            if eval_res["probability"] >= 0.275:
                payload = {
                    "fixture_id": fid,
                    "prediction": "Draw",
                    "market": "draw",
                    "probability": eval_res["probability"],
                    "confidence_category": eval_res["confidence_category"],
                    "stalemate_tier": eval_res["stalemate_tier"],
                    "tactical_equilibrium_score": eval_res["tactical_equilibrium_score"],
                    "low_scoring_density": eval_res["low_scoring_density"],
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

        # 4. Batch insert new predictions
        inserted_count = 0
        for i in range(0, len(to_insert), 50):
            batch = to_insert[i:i+50]
            res = self.db.post("draw_predictions", batch)
            inserted_count += len(res) if res else len(batch)

        total_published = inserted_count + updated_count
        print(f"✅ [DrawEngine] Completed: {total_published} Draw Hunter predictions published ({inserted_count} new, {updated_count} updated, {skipped_count} locked).")
        return {
            "engine": "draw_engine",
            "published": total_published,
            "inserted": inserted_count,
            "updated": updated_count,
            "locked_skipped": skipped_count,
            "total_evaluated": len(fixtures)
        }



if __name__ == "__main__":
    engine = DrawEngine()
    summary = engine.run()
    print("Summary:", summary)
