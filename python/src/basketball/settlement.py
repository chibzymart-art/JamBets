"""
Oddsbanta — Autonomous Basketball Settlement & Audit Engine
Phase 4: Autonomous Settlement & Audit Daemon

Evaluates completed and live basketball fixtures against predictions:
1. Markets:
   - Moneyline (Winner including Overtime)
   - Point Spread / Handicap (Margin of victory vs spread, with push/void on integer lines)
   - Game Total Over / Under (Total points vs line, with push/void on integer lines)
   - 1st Half Points / Winners
2. Basketball Edge Cases:
   - Overtime included in all full-game markets
   - Postponed / Abandoned fixtures (>48h window) voided
3. Audit Log:
   - Updates public.basketball_predictions status, notes, and actual_result
   - Generates immutable audit records in public.basketball_settlements

Invariant: Isolated basketball settlement engine. Zero football/tennis cross-talk.
"""

import re
import sys
import logging
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime, timezone, timedelta

from python.src.basketball.db import BasketballDbClient
from python.src.basketball.models import BasketballSettlementStatus
from python.src.basketball.identity import normalize_team_name

logger = logging.getLogger("basketball.settlement")


class BasketballSettlementEngine:
    """
    Dedicated settlement engine for basketball predictions and audit trail generation.
    """

    def __init__(self, db_client: Optional[BasketballDbClient] = None):
        self.db = db_client or BasketballDbClient()

    @classmethod
    def evaluate_prediction(
        cls,
        market: str,
        prediction_text: str,
        fixture: Dict[str, Any]
    ) -> Tuple[str, str, str]:
        """
        Evaluates a prediction against completed fixture outcome.
        Returns: (settlement_status, notes, actual_result_summary)
        """
        status = fixture.get("status", "scheduled")
        home = fixture.get("home_team") or {}
        away = fixture.get("away_team") or {}

        home_name = home.get("canonical_name", "Home Team")
        away_name = away.get("canonical_name", "Away Team")

        home_score = int(fixture.get("home_score") or 0)
        away_score = int(fixture.get("away_score") or 0)
        total_points = home_score + away_score
        score_margin = home_score - away_score  # Home - Away

        period_scores = fixture.get("period_scores") or {"home": [], "away": []}
        was_ot = len(period_scores.get("home", [])) > 4 or fixture.get("current_period") == "OT"

        actual_summary = f"{home_name} {home_score} - {away_score} {away_name} (Total: {total_points})"
        if was_ot:
            actual_summary += " [OT]"

        # Handle Abandoned / Cancelled / Postponed matches
        if status in ("cancelled", "postponed"):
            kickoff_str = fixture.get("target_kickoff_at")
            if kickoff_str:
                kickoff_dt = datetime.fromisoformat(kickoff_str)
                now = datetime.now(timezone.utc)
                if (now - kickoff_dt) > timedelta(hours=48):
                    return "void", f"Match {status} and exceeded 48h rescheduling window.", actual_summary
            return "pending", f"Match {status}. Awaiting official 48h rescheduling window.", actual_summary

        if status != "finished":
            return "pending", "Match not yet completed.", actual_summary

        # -------------------------------------------------------------
        # 1. MONEYLINE (Match Winner incl. OT)
        # -------------------------------------------------------------
        if market == "moneyline":
            if home_score > away_score:
                winner_name = home_name
            elif away_score > home_score:
                winner_name = away_name
            else:
                return "void", "Regular season match ended in unprecedented tie.", actual_summary

            if winner_name.lower() in prediction_text.lower():
                return "won", f"Winner {winner_name} matched prediction '{prediction_text}'.", actual_summary
            else:
                return "lost", f"Winner was {winner_name}; prediction was '{prediction_text}'.", actual_summary

        # -------------------------------------------------------------
        # 2. POINT SPREAD (Handicap)
        # Format: e.g. "Boston Celtics -5.5 Points" or "New York Knicks +6.0 Points"
        # -------------------------------------------------------------
        elif market == "point_spread":
            # Extract spread number
            m = re.search(r"([+-]?\d+(?:\.\d+)?)\s*Points?", prediction_text, re.IGNORECASE)
            if not m:
                return "void", f"Unparseable point spread text '{prediction_text}'.", actual_summary

            spread_val = float(m.group(1))

            # Determine which team the spread was placed on
            is_home_bet = home_name.lower() in prediction_text.lower()
            is_away_bet = away_name.lower() in prediction_text.lower()

            if is_home_bet:
                effective_margin = float(home_score - away_score)
            elif is_away_bet:
                effective_margin = float(away_score - home_score)
            else:
                # Fallback: check normalized match
                norm_pred = normalize_team_name(prediction_text)
                if norm_pred == home_name:
                    effective_margin = float(home_score - away_score)
                else:
                    effective_margin = float(away_score - home_score)

            covered_margin = effective_margin + spread_val

            if covered_margin > 0.0:
                return "won", f"Spread covered by +{covered_margin:.1f} pts ({int(effective_margin):+d} margin with {spread_val:+.1f} line).", actual_summary
            elif covered_margin < 0.0:
                return "lost", f"Spread missed by {covered_margin:.1f} pts ({int(effective_margin):+d} margin with {spread_val:+.1f} line).", actual_summary
            else:
                # Exact Push
                return "void", f"Exact spread push ({int(effective_margin):+d} margin with {spread_val:+.1f} line). Stake refunded.", actual_summary

        # -------------------------------------------------------------
        # 3. GAME TOTAL OVER / UNDER
        # Format: "Over 224.5 Total Points" or "Under 224.5 Total Points"
        # -------------------------------------------------------------
        elif market == "game_total_over_under":
            m = re.search(r"(Over|Under)\s+(\d+(?:\.\d+)?)\s*Total Points?", prediction_text, re.IGNORECASE)
            if not m:
                return "void", f"Unparseable total points text '{prediction_text}'.", actual_summary

            direction = m.group(1).capitalize()
            line_val = float(m.group(2))

            if total_points == line_val:
                return "void", f"Exact total push ({total_points} pts on line {line_val}). Stake refunded.", actual_summary

            if direction == "Over":
                if total_points > line_val:
                    return "won", f"Over hit with {total_points} total points vs line {line_val}.", actual_summary
                else:
                    return "lost", f"Over missed with {total_points} total points vs line {line_val}.", actual_summary
            else:  # Under
                if total_points < line_val:
                    return "won", f"Under hit with {total_points} total points vs line {line_val}.", actual_summary
                else:
                    return "lost", f"Under missed with {total_points} total points vs line {line_val}.", actual_summary

        # -------------------------------------------------------------
        # 4. FIRST HALF POINTS (Q1 + Q2)
        # -------------------------------------------------------------
        elif market == "first_half_points":
            home_quarters = period_scores.get("home", [])
            away_quarters = period_scores.get("away", [])
            if len(home_quarters) >= 2 and len(away_quarters) >= 2:
                fh_points = home_quarters[0] + home_quarters[1] + away_quarters[0] + away_quarters[1]
                m = re.search(r"(Over|Under)\s+(\d+(?:\.\d+)?)", prediction_text, re.IGNORECASE)
                if m:
                    direction = m.group(1).capitalize()
                    line_val = float(m.group(2))
                    if fh_points == line_val:
                        return "void", f"1st half exact push ({fh_points} pts).", actual_summary
                    if (direction == "Over" and fh_points > line_val) or (direction == "Under" and fh_points < line_val):
                        return "won", f"1st half {direction} hit ({fh_points} pts vs {line_val}).", actual_summary
                    else:
                        return "lost", f"1st half {direction} missed ({fh_points} pts vs {line_val}).", actual_summary

            return "void", "Incomplete 1st half quarter scores.", actual_summary

        return "void", f"Unsupported settlement market: {market}", actual_summary

    def settle_pending_predictions(
        self,
        lookback_hours: int = 48,
        dry_run: bool = False,
        predictions: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """
        Scans all pending predictions whose kickoff timestamp is in the past,
        evaluates against completed score, updates prediction, and writes audit record.
        """
        now = datetime.now(timezone.utc)
        start_dt = now - timedelta(hours=lookback_hours)

        if predictions is not None:
            pending_items = predictions
        else:
            # Query pending predictions via DB client
            params = {
                "settlement_status": "eq.pending",
                "target_kickoff_at": f"lte.{now.isoformat()}",
                "select": "id,fixture_id,market,prediction,target_kickoff_at,fixture:basketball_fixtures(*,league:basketball_leagues(*),home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(*),away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(*))",
                "limit": "200"
            }

            try:
                resp = self.db.client.get("/basketball_predictions", params=params)
                resp.raise_for_status()
                pending_items = resp.json()
            except Exception as e:
                logger.error("Failed to query pending basketball predictions: %s", e)
                return {"settled": 0, "errors": 1, "dry_run": dry_run, "error": str(e)}

        settled_count = 0
        won_count = 0
        lost_count = 0
        void_count = 0

        for item in pending_items:
            pred_id = item["id"]
            fix_id = item["fixture_id"]
            fixture = item.get("fixture")
            if not fixture:
                continue

            status, notes, actual_summary = self.evaluate_prediction(
                market=item["market"],
                prediction_text=item["prediction"],
                fixture=fixture
            )

            if status != "pending":
                home_score = int(fixture.get("home_score") or 0)
                away_score = int(fixture.get("away_score") or 0)
                period_scores = fixture.get("period_scores") or {"home": [], "away": []}
                was_ot = len(period_scores.get("home", [])) > 4 or fixture.get("current_period") == "OT"

                if dry_run:
                    settled_count += 1
                    if status == "won":
                        won_count += 1
                    elif status == "lost":
                        lost_count += 1
                    elif status == "void":
                        void_count += 1
                    logger.info(
                        "[DRY-RUN] Would settle Prediction %s -> %s: %s | Result: %s",
                        pred_id, status.upper(), notes, actual_summary
                    )
                    continue

                try:
                    res = self.db.settle_prediction(
                        prediction_id=pred_id,
                        fixture_id=fix_id,
                        status=status,
                        notes=notes,
                        final_home_score=home_score,
                        final_away_score=away_score,
                        was_overtime=was_ot,
                        actual_result=actual_summary
                    )
                    if res:
                        settled_count += 1
                        if status == "won":
                            won_count += 1
                        elif status == "lost":
                            lost_count += 1
                        elif status == "void":
                            void_count += 1
                        logger.info(
                            "Settled Basketball Prediction %s -> %s: %s",
                            pred_id, status.upper(), notes
                        )
                except Exception as e:
                    logger.error("Failed to persist settlement for prediction %s: %s", pred_id, e)

        summary = {
            "pending_evaluated": len(pending_items),
            "settled": settled_count,
            "won": won_count,
            "lost": lost_count,
            "void": void_count,
            "dry_run": dry_run
        }
        logger.info("Basketball Settlement Cycle Complete: %s", summary)
        return summary
