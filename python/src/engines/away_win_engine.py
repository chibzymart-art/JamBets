"""
Oddsbanta — Isolated Away Win Road Counter Engine
Mathematical Model: Counter-Attacking Road Efficiency (CARE) & Road Inefficiency Index.
Strictly decoupled: Writes exclusively to public.away_win_predictions.
Zero cross-talk with Home Win, Draw, Corners, or Goals engines.
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


class AwayWinModel:
    """
    Mathematical model evaluating Counter-Attacking Road Efficiency (CARE).
    Detects high transition speed, ruthless road conversion,
    and opponents with fragile defensive structures when playing at home.
    """

    @staticmethod
    def calculate_care(
        away_road_ppg: float,
        home_home_ppg: float,
        away_road_win_rate: float,
        home_conceded_per_game: float,
        away_clean_sheet_rate: float
    ) -> float:
        """
        Latent score:
        CARE = alpha0 + alpha1*(AwayRoadPPG - HomeHomePPG) + alpha2*(AwayWinRate) + alpha3*(HomeConceded) + alpha4*(AwayCleanSheet)
        """
        alpha0 = -0.55  # naturally lower baseline for away wins in football
        alpha1 = 0.70   # road points differential
        alpha2 = 0.90   # proven road winning capability
        alpha3 = 0.45   # home defensive vulnerability to counter-attacks
        alpha4 = 0.50   # defensive solidity to hold away leads

        ppg_diff = away_road_ppg - home_home_ppg
        care = alpha0 + (alpha1 * ppg_diff) + (alpha2 * away_road_win_rate) + (alpha3 * home_conceded_per_game) + (alpha4 * away_clean_sheet_rate)
        return care

    @staticmethod
    def care_to_probability(care: float) -> float:
        """Sigmoid function converting CARE into calibrated probability [0.10, 0.92]."""
        p = 1.0 / (1.0 + math.exp(-care))
        return round(max(0.10, min(0.92, p)), 4)

    @classmethod
    def evaluate_fixture(cls, home_stats: Dict[str, Any], away_stats: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates road counter efficiency metrics for a single upcoming fixture.
        """
        home_matches = home_stats.get("home_matches", 0)
        away_matches = away_stats.get("away_matches", 0)

        # Priors for low sample sizes
        if away_matches < 3:
            away_road_ppg = 1.15
            away_win_rate = 0.28
            away_clean_sheet_rate = 0.22
            away_counter_eff = 0.45
        else:
            wins = away_stats.get("away_wins", 0)
            points = (wins * 3) + away_stats.get("away_draws", 0)
            away_road_ppg = points / away_matches
            away_win_rate = wins / away_matches
            away_clean_sheet_rate = away_stats.get("away_clean_sheets", 0) / away_matches
            away_counter_eff = round(min(1.0, (away_stats.get("away_goals_for", 0) / away_matches) / 2.0), 4)

        if home_matches < 3:
            home_home_ppg = 1.65
            home_conceded = 1.15
        else:
            points = (home_stats.get("home_wins", 0) * 3) + home_stats.get("home_draws", 0)
            home_home_ppg = points / home_matches
            home_conceded = home_stats.get("home_goals_against", 0) / home_matches

        care = cls.calculate_care(
            away_road_ppg=away_road_ppg,
            home_home_ppg=home_home_ppg,
            away_road_win_rate=away_win_rate,
            home_conceded_per_game=home_conceded,
            away_clean_sheet_rate=away_clean_sheet_rate
        )

        prob = cls.care_to_probability(care)

        # Determine Counter Tier & Confidence Category
        if prob >= 0.68:
            counter_tier = "ROAD_RAIDER"
            confidence_category = "BANGER"
        elif prob >= 0.58:
            counter_tier = "COUNTER_LOCK"
            confidence_category = "TOP PICK"
        elif prob >= 0.48:
            counter_tier = "UPSET_ALERT"
            confidence_category = "MID_CONFIDENCE"
        else:
            counter_tier = "VALUE_AWAY"
            confidence_category = "SKIP"

        away_clean_sheet_prob = round(max(0.05, min(0.80, away_clean_sheet_rate * 0.75 + 0.1)), 4)

        return {
            "probability": prob,
            "confidence_category": confidence_category,
            "counter_tier": counter_tier,
            "away_counter_efficiency": away_counter_eff,
            "away_clean_sheet_prob": away_clean_sheet_prob,
            "care": round(care, 4)
        }


class AwayWinEngine:
    """
    Autonomous worker engine for Away Win predictions.
    Reads active fixtures, performs CARE calibration, and saves to away_win_predictions.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()

    def run(self, max_fixtures: int = 500) -> Dict[str, Any]:
        print("🚀 [AwayWinEngine] Launching Away Win Road Counter Engine...")
        now = datetime.now(timezone.utc)
        min_kickoff = (now - timedelta(minutes=5)).isoformat()
        max_kickoff = (now + timedelta(days=4)).isoformat()
        lock_window_iso = (now + timedelta(hours=48)).isoformat()

        # 1. Fetch finished matches to build empirical team performance profiles
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
                        "home_matches": 0, "home_wins": 0, "home_draws": 0, "home_losses": 0, "home_goals_for": 0, "home_goals_against": 0, "home_clean_sheets": 0,
                        "away_matches": 0, "away_wins": 0, "away_draws": 0, "away_losses": 0, "away_goals_for": 0, "away_goals_against": 0, "away_clean_sheets": 0
                    }

            # Home stats
            team_stats[hid]["home_matches"] += 1
            team_stats[hid]["home_goals_for"] += hs
            team_stats[hid]["home_goals_against"] += as_
            if hs > as_:
                team_stats[hid]["home_wins"] += 1
            elif hs == as_:
                team_stats[hid]["home_draws"] += 1
            else:
                team_stats[hid]["home_losses"] += 1
            if as_ == 0:
                team_stats[hid]["home_clean_sheets"] += 1


            # Away stats
            team_stats[aid]["away_matches"] += 1
            team_stats[aid]["away_goals_for"] += as_
            team_stats[aid]["away_goals_against"] += hs
            if as_ > hs:
                team_stats[aid]["away_wins"] += 1
            elif as_ == hs:
                team_stats[aid]["away_draws"] += 1
            else:
                team_stats[aid]["away_losses"] += 1
            if hs == 0:
                team_stats[aid]["away_clean_sheets"] += 1

        print(f"📊 [AwayWinEngine] Compiled empirical profiles for {len(team_stats)} clubs.")

        # 2. Check locked predictions within 48h to preserve immutability
        existing = self.db.get("away_win_predictions", {
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

            eval_res = AwayWinModel.evaluate_fixture(h_profile, a_profile)

            # Minimum actionable threshold for Away Win signals (>= 45%)
            if eval_res["probability"] >= 0.45:
                payload = {
                    "fixture_id": fid,
                    "prediction": "Away Win",
                    "market": "away_win",
                    "probability": eval_res["probability"],
                    "confidence_category": eval_res["confidence_category"],
                    "counter_tier": eval_res["counter_tier"],
                    "away_counter_efficiency": eval_res["away_counter_efficiency"],
                    "away_clean_sheet_prob": eval_res["away_clean_sheet_prob"],
                    "target_kickoff_at": f["target_kickoff_at"],
                    "settlement_status": "pending",
                    "publication_status": "published"
                }

                if fid in existing_map:
                    pred_id = existing_map[fid]
                    self.db.patch("away_win_predictions", payload, {"id": f"eq.{pred_id}"})
                    updated_count += 1
                else:
                    to_insert.append(payload)

        # 4. Batch insert new predictions
        inserted_count = 0
        for i in range(0, len(to_insert), 50):
            batch = to_insert[i:i+50]
            res = self.db.post("away_win_predictions", batch)
            inserted_count += len(res) if res else len(batch)

        total_published = inserted_count + updated_count
        print(f"✅ [AwayWinEngine] Completed: {total_published} Away Win predictions published ({inserted_count} new, {updated_count} updated, {skipped_count} locked).")
        return {
            "engine": "away_win_engine",
            "published": total_published,
            "inserted": inserted_count,
            "updated": updated_count,
            "locked_skipped": skipped_count,
            "total_evaluated": len(fixtures)
        }



if __name__ == "__main__":
    engine = AwayWinEngine()
    summary = engine.run()
    print("Summary:", summary)
