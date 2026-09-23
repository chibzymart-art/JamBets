"""
Oddsbanta — Phase 3 Basketball Quantitative Modeling & Monte Carlo Verification Suite
Tests:
1. Dean Oliver Four Factors & Pace Adjustment Calculations
2. 250,000-Iteration Monte Carlo Simulator Execution & Convergence
3. Probability Distributions, Percentiles & Value Edge (+EV)
4. Prediction Engine Multi-Market Banker & Secondary Leans
5. AI Tactical Analysis & Confidence Tier Classification
6. Web App TypeScript Build Invariant Protection
"""

import sys
import os
import subprocess
from datetime import datetime, timezone

# Ensure root is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python.src.basketball.models import BasketballFourFactors, BasketballMarket, BasketballConfidenceTier
from python.src.basketball.four_factors import FourFactorsModel, MatchupExpectation
from python.src.basketball.monte_carlo import BasketballMonteCarloSimulator, BasketballSimDistribution
from python.src.basketball.prediction_engine import BasketballPredictionEngine

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
print(" Oddsbanta: Phase 3 Basketball Quantitative & Monte Carlo Tests")
print("=================================================================\n")

# 1. Four Factors & Pace Math
print("--- 1. Dean Oliver Four Factors & Pace Calculations ---")
pace = FourFactorsModel.calculate_matchup_pace(102.0, 98.0, 100.0)
assert_test("Matchup pace calculation: (102 * 98) / 100 = 99.96", abs(pace - 99.96) < 0.01)

adj_ortg = FourFactorsModel.calculate_opponent_adjusted_ortg(115.0, 110.0, 112.0)
assert_test("Opponent-adjusted ORtg: (115 * 110) / 112 = 112.95", abs(adj_ortg - 112.95) < 0.05)

home_ff = BasketballFourFactors(efg_pct=0.560, tov_pct=0.115, orb_pct=0.280, ftr=0.240)
away_ff = BasketballFourFactors(efg_pct=0.520, tov_pct=0.135, orb_pct=0.240, ftr=0.200)

ff_net = FourFactorsModel.compute_four_factors_net_advantage(home_ff, away_ff)
assert_test("Four Factors net advantage positive for superior shooting & ball protection", ff_net > 0)

exp = FourFactorsModel.evaluate_matchup(
    league_code="NBA",
    home_team_name="Denver Nuggets",
    away_team_name="New York Knicks",
    home_pace=99.0,
    away_pace=96.0,
    home_ortg=117.0,
    home_drtg=111.0,
    away_ortg=114.0,
    away_drtg=112.0,
    home_ff=home_ff,
    away_ff=away_ff,
    home_rest_days=2,
    away_rest_days=0,
    is_home_b2b=False,
    is_away_b2b=True,
)
assert_test("Denver altitude HCA bonus applied (+4.15 pts)", exp.hca_applied == 4.15)
assert_test("Knicks B2B fatigue applied", exp.fatigue_applied_away < 0)
assert_test("Denver projected higher than Knicks", exp.home_expected_score > exp.away_expected_score)

# 2. 250,000-Iteration Monte Carlo Simulation
print("\n--- 2. 250,000-Iteration Vectorized Monte Carlo Simulator ---")
simulator = BasketballMonteCarloSimulator(default_simulations=250000)

sim_res: BasketballSimDistribution = simulator.simulate(
    home_mean=exp.home_expected_score,
    away_mean=exp.away_expected_score,
    pace=exp.expected_pace,
    market_spread=-6.5,
    market_total=222.5,
    num_simulations=250000
)

assert_test("Executed exact 250,000 simulations", sim_res.simulations_count == 250000)
assert_test("Sub-second simulation runtime (< 500ms)", sim_res.execution_time_ms < 500.0, f"Took {sim_res.execution_time_ms}ms")
assert_test("Home score mean convergence (< 0.25 pt diff)", abs(sim_res.simulated_home_score - exp.home_expected_score) < 0.25)
assert_test("Away score mean convergence (< 0.25 pt diff)", abs(sim_res.simulated_away_score - exp.away_expected_score) < 0.25)
assert_test("Home win probability bounded (0.50 to 0.95)", 0.50 <= sim_res.home_win_prob <= 0.95, f"Got {sim_res.home_win_prob}")

# 3. Percentiles & Spread Curves
print("\n--- 3. Distribution Percentiles & Value Edge ---")
p = sim_res.percentiles
assert_test("Margin percentiles monotonic: p10 < p25 < p50 < p75 < p90", p["margin_p10"] < p["margin_p25"] < p["margin_p50"] < p["margin_p75"] < p["margin_p90"])
assert_test("Total percentiles monotonic: p10 < p25 < p50 < p75 < p90", p["total_p10"] < p["total_p25"] < p["total_p50"] < p["total_p75"] < p["total_p90"])

fair, edge = simulator.calculate_ev_edge(0.68, 1.90)
assert_test("Fair odds calculation: 1 / 0.68 = 1.47", fair == 1.47)
assert_test("Edge calculation: 68% vs 1.90 (52.6% implied) = +15.37%", edge > 15.0)

# 4. Prediction Engine & Confidence Tiers
print("\n--- 4. Prediction Engine & Confidence Tier Classification ---")
engine = BasketballPredictionEngine(simulator=simulator)
pred = engine.generate_prediction(
    fixture_id="00000000-0000-0000-0000-000000000001",
    league_code="NBA",
    home_team_name="Denver Nuggets",
    away_team_name="New York Knicks",
    home_pace=99.0,
    away_pace=96.0,
    home_ortg=117.0,
    home_drtg=111.0,
    away_ortg=114.0,
    away_drtg=112.0,
    home_ff=home_ff,
    away_ff=away_ff,
    home_rest_days=2,
    away_rest_days=0,
    is_home_b2b=False,
    is_away_b2b=True,
    market_spread=-6.5,
    market_total=222.5,
    home_ml_odds=1.45,
    away_ml_odds=2.90,
    num_simulations=250000
)

assert_test("Prediction generated with non-empty primary prediction", bool(pred.prediction))
assert_test("Probability is calibrated (> 0.50)", pred.probability >= 0.50)
assert_test("Confidence tier assigned (BANGER or TOP PICK)", pred.confidence_category in [BasketballConfidenceTier.BANGER, BasketballConfidenceTier.TOP_PICK])
assert_test("Contains secondary predictions", len(pred.secondary_predictions) >= 2)
assert_test("AI Tactical Analysis generated", len(pred.metadata.get("ai_tactical_analysis", "")) > 50)
assert_test("Metadata includes 250k simulation distribution", "distribution_percentiles" in pred.metadata["simulation"])

# 5. Web App TypeScript Build Invariant
print("\n--- 5. Web App Build Invariant Protection ---")
try:
    build_res = subprocess.run(
        ["npm", "run", "build"],
        cwd=os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web")),
        capture_output=True,
        text=True,
        shell=True,
    )
    assert_test("Web app compiles cleanly (0 errors)", build_res.returncode == 0, build_res.stderr[:200])
except Exception as e:
    assert_test("Web app build execution", False, str(e))

print("\n=================================================================")
print(f" Summary: {passed} Passed, {failed} Failed")
print("=================================================================")

if failed > 0:
    sys.exit(1)
sys.exit(0)
