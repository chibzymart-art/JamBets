"""
Oddsbanta — Isolated Home Win Dominance Engine
Mathematical Model: Multivariate Logistic Home Venue Dominance Index (HVDI).
Strictly decoupled: Writes exclusively to public.home_win_predictions.
Zero cross-talk with Away Win, Draw, Corners, or Goals engines.
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


class HomeWinModel:
    """
    Mathematical model evaluating Home Venue Dominance Index (HVDI).
    Uses empirical home win frequency, venue goal differentials,
    and defensive clean-sheet resilience.
    """

    @staticmethod
    def calculate_hvdi(
        home_ppg_at_home: float,
        away_ppg_on_road: float,
        home_win_rate_home: float,
        away_loss_rate_road: float,
        home_gd_per_game: float,
        home_clean_sheet_rate: float
    ) -> float:
        """
        Multivariate logistic latent score:
        HVDI = beta0 + beta1*(PPG_diff) + beta2*(WinRate_diff) + beta3*(GD) + beta4*(CleanSheet)
        """
        beta0 = -0.15  # baseline adjustment
        beta1 = 0.65   # points per game advantage
        beta2 = 0.85   # win rate vs road loss rate
        beta3 = 0.40   # goal differential per game
        beta4 = 0.50   # clean sheet stability

        ppg_diff = home_ppg_at_home - away_ppg_on_road
        win_rate_diff = home_win_rate_home - (1.0 - away_loss_rate_road)

        hvdi = beta0 + (beta1 * ppg_diff) + (beta2 * win_rate_diff) + (beta3 * home_gd_per_game) + (beta4 * home_clean_sheet_rate)
        return hvdi

    @staticmethod
    def hvdi_to_probability(hvdi: float) -> float:
        """Sigmoid function converting HVDI into calibrated probability [0.15, 0.95]."""
        p = 1.0 / (1.0 + math.exp(-hvdi))
        return round(max(0.15, min(0.95, p)), 4)

    @classmethod
    def evaluate_fixture(cls, home_stats: Dict[str, Any], away_stats: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates home dominance metrics for a single upcoming fixture.
        """
        home_matches = home_stats.get("home_matches") or home_stats.get("matches") or home_stats.get("away_matches", 0)
        away_matches = away_stats.get("away_matches") or away_stats.get("matches") or away_stats.get("home_matches", 0)

        # Robust Bayesian priors if team matches are low
        home_wins = home_stats.get("home_wins") or home_stats.get("wins") or home_stats.get("away_wins", 0)
        home_draws = home_stats.get("home_draws") or home_stats.get("draws") or home_stats.get("away_draws", 0)
        home_goals_for = home_stats.get("home_goals_for") or home_stats.get("goals_for") or home_stats.get("away_goals_for", 0)
        home_goals_against = home_stats.get("home_goals_against") or home_stats.get("goals_against") or home_stats.get("away_goals_against", 0)
        home_clean_sheets = home_stats.get("home_clean_sheets") or home_stats.get("clean_sheets") or home_stats.get("away_clean_sheets", 0)

        away_losses = away_stats.get("away_losses") or away_stats.get("losses", 0)
        if away_losses == 0 and away_matches > 0:
            away_losses = away_matches - (away_stats.get("away_wins") or away_stats.get("home_wins", 0)) - (away_stats.get("away_draws") or away_stats.get("home_draws", 0))
        away_goals_for = away_stats.get("away_goals_for") or away_stats.get("goals_for") or away_stats.get("home_goals_for", 0)
        away_goals_against = away_stats.get("away_goals_against") or away_stats.get("goals_against") or away_stats.get("home_goals_against", 0)

        # Prior: Home team ~1.65 PPG, Away ~1.15 PPG
        if home_matches < 3:
            home_ppg = 1.65
            home_win_rate = 0.48
            home_gd = 0.35
            clean_sheet_rate = 0.30
        else:
            points = (home_wins * 3) + home_draws
            home_ppg = points / home_matches
            home_win_rate = home_wins / home_matches
            home_gd = (home_goals_for - home_goals_against) / home_matches
            clean_sheet_rate = home_clean_sheets / home_matches


        if away_matches < 3:
            away_ppg = 1.15
            away_loss_rate = 0.46
        else:
            away_points = (away_stats.get("away_wins", 0) * 3) + away_stats.get("away_draws", 0)
            away_ppg = away_points / away_matches
            away_loss_rate = away_losses / away_matches

        hvdi = cls.calculate_hvdi(
            home_ppg_at_home=home_ppg,
            away_ppg_on_road=away_ppg,
            home_win_rate_home=home_win_rate,
            away_loss_rate_road=away_loss_rate,
            home_gd_per_game=home_gd,
            home_clean_sheet_rate=clean_sheet_rate
        )

        prob = cls.hvdi_to_probability(hvdi)

        # Determine Dominance Tier & Confidence Category
        if prob >= 0.75:
            dominance_tier = "FORTRESS_LOCK"
            confidence_category = "BANGER"
        elif prob >= 0.65:
            dominance_tier = "HIGH_DOMINANCE"
            confidence_category = "TOP PICK"
        elif prob >= 0.55:
            dominance_tier = "VALUE_EDGE"
            confidence_category = "MID_CONFIDENCE"
        else:
            dominance_tier = "SLIGHT_EDGE"
            confidence_category = "SKIP"

        home_venue_advantage = round(max(0.0, min(1.0, 0.45 + (home_gd * 0.15))), 4)
        clean_sheet_prob = round(max(0.05, min(0.85, clean_sheet_rate * 0.8 + 0.1)), 4)
        xg_home = round(max(0.5, (home_goals_for / max(1, home_matches)) if home_matches else 1.6), 2)
        xg_away = round(max(0.3, (away_goals_for / max(1, away_matches)) if away_matches else 1.1), 2)

        return {
            "probability": prob,
            "confidence_category": confidence_category,
            "dominance_tier": dominance_tier,
            "home_venue_advantage": home_venue_advantage,
            "home_clean_sheet_prob": clean_sheet_prob,
            "xg_home": xg_home,
            "xg_away": xg_away,
            "hvdi": round(hvdi, 4)
        }


class HomeWinEngine:
    """
    Autonomous worker engine for Home Win predictions.
    Reads active fixtures, performs statistical calibration, and saves to home_win_predictions.
    """

    def __init__(self, db: CloudSupabaseClient = None):
        self.db = db or CloudSupabaseClient()

    def run(self, max_fixtures: int = 500) -> Dict[str, Any]:
        print("🏟️ [HomeWinEngine] Launching Home Win Dominance Engine...")
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

        print(f"📊 [HomeWinEngine] Compiled empirical profiles for {len(team_stats)} clubs.")

        # 2. Check locked predictions within 48h to preserve immutability
        existing = self.db.get("home_win_predictions", {
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

            eval_res = HomeWinModel.evaluate_fixture(h_profile, a_profile)

            # Only publish fixtures that meet the minimum actionable threshold (>= 52%)
            if eval_res["probability"] >= 0.52:
                payload = {
                    "fixture_id": fid,
                    "prediction": "Home Win",
                    "market": "home_win",
                    "probability": eval_res["probability"],
                    "confidence_category": eval_res["confidence_category"],
                    "dominance_tier": eval_res["dominance_tier"],
                    "home_venue_advantage": eval_res["home_venue_advantage"],
                    "home_clean_sheet_prob": eval_res["home_clean_sheet_prob"],
                    "xg_home": eval_res["xg_home"],
                    "xg_away": eval_res["xg_away"],
                    "target_kickoff_at": f["target_kickoff_at"],
                    "settlement_status": "pending",
                    "publication_status": "published"
                }

                if fid in existing_map:
                    pred_id = existing_map[fid]
                    self.db.patch("home_win_predictions", payload, {"id": f"eq.{pred_id}"})
                    updated_count += 1
                else:
                    to_insert.append(payload)

        # 4. Batch insert new predictions
        inserted_count = 0
        for i in range(0, len(to_insert), 50):
            batch = to_insert[i:i+50]
            res = self.db.post("home_win_predictions", batch)
            inserted_count += len(res) if res else len(batch)

        total_published = inserted_count + updated_count
        print(f"✅ [HomeWinEngine] Completed: {total_published} Home Win predictions published ({inserted_count} new, {updated_count} updated, {skipped_count} locked).")
        return {
            "engine": "home_win_engine",
            "published": total_published,
            "inserted": inserted_count,
            "updated": updated_count,
            "locked_skipped": skipped_count,
            "total_evaluated": len(fixtures)
        }



if __name__ == "__main__":
    engine = HomeWinEngine()
    summary = engine.run()
    print("Summary:", summary)
