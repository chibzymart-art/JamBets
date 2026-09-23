"""
Oddsbanta — Phase 4 Basketball Autonomous Settlement & Audit Engine Verification Suite
Tests:
1. Moneyline Evaluation (Home, Away, Overtime Inclusion)
2. Point Spread Evaluation (Covering Favorite, Covering Underdog, Exact Integer Push/Void)
3. Game Total Over / Under Evaluation (Over Hit, Under Hit, Exact Integer Push/Void)
4. 1st Half Points Market Evaluation (Period 1 + Period 2 Scoring)
5. Edge Cases: 48-Hour Rescheduling Window & Abandoned / Postponed Rules
6. Autonomous Settlement Engine Interface & Dry-Run Execution
7. Web App TypeScript Build Invariant Protection
"""

import sys
import os
import subprocess
from datetime import datetime, timezone, timedelta

# Ensure root is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python.src.basketball.settlement import BasketballSettlementEngine
from python.src.basketball.run_settlement import run_settlement_cycle

passed = 0
failed = 0


def assert_test(name: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        print(f" [PASS] {name}")
        passed += 1
    else:
        print(f" [FAIL] {name} {f'-> {detail}' if detail else ''}")
        failed += 1


print("=================================================================")
print(" Oddsbanta: Phase 4 Basketball Settlement & Audit Engine Tests")
print("=================================================================\n")

# Mock fixtures for test cases
mock_home_team = {"canonical_name": "Boston Celtics", "slug": "BOS"}
mock_away_team = {"canonical_name": "New York Knicks", "slug": "NYK"}

reg_fixture = {
    "status": "finished",
    "home_team": mock_home_team,
    "away_team": mock_away_team,
    "home_score": 118,
    "away_score": 108,
    "period_scores": {"home": [30, 28, 32, 28], "away": [25, 27, 26, 30]},
    "current_period": "FT",
    "target_kickoff_at": (datetime.now(timezone.utc) - timedelta(hours=4)).isoformat()
}

ot_fixture = {
    "status": "finished",
    "home_team": mock_home_team,
    "away_team": mock_away_team,
    "home_score": 124,
    "away_score": 121,
    "period_scores": {"home": [27, 29, 28, 26, 14], "away": [28, 28, 27, 27, 11]},
    "current_period": "OT",
    "target_kickoff_at": (datetime.now(timezone.utc) - timedelta(hours=6)).isoformat()
}

# -----------------------------------------------------------------
# 1. Moneyline Evaluation (incl. Overtime)
# -----------------------------------------------------------------
print("--- 1. Moneyline Settlement (Regulation & Overtime) ---")
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="moneyline",
    prediction_text="Boston Celtics to win",
    fixture=reg_fixture
)
assert_test("Regulation Home ML Winner correctly settled as WON", status == "won")
assert_test("Regulation summary contains final scores", "Boston Celtics 118 - 108 New York Knicks" in summary)

status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="moneyline",
    prediction_text="New York Knicks to win",
    fixture=reg_fixture
)
assert_test("Regulation Away ML Loser correctly settled as LOST", status == "lost")

status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="moneyline",
    prediction_text="Boston Celtics to win",
    fixture=ot_fixture
)
assert_test("Overtime Home ML Winner correctly settled as WON", status == "won")
assert_test("Overtime game explicitly flagged with [OT] badge", "[OT]" in summary)

# -----------------------------------------------------------------
# 2. Point Spread Evaluation (Covering, Failing & Push)
# -----------------------------------------------------------------
print("\n--- 2. Point Spread Settlement (Half & Integer Lines) ---")
# Favorite covers: Boston -5.5, won by 10 (118 - 108) -> margin +10 + (-5.5) = +4.5 > 0 -> WON
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="point_spread",
    prediction_text="Boston Celtics -5.5 Points",
    fixture=reg_fixture
)
assert_test("Favorite covers -5.5 line (+10 victory) settled as WON", status == "won" and "covered by" in notes)

# Favorite fails to cover: Boston -12.5, won by 10 -> margin +10 + (-12.5) = -2.5 < 0 -> LOST
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="point_spread",
    prediction_text="Boston Celtics -12.5 Points",
    fixture=reg_fixture
)
assert_test("Favorite misses -12.5 line settled as LOST", status == "lost" and "missed by" in notes)

# Underdog covers: New York +12.5, lost by 10 (effective -10) -> -10 + 12.5 = +2.5 > 0 -> WON
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="point_spread",
    prediction_text="New York Knicks +12.5 Points",
    fixture=reg_fixture
)
assert_test("Underdog covers +12.5 line settled as WON", status == "won")

# Exact Integer Push: Boston -10.0 Points with exactly 10 pt margin -> VOID (Push)
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="point_spread",
    prediction_text="Boston Celtics -10.0 Points",
    fixture=reg_fixture
)
assert_test("Exact integer spread push (-10.0 on 10 pt win) settled as VOID (Push)", status == "void" and "Exact spread push" in notes)

# -----------------------------------------------------------------
# 3. Game Total Over / Under Evaluation
# -----------------------------------------------------------------
print("\n--- 3. Game Total Over / Under Settlement ---")
# Total in reg_fixture: 118 + 108 = 226
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="game_total_over_under",
    prediction_text="Over 224.5 Total Points",
    fixture=reg_fixture
)
assert_test("Over 224.5 hits on 226 total points settled as WON", status == "won")

status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="game_total_over_under",
    prediction_text="Under 224.5 Total Points",
    fixture=reg_fixture
)
assert_test("Under 224.5 misses on 226 total points settled as LOST", status == "lost")

status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="game_total_over_under",
    prediction_text="Under 228.5 Total Points",
    fixture=reg_fixture
)
assert_test("Under 228.5 hits on 226 total points settled as WON", status == "won")

# Exact Integer Push on Totals: 226.0 line with 226 points -> VOID
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="game_total_over_under",
    prediction_text="Over 226.0 Total Points",
    fixture=reg_fixture
)
assert_test("Exact integer total push (226.0 on 226 points) settled as VOID (Push)", status == "void" and "Exact total push" in notes)

# -----------------------------------------------------------------
# 4. First Half Points Market (Q1 + Q2)
# -----------------------------------------------------------------
print("\n--- 4. First Half Points Market Settlement ---")
# First half scores in reg_fixture: Home Q1=30, Q2=28 (58); Away Q1=25, Q2=27 (52). Total 1H = 110.
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="first_half_points",
    prediction_text="Over 108.5 First Half Points",
    fixture=reg_fixture
)
assert_test("1st Half Over 108.5 hits on 110 points settled as WON", status == "won" and "1st half Over hit" in notes)

status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="first_half_points",
    prediction_text="Under 108.5 First Half Points",
    fixture=reg_fixture
)
assert_test("1st Half Under 108.5 misses on 110 points settled as LOST", status == "lost" and "1st half Under missed" in notes)

status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="first_half_points",
    prediction_text="Over 110.0 First Half Points",
    fixture=reg_fixture
)
assert_test("1st Half exact integer push (110.0 line on 110 points) settled as VOID", status == "void" and "1st half exact push" in notes)

# -----------------------------------------------------------------
# 5. 48-Hour Rescheduling Window & Postponements
# -----------------------------------------------------------------
print("\n--- 5. 48-Hour Window & Postponement / Abandonment Rules ---")
recent_postponed = {
    "status": "postponed",
    "home_team": mock_home_team,
    "away_team": mock_away_team,
    "target_kickoff_at": (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
}
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="moneyline",
    prediction_text="Boston Celtics to win",
    fixture=recent_postponed
)
assert_test("Postponed match <48h remains PENDING awaiting rescheduling", status == "pending" and "48h" in notes)

old_postponed = {
    "status": "postponed",
    "home_team": mock_home_team,
    "away_team": mock_away_team,
    "target_kickoff_at": (datetime.now(timezone.utc) - timedelta(hours=50)).isoformat()
}
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="moneyline",
    prediction_text="Boston Celtics to win",
    fixture=old_postponed
)
assert_test("Postponed match >48h voided per sportsbook rules", status == "void" and "exceeded 48h" in notes)

# Unscheduled or In-Play match returns pending
live_fixture = {
    "status": "live",
    "home_team": mock_home_team,
    "away_team": mock_away_team,
    "home_score": 54,
    "away_score": 50,
    "current_period": "Q2"
}
status, notes, summary = BasketballSettlementEngine.evaluate_prediction(
    market="moneyline",
    prediction_text="Boston Celtics to win",
    fixture=live_fixture
)
assert_test("Live in-play match returns PENDING", status == "pending")

# -----------------------------------------------------------------
# 6. Autonomous Settlement Engine Interface & Dry-Run
# -----------------------------------------------------------------
print("\n--- 6. Autonomous Engine & Dry-Run Execution ---")
mock_pending_predictions = [
    {
        "id": "pred-001",
        "fixture_id": "fix-001",
        "market": "moneyline",
        "prediction": "Boston Celtics to win",
        "target_kickoff_at": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat(),
        "fixture": reg_fixture
    },
    {
        "id": "pred-002",
        "fixture_id": "fix-001",
        "market": "point_spread",
        "prediction": "Boston Celtics -12.5 Points",
        "target_kickoff_at": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat(),
        "fixture": reg_fixture
    },
    {
        "id": "pred-003",
        "fixture_id": "fix-001",
        "market": "game_total_over_under",
        "prediction": "Over 226.0 Total Points",
        "target_kickoff_at": (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat(),
        "fixture": reg_fixture
    }
]

try:
    summary = run_settlement_cycle(
        lookback_hours=48,
        dry_run=True,
        refresh_scores=False,
        predictions=mock_pending_predictions
    )
    assert_test("run_settlement_cycle executes cleanly in dry-run mode", summary.get("dry_run") is True)
    assert_test("Evaluated 3 mock pending predictions", summary.get("pending_evaluated") == 3)
    assert_test("Settled 3 predictions in dry-run pass", summary.get("settled") == 3)
    assert_test("Correctly counted: 1 Won, 1 Lost, 1 Void (Push)", summary.get("won") == 1 and summary.get("lost") == 1 and summary.get("void") == 1)
except Exception as e:
    assert_test("run_settlement_cycle executes cleanly in dry-run mode", False, str(e))

# Test default execution without predictions (graceful handling of table availability)
try:
    live_summary = run_settlement_cycle(lookback_hours=48, dry_run=True, refresh_scores=False)
    assert_test("Default query executes without uncaught exceptions", "settled" in live_summary and live_summary.get("dry_run") is True)
except Exception as e:
    assert_test("Default query executes without uncaught exceptions", False, str(e))

# -----------------------------------------------------------------
# 7. Web Application Build Invariant Protection
# -----------------------------------------------------------------
print("\n--- 7. Web Application Build Invariant Protection ---")
build_res = subprocess.run(
    "npm run build",
    shell=True,
    cwd=os.path.join(os.path.dirname(__file__), "..", "web"),
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True
)
assert_test("Vite production build succeeds without regression", build_res.returncode == 0, build_res.stderr[-300:] if build_res.returncode != 0 else "")


print("\n=================================================================")
print(f" Phase 4 Verification Results: {passed} PASSED, {failed} FAILED")
print("=================================================================")

if failed > 0:
    sys.exit(1)
