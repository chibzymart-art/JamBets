"""
Oddsbanta — Phase 2 Basketball Data Acquisition Verification Suite
Tests:
1. Configuration & League Registry completeness
2. Team identity normalization & canonical key resolution
3. Live ESPN scraper endpoint parsing (WNBA & NBA)
4. Live LiveScore scraper endpoint parsing (European/International)
5. Schedule fatigue & Back-to-Back (B2B) calculation logic
6. Zero regression on web TypeScript build
"""

import sys
import os
import subprocess
from datetime import datetime, timezone, timedelta

# Ensure root is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python.src.basketball.config import LEAGUE_REGISTRY, ALTITUDE_VENUES, FATIGUE_MODIFIERS
from python.src.basketball.identity import normalize_team_name, get_team_slug, generate_canonical_key
from python.src.basketball.scrapers.espn_scraper import EspnBasketballScraper
from python.src.basketball.scrapers.livescore_scraper import LivescoreBasketballScraper
from python.src.basketball.pipeline import BasketballIngestionPipeline

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
print(" Oddsbanta: Phase 2 Autonomous Basketball Scrapers Verification")
print("=================================================================\n")

# 1. Config & Registry
print("--- 1. League Registry & Configuration ---")
assert_test("Registry contains NBA", "NBA" in LEAGUE_REGISTRY)
assert_test("Registry contains EUROLEAGUE", "EUROLEAGUE" in LEAGUE_REGISTRY)
assert_test("Registry contains NCAA_M", "NCAA_M" in LEAGUE_REGISTRY)
assert_test("Registry contains WNBA", "WNBA" in LEAGUE_REGISTRY)
assert_test("NBA configuration has 4 periods and 12 minutes", LEAGUE_REGISTRY["NBA"].periods_count == 4 and LEAGUE_REGISTRY["NBA"].quarter_minutes == 12)
assert_test("NCAA_M configuration has 2 periods and 20 minutes", LEAGUE_REGISTRY["NCAA_M"].periods_count == 2 and LEAGUE_REGISTRY["NCAA_M"].quarter_minutes == 20)
assert_test("Denver altitude bonus recognized", ALTITUDE_VENUES.get("denver nuggets", 0.0) >= 4.0)

# 2. Team Normalization & Canonical Identity
print("\n--- 2. Team Identity & Canonical Key Generation ---")
assert_test("Normalizes 'celtics'", normalize_team_name("celtics") == "Boston Celtics")
assert_test("Normalizes 'la lakers'", normalize_team_name("la lakers") == "Los Angeles Lakers")
assert_test("Normalizes 'sixers'", normalize_team_name("sixers") == "Philadelphia 76ers")
assert_test("Normalizes 'real madrid'", normalize_team_name("real madrid") == "Real Madrid Baloncesto")
assert_test("Normalizes 'seattle storm'", normalize_team_name("seattle storm") == "Seattle Storm")
assert_test("Team slug for Boston Celtics", get_team_slug("Boston Celtics") == "BOS")
assert_test("Team slug for New York Knicks", get_team_slug("New York Knicks") == "NYK")

dt = datetime(2026, 10, 22, 19, 30, tzinfo=timezone.utc)
key = generate_canonical_key("NBA", "celtics", "knicks", dt)
assert_test("Canonical key generation", key == "NBA:BOS-NYK:20261022", f"Got {key}")

# 3. Live ESPN Scraper
print("\n--- 3. Live ESPN Hidden Public API Scraper ---")
espn = EspnBasketballScraper(timeout=20.0)
try:
    # Test WNBA scoreboard for active events
    wnba_fixtures = espn.fetch_scoreboard("WNBA")
    assert_test("ESPN WNBA scoreboard callable (200 OK response)", isinstance(wnba_fixtures, list))
    if wnba_fixtures:
        first = wnba_fixtures[0]
        assert_test("ESPN fixture has canonical_key", "canonical_key" in first)
        assert_test("ESPN fixture has home_team_name", bool(first.get("home_team_name")))
        assert_test("ESPN fixture has target_kickoff_at", bool(first.get("target_kickoff_at")))
    
    # Test historical scoreboard for NBA
    hist_fixtures = espn.fetch_scoreboard("NBA", "20241022")
    assert_test("ESPN NBA historical scoreboard parsed events", len(hist_fixtures) >= 2)
    assert_test("ESPN historical scores match", hist_fixtures[0]["home_score"] > 0)
except Exception as e:
    assert_test("ESPN Scraper Exception", False, str(e))
finally:
    espn.close()

# 4. Live LiveScore Basketball Scraper
print("\n--- 4. Live LiveScore Public Basketball API Scraper ---")
livescore = LivescoreBasketballScraper(timeout=20.0)
try:
    today_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    ls_fixtures = livescore.fetch_matches_by_date(today_str)
    assert_test("LiveScore basketball feed callable (200 OK response)", isinstance(ls_fixtures, list))
except Exception as e:
    assert_test("LiveScore Scraper Exception", False, str(e))
finally:
    livescore.close()

# 5. Fatigue & Back-to-Back Logic
print("\n--- 5. Fatigue & Back-to-Back Schedule Logic ---")
pipeline = BasketballIngestionPipeline()
t_name = "Boston Celtics"
g1 = datetime(2026, 10, 22, 19, 30, tzinfo=timezone.utc)
g2 = datetime(2026, 10, 23, 20, 0, tzinfo=timezone.utc)  # 24.5 hours later -> B2B
g3 = datetime(2026, 10, 26, 19, 30, tzinfo=timezone.utc)  # 3 days later -> well-rested

pipeline._team_schedule[t_name] = [g1, g2]

rest_g2, b2b_g2 = pipeline.calculate_schedule_fatigue(t_name, g2)
assert_test("Detects B2B game (< 30h delta)", b2b_g2 is True and rest_g2 == 0)

rest_g3, b2b_g3 = pipeline.calculate_schedule_fatigue(t_name, g3)
assert_test("Detects well-rested game (3 days rest)", b2b_g3 is False and rest_g3 >= 2)
pipeline.close()

# 6. Web App TypeScript Build Invariant
print("\n--- 6. Web App Invariant Protection ---")
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
