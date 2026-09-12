"""
JamBets — Deterministic Football Market Settlement Engine
Evaluates published predictions against verified match states.
Strictly 0 probability calculations, 0 prediction generation.
Supports early mathematical certainty and final Full-Time settlement.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, Any, Optional, Tuple, List
from pydantic import BaseModel, Field
from python.src.football.models import FixtureStatus
from python.src.football.live_monitor import LiveMatchState


class SettlementStatus(str, Enum):
    PENDING = "pending"
    WON = "won"
    LOST = "lost"
    VOID = "void"
    CONFLICT = "conflict"


class SettlementDecision(BaseModel):
    """Immutable result of evaluating a prediction against verified match state."""
    prediction_id: str
    fixture_id: str
    market: str
    prediction: str
    status: SettlementStatus
    settled_at: Optional[datetime] = None
    actual_score: Optional[str] = None
    is_early_settlement: bool = False
    notes: str
    settled_by: str = "settlement_engine_v1"


class SettlementEngine:
    """
    Deterministic rules engine for settling JamBets football predictions.
    Pure rule evaluation: PENDING, WON, LOST, VOID.
    """

    @classmethod
    def evaluate(
        cls,
        prediction: Dict[str, Any],
        match_state: LiveMatchState,
        now_utc: Optional[datetime] = None
    ) -> SettlementDecision:
        """
        Evaluates a single published prediction against the verified match state.
        Enforces:
        - Stale data protection (remains PENDING)
        - Conflict protection (remains PENDING/CONFLICT)
        - Postponed protection (remains PENDING)
        - Early mathematical certainty
        - Final Full-Time deterministic settlement
        """
        pred_id = str(prediction.get("id"))
        fixture_id = str(prediction.get("fixture_id"))
        market = str(prediction.get("market", "")).lower()
        outcome = str(prediction.get("prediction", "")).lower()
        now = now_utc or datetime.now(timezone.utc)

        # 1. Stale Data Protection
        if match_state.is_stale:
            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.PENDING,
                notes="HOLD: Stale match feed. Settle requires fresh verified data."
            )

        # 2. Multi-Source Conflict Protection
        if match_state.has_conflict:
            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.CONFLICT,
                notes=f"HOLD: Unresolved source conflict ({match_state.conflict_reason})"
            )

        # 3. Postponed Match Protection
        # Do NOT automatically settle as LOST or VOID prematurely
        if match_state.status == FixtureStatus.POSTPONED:
            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.PENDING,
                notes="HOLD: Fixture postponed. Awaiting rescheduling or official cancellation."
            )

        # 4. Cancelled / Abandoned Match
        if match_state.status == FixtureStatus.CANCELLED:
            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.VOID,
                settled_at=now,
                notes="VOID: Fixture officially cancelled.",
                actual_score=match_state.score_string
            )

        # 5. Scheduled Match (Kickoff not verified started)
        if match_state.status == FixtureStatus.SCHEDULED:
            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.PENDING,
                notes="PENDING: Match scheduled and not yet in-play."
            )

        # Match is either LIVE or FINISHED with verified data
        h = match_state.home_score if match_state.home_score is not None else 0
        a = match_state.away_score if match_state.away_score is not None else 0
        total_goals = h + a
        score_str = f"{h}-{a}"
        is_finished = (match_state.status == FixtureStatus.FINISHED)

        # =====================================================================
        # MARKET-SPECIFIC DETERMINISTIC SETTLEMENT RULES
        # =====================================================================

        # --- 0. Anti-Loss Pass / Protected Skip (No Safe Edge) ---
        # When volatile/high-risk games are skipped by the model, settle as VOID (Protected Pass) upon Full-Time
        if market in ("no_safe_banker", "skip") or outcome in ("skip", "pass", "no_safe_banker"):
            if not is_finished:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.PENDING,
                    actual_score=score_str,
                    notes="In-play: Anti-Loss Pass (No Safe Edge) awaiting Full-Time"
                )
            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.VOID,
                settled_at=now,
                actual_score=score_str,
                notes=f"SETTLED (PASSED): Anti-Loss Pass (No Safe Edge) - Protected against loss. FT {score_str}"
            )

        # --- 1. Over / Under Goals Markets ---
        if market in ("over_under_0.5", "over_under_1.5", "over_under_2.5", "over_under_3.5", "over_under_4.5"):
            if "0.5" in market:
                threshold = 0.5
            elif "1.5" in market:
                threshold = 1.5
            elif "2.5" in market:
                threshold = 2.5
            elif "3.5" in market:
                threshold = 3.5
            else:
                threshold = 4.5

            if outcome in ("over", "o"):
                # Early mathematical guarantee: minimum possible final total already satisfies threshold
                if total_goals > threshold:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON,
                        settled_at=now,
                        actual_score=score_str,
                        is_early_settlement=not is_finished,
                        notes=f"Over {threshold} satisfied: current score {score_str} ({total_goals} goals)"
                    )
                elif is_finished:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=score_str,
                        notes=f"Over {threshold} failed: final score {score_str} ({total_goals} goals)"
                    )
                else:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.PENDING,
                        actual_score=score_str,
                        notes=f"In-play {score_str}: {total_goals} goals, needs >{threshold}"
                    )

            elif outcome in ("under", "u"):
                # Early mathematical guarantee: current total has already exceeded maximum allowed
                if total_goals > threshold:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=score_str,
                        is_early_settlement=not is_finished,
                        notes=f"Under {threshold} exceeded: current score {score_str} ({total_goals} goals)"
                    )
                elif is_finished:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON,
                        settled_at=now,
                        actual_score=score_str,
                        notes=f"Under {threshold} satisfied: final score {score_str} ({total_goals} goals)"
                    )
                else:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.PENDING,
                        actual_score=score_str,
                        notes=f"In-play {score_str}: {total_goals} goals, max allowed <{threshold}"
                    )

        # --- 1B. Team-Specific Goals Markets (Home / Away Over/Under 0.5 / 1.5) ---
        elif "home_goals" in market or "away_goals" in market:
            is_home_target = "home_goals" in market
            team_goals = h if is_home_target else a
            team_label = "Home" if is_home_target else "Away"
            threshold = 1.5 if "1.5" in market else 0.5

            if outcome in ("over", "o"):
                if team_goals > threshold:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON,
                        settled_at=now,
                        actual_score=score_str,
                        is_early_settlement=not is_finished,
                        notes=f"{team_label} Over {threshold} satisfied: {team_label} scored {team_goals} (score {score_str})"
                    )
                elif is_finished:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=score_str,
                        notes=f"{team_label} Over {threshold} failed: {team_label} scored {team_goals} (final {score_str})"
                    )
                else:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.PENDING,
                        actual_score=score_str,
                        notes=f"In-play {score_str}: {team_label} goals {team_goals}, needs >{threshold}"
                    )

            elif outcome in ("under", "u"):
                if team_goals > threshold:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=score_str,
                        is_early_settlement=not is_finished,
                        notes=f"{team_label} Under {threshold} exceeded: {team_label} scored {team_goals} (score {score_str})"
                    )
                elif is_finished:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON,
                        settled_at=now,
                        actual_score=score_str,
                        notes=f"{team_label} Under {threshold} satisfied: {team_label} scored {team_goals} (final {score_str})"
                    )
                else:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.PENDING,
                        actual_score=score_str,
                        notes=f"In-play {score_str}: {team_label} goals {team_goals}, max allowed <{threshold}"
                    )

        # --- 2. Both Teams To Score (BTTS / GG) ---
        elif market == "btts":
            both_scored = (h >= 1 and a >= 1)

            if outcome in ("yes", "btts_yes", "gg"):
                # Early mathematical guarantee: once both score, it can never un-happen
                if both_scored:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON,
                        settled_at=now,
                        actual_score=score_str,
                        is_early_settlement=not is_finished,
                        notes=f"BTTS Yes satisfied: both teams have scored ({score_str})"
                    )
                elif is_finished:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=score_str,
                        notes=f"BTTS Yes failed: final score {score_str}"
                    )
                else:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.PENDING,
                        actual_score=score_str,
                        notes=f"In-play {score_str}: awaiting both teams to score"
                    )

            elif outcome in ("no", "btts_no", "ng"):
                # Early mathematical guarantee: if both teams have scored, Under/No is impossible
                if both_scored:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=score_str,
                        is_early_settlement=not is_finished,
                        notes=f"BTTS No failed: both teams have scored ({score_str})"
                    )
                elif is_finished:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON,
                        settled_at=now,
                        actual_score=score_str,
                        notes=f"BTTS No satisfied: final score {score_str}"
                    )
                else:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.PENDING,
                        actual_score=score_str,
                        notes=f"In-play {score_str}: clean sheet intact"
                    )

        # --- 3. Match Result (1X2) ---
        elif market in ("1x2", "match_result"):
            # Non-negotiable: Never settle 1X2 in-play merely because one side leads
            if not is_finished:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.PENDING,
                    actual_score=score_str,
                    notes=f"In-play {score_str}: 1X2 settles only at verified Full-Time"
                )

            # Full-Time Settlement
            actual_res = "home" if h > a else ("draw" if h == a else "away")
            win = (outcome == actual_res) or (outcome == "1" and actual_res == "home") or (outcome == "x" and actual_res == "draw") or (outcome == "2" and actual_res == "away")

            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.WON if win else SettlementStatus.LOST,
                settled_at=now,
                actual_score=score_str,
                notes=f"1X2 Final: {score_str} -> {actual_res.upper()} (Predicted: {outcome.upper()})"
            )

        # --- 4. Double Chance ---
        elif market == "double_chance":
            if not is_finished:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.PENDING,
                    actual_score=score_str,
                    notes=f"In-play {score_str}: Double Chance settles only at verified Full-Time"
                )

            # Full-Time Settlement
            win = False
            if outcome in ("1x", "home_draw"):
                win = (h >= a)
            elif outcome in ("x2", "draw_away"):
                win = (a >= h)
            elif outcome in ("12", "home_away"):
                win = (h != a)

            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.WON if win else SettlementStatus.LOST,
                settled_at=now,
                actual_score=score_str,
                notes=f"Double Chance Final: {score_str} (Predicted: {outcome.upper()})"
            )

        # --- 5. Half-Time Markets ---
        elif market in ("ht_result", "ht_goals_0.5", "ht_goals_1.5"):
            ht_confirmed = (
                match_state.period in ("HT", "2H", "FT")
                or is_finished
                or (match_state.half_time_home_score is not None and match_state.half_time_away_score is not None)
            )

            # Check early Over in 1H if goals reached
            ht_h = match_state.half_time_home_score if match_state.half_time_home_score is not None else h
            ht_a = match_state.half_time_away_score if match_state.half_time_away_score is not None else a
            ht_goals = ht_h + ht_a
            ht_score_str = f"{ht_h}-{ht_a}"

            if market in ("ht_goals_0.5", "ht_goals_1.5") or "goals" in outcome:
                ht_thresh = 0.5 if "0.5" in market or "0.5" in outcome else 1.5
                is_over = "over" in outcome

                if is_over and ht_goals > ht_thresh:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON,
                        settled_at=now,
                        actual_score=ht_score_str,
                        is_early_settlement=not ht_confirmed,
                        notes=f"HT Over {ht_thresh} satisfied: HT score {ht_score_str}"
                    )
                elif not is_over and ht_goals > ht_thresh:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=ht_score_str,
                        is_early_settlement=not ht_confirmed,
                        notes=f"HT Under {ht_thresh} exceeded: HT score {ht_score_str}"
                    )
                elif ht_confirmed:
                    won = (ht_goals > ht_thresh) if is_over else (ht_goals < ht_thresh)
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.WON if won else SettlementStatus.LOST,
                        settled_at=now,
                        actual_score=ht_score_str,
                        notes=f"HT {'Over' if is_over else 'Under'} {ht_thresh} at Half-Time ({ht_score_str})"
                    )
                else:
                    return SettlementDecision(
                        prediction_id=pred_id,
                        fixture_id=fixture_id,
                        market=market,
                        prediction=outcome,
                        status=SettlementStatus.PENDING,
                        actual_score=score_str,
                        notes=f"In 1H {score_str}: awaiting verified Half-Time"
                    )

            # HT 1X2 result
            elif ht_confirmed:
                actual_ht_res = "home" if ht_h > ht_a else ("draw" if ht_h == ht_a else "away")
                win = (outcome == actual_ht_res) or (outcome == "1" and actual_ht_res == "home") or (outcome == "x" and actual_ht_res == "draw") or (outcome == "2" and actual_ht_res == "away")
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.WON if win else SettlementStatus.LOST,
                    settled_at=now,
                    actual_score=ht_score_str,
                    notes=f"HT Result confirmed: {ht_score_str} -> {actual_ht_res.upper()}"
                )
            else:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.PENDING,
                    notes="Awaiting verified Half-Time state"
                )

        # --- 6. Second-Half Markets ---
        elif market in ("2h_goals_0.5", "2h_goals_1.5"):
            # Settle strictly on 2H goals = FT - HT
            if not is_finished:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.PENDING,
                    actual_score=score_str,
                    notes="Second-half goals settle upon verified Full-Time"
                )

            ht_h = match_state.half_time_home_score if match_state.half_time_home_score is not None else 0
            ht_a = match_state.half_time_away_score if match_state.half_time_away_score is not None else 0
            h_2h = max(0, h - ht_h)
            a_2h = max(0, a - ht_a)
            goals_2h = h_2h + a_2h
            thresh_2h = 0.5 if "0.5" in market else 1.5

            is_over = (outcome in ("over", "o"))
            won = (goals_2h > thresh_2h) if is_over else (goals_2h < thresh_2h)

            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.WON if won else SettlementStatus.LOST,
                settled_at=now,
                actual_score=f"2H:{goals_2h} (FT {score_str}, HT {ht_h}-{ht_a})",
                notes=f"2H {'Over' if is_over else 'Under'} {thresh_2h}: {goals_2h} goals in 2nd half"
            )

        # --- 7. Corner Markets ---
        elif "corner" in market:
            corners_total = match_state.total_corners
            if corners_total is None:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.PENDING,
                    notes="Corners data unprovided by verified feed. Zero synthetic data permitted."
                )

            c_thresh = 8.5 if "8.5" in market else (9.5 if "9.5" in market else 10.5)
            is_over = (outcome in ("over", "o"))

            # Early settlement on corners
            if is_over and corners_total > c_thresh:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.WON,
                    settled_at=now,
                    actual_score=f"Corners:{corners_total}",
                    is_early_settlement=not is_finished,
                    notes=f"Corners Over {c_thresh} satisfied: verified {corners_total} corners"
                )
            elif not is_over and corners_total > c_thresh:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.LOST,
                    settled_at=now,
                    actual_score=f"Corners:{corners_total}",
                    is_early_settlement=not is_finished,
                    notes=f"Corners Under {c_thresh} exceeded: verified {corners_total} corners"
                )
            elif is_finished:
                won = (corners_total > c_thresh) if is_over else (corners_total < c_thresh)
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.WON if won else SettlementStatus.LOST,
                    settled_at=now,
                    actual_score=f"Corners:{corners_total}",
                    notes=f"Corners Final: {corners_total} corners (Target {c_thresh})"
                )
            else:
                return SettlementDecision(
                    prediction_id=pred_id,
                    fixture_id=fixture_id,
                    market=market,
                    prediction=outcome,
                    status=SettlementStatus.PENDING,
                    actual_score=f"Corners:{corners_total}",
                    notes=f"In-play corners: {corners_total}, awaiting completion"
                )

        # --- 8. No Safe Banker (Protected Pass / Skip) ---
        elif market.lower() in ("no_safe_banker", "skip"):
            return SettlementDecision(
                prediction_id=pred_id,
                fixture_id=fixture_id,
                market=market,
                prediction=outcome,
                status=SettlementStatus.VOID,
                settled_at=now,
                actual_score=score_str,
                notes="VOID: Fixture marked NO_SAFE_BANKER (Protected Skip) - Zero speculative risk."
            )

        # Fallback default: remain pending
        return SettlementDecision(
            prediction_id=pred_id,
            fixture_id=fixture_id,
            market=market,
            prediction=outcome,
            status=SettlementStatus.PENDING,
            notes=f"Market {market} pending evaluation"
        )
