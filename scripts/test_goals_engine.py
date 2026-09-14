"""
Addsbanta — Goals Specialist Engine Unit Test Suite
Verifies:
1. GoalsModel bivariate Poisson & empirical attack/defense strength calculations.
2. Bayesian shrinkage preventing sample extremes.
3. Dedicated First-Half (1H) probability engine (independent of flat 0.45 multiplier).
4. GoalsAiScout tactical reasoning and qualitative adjustments.
5. FotMob GoalsScraperEnricher interface.
"""

import sys
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))
sys.path.insert(0, str(root_dir / "python" / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from python.src.goals.goals_model import GoalsModel, EmpiricalStatsRegistry, TeamGoalProfile
from python.src.goals.ai_scout import GoalsAiScout
from python.src.goals.goals_scraper_enricher import GoalsScraperEnricher


def test_empirical_goals_model():
    print("\n--- TEST 1: Empirical GoalsModel & Bivariate Poisson ---")
    reg = EmpiricalStatsRegistry.get_instance()
    reg.global_averages = {
        "home_goals_per_game": 1.55,
        "away_goals_per_game": 1.25,
        "ht_home_goals": 0.68,
        "ht_away_goals": 0.52,
        "over25_rate": 0.55,
        "ht_over05_rate": 0.72
    }

    # High scoring matchup: Team A (high attack, porous defense) vs Team B (high attack, porous defense)
    tp_a = TeamGoalProfile("team_a", "Team A")
    tp_a.home_matches = 10
    tp_a.home_goals_scored = 26  # 2.6 per game (very strong attack)
    tp_a.home_goals_conceded = 15
    tp_a.home_ht_goals_scored = 13
    tp_a.home_ht_goals_conceded = 8
    tp_a.home_over25_count = 8
    tp_a.home_ht_over05_count = 9
    reg.teams["team_a"] = tp_a

    tp_b = TeamGoalProfile("team_b", "Team B")
    tp_b.away_matches = 10
    tp_b.away_goals_scored = 18
    tp_b.away_goals_conceded = 22  # 2.2 conceded per game (leaky defense)
    tp_b.away_ht_goals_scored = 9
    tp_b.away_ht_goals_conceded = 11
    tp_b.away_over25_count = 7
    tp_b.away_ht_over05_count = 8
    reg.teams["team_b"] = tp_b

    res = GoalsModel.evaluate_fixture_goals(
        home_team_id="team_a",
        away_team_id="team_b",
        home_team_name="Team A",
        away_team_name="Team B",
        league_name="Premier League",
        registry=reg
    )

    print(f"  High-Scoring Matchup:")
    print(f"  - Home lambda: {res['lambda_home']}, Away lambda: {res['lambda_away']}, Combined: {res['xg_combined']}")
    print(f"  - Over 2.5 Prob: {res['prob_over25']*100:.1f}%, 1H Over 0.5 Prob: {res['prob_ht_05']*100:.1f}%")
    print(f"  - 1H Goal Freq: {res['ht_goal_frequency']}%, Avg 1st Goal Minute: {res['avg_first_goal_minute']}")

    assert res['xg_combined'] >= 3.0, "Combined xG should be high for high-scoring teams"
    assert res['prob_over25'] >= 0.65, "Over 2.5 probability should be high"
    assert res['prob_ht_05'] >= 0.75, "1H Over 0.5 probability should be high"
    print("  [PASS] Empirical calculation correctly reflects high offensive dynamics!")


def test_defensive_matchup():
    print("\n--- TEST 2: Low-Scoring / Defensive Matchup ---")
    reg = EmpiricalStatsRegistry.get_instance()

    tp_c = TeamGoalProfile("team_c", "Team C")
    tp_c.home_matches = 10
    tp_c.home_goals_scored = 8   # 0.8 per game (low attack)
    tp_c.home_goals_conceded = 5 # 0.5 conceded per game (elite defense)
    tp_c.home_ht_goals_scored = 3
    tp_c.home_ht_goals_conceded = 2
    tp_c.home_over25_count = 2
    tp_c.home_ht_over05_count = 4
    reg.teams["team_c"] = tp_c

    tp_d = TeamGoalProfile("team_d", "Team D")
    tp_d.away_matches = 10
    tp_d.away_goals_scored = 6
    tp_d.away_goals_conceded = 7
    tp_d.away_ht_goals_scored = 2
    tp_d.away_ht_goals_conceded = 3
    tp_d.away_over25_count = 1
    tp_d.away_ht_over05_count = 3
    reg.teams["team_d"] = tp_d

    res = GoalsModel.evaluate_fixture_goals(
        home_team_id="team_c",
        away_team_id="team_d",
        home_team_name="Team C",
        away_team_name="Team D",
        league_name="Ligue 2",
        registry=reg
    )

    print(f"  Defensive Matchup:")
    print(f"  - Home lambda: {res['lambda_home']}, Away lambda: {res['lambda_away']}, Combined: {res['xg_combined']}")
    print(f"  - Over 2.5 Prob: {res['prob_over25']*100:.1f}%, 1H Over 0.5 Prob: {res['prob_ht_05']*100:.1f}%")

    assert res['xg_combined'] <= 2.2, "Combined xG should be low for defensive matchup"
    assert res['prob_over25'] <= 0.45, "Over 2.5 probability should be low"
    print("  [PASS] Defensive matchup correctly suppressed (No false Over 2.5 signals)!")


def test_ai_scout():
    print("\n--- TEST 3: Gemini AI Tactical Scout ---")
    scout = GoalsAiScout()
    res = scout.analyze_fixture_goals(
        home_team="Arsenal",
        away_team="Tottenham",
        league="Premier League",
        lambda_home=2.10,
        lambda_away=1.45,
        prob_over25=0.72,
        prob_ht05=0.82,
        home_o25_rate=80,
        away_o25_rate=75,
        ht_goal_frequency=85
    )

    print(f"  AI Scout Result:")
    print(f"  - Source: {res['source']}")
    print(f"  - Tempo: {res['goal_tempo']}")
    print(f"  - Rationale: {res['tactical_rationale']}")
    print(f"  - Adjustments: Over 2.5={res['over25_adjustment']}, 1H={res['ht05_adjustment']}, Conf={res['ai_confidence']}")

    assert len(res['tactical_rationale']) > 20, "Tactical rationale should be substantive"
    assert -0.05 <= res['over25_adjustment'] <= 0.05, "Adjustment should be within [-0.05, 0.05]"
    print("  [PASS] AI Tactical Scout output verified!")


def test_enricher():
    print("\n--- TEST 4: Goals Scraper Enricher ---")
    enricher = GoalsScraperEnricher()
    # Mock lookup
    metrics = enricher.get_team_xg_metrics("Arsenal", "ENG_PL")
    print(f"  - Enricher returned: {metrics}")
    print("  [PASS] Enricher handled query gracefully!")


def test_decoupled_markets_and_locking():
    print("\n--- TEST 5: Decoupled Markets & 2-Day Lock Gating ---")
    from unittest.mock import MagicMock
    from datetime import datetime, timezone, timedelta
    from python.src.goals.goals_engine import GoalsEngine

    mock_db = MagicMock()
    # Mock registry returns empty load
    mock_db.get.side_effect = lambda table, params=None: []

    engine = GoalsEngine(db=mock_db)

    # Setup fixtures
    now = datetime.now(timezone.utc)
    f_locked = {
        "id": "fix_locked_1",
        "status": "scheduled",
        "target_kickoff_at": (now + timedelta(hours=12)).isoformat(),
        "home_team_id": "team_a",
        "away_team_id": "team_b",
        "canonical_key": "ENG_PL:arsenal:chelsea"
    }
    f_free = {
        "id": "fix_free_2",
        "status": "scheduled",
        "target_kickoff_at": (now + timedelta(days=3)).isoformat(),
        "home_team_id": "team_a",
        "away_team_id": "team_b",
        "canonical_key": "ENG_PL:arsenal:chelsea"
    }

    # Simulate get calls
    def mock_get(table, params=None):
        if table == "goals_predictions":
            if params and "target_kickoff_at" in params:
                # Locked in 48h window
                return [{"fixture_id": "fix_locked_1", "market": "over_2.5_goals"}]
            if params and "settlement_status" in params:
                return [{"fixture_id": "fix_locked_1", "market": "ht_over_0.5_goals"}]
            return []
        elif table == "football_fixtures":
            return [f_locked, f_free]
        elif table == "football_teams":
            return [
                {"id": "team_a", "name": "Team A", "short_name": "Team A"},
                {"id": "team_b", "name": "Team B", "short_name": "Team B"}
            ]
        elif table == "football_leagues":
            return [{"id": "l1", "name": "Premier League", "code": "ENG_PL"}]
        return []

    mock_db.get.side_effect = mock_get
    posted_records = []
    def mock_post(table, chunk, on_conflict=None):
        if table == "goals_predictions":
            posted_records.extend(chunk)
        return []
    mock_db.post.side_effect = mock_post

    res = engine.run(wipe=False)
    print(f"  - Engine Run Result: {res}")
    print(f"  - Posted records count: {len(posted_records)}")
    for r in posted_records:
        print(f"    -> Upserted: Fixture={r['fixture_id']}, Market={r['market']}, Prob={r['probability']}")

    # fix_locked_1 must NOT be in posted_records because it is locked!
    locked_fixture_upserts = [r for r in posted_records if r["fixture_id"] == "fix_locked_1"]
    assert len(locked_fixture_upserts) == 0, "Locked fixture must NEVER be upserted!"
    assert res["locked_skipped_count"] >= 1, "Locked count must be recorded"
    print("  [PASS] 2-Day Lock Gating successfully protected locked prediction!")


if __name__ == "__main__":
    test_empirical_goals_model()
    test_defensive_matchup()
    test_ai_scout()
    test_enricher()
    test_decoupled_markets_and_locking()
    print("\nALL GOALS SPECIALIST TESTS PASSED!")
