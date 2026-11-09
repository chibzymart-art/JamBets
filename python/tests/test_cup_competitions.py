"""Added competitions (EFL Trophy, Copa del Rey, Colombian Primera A, Brazil Serie B, J.League Cup,
Liga MX play-offs): registry entries, eligibility filter and LiveScore stage matching."""

import unittest
from datetime import datetime, timezone

from python.src.config import LEAGUE_REGISTRY
from python.src.football.league_filter import get_fixture_eligibility
from python.src.sources.livescore import LiveScoreAdapter


def _stage(country, name, code, home, away, esd="20261110190000"):
    return {"Cnm": country, "Snm": name, "Scd": code,
            "Events": [{"Eid": f"{code}-{home}", "T1": [{"Nm": home}], "T2": [{"Nm": away}], "Esd": esd, "Eps": "NS"}]}


class CupRegistryTest(unittest.TestCase):
    def test_registry_entries(self):
        self.assertEqual(LEAGUE_REGISTRY["ENG_EFL_TROPHY"].espn_slug, "eng.trophy")
        self.assertEqual(LEAGUE_REGISTRY["ESP_CDR"].espn_slug, "esp.copa_del_rey")
        self.assertEqual(LEAGUE_REGISTRY["COL_PA"].espn_slug, "col.1")
        self.assertEqual(LEAGUE_REGISTRY["BRA_SB"].espn_slug, "bra.2")
        self.assertEqual(LEAGUE_REGISTRY["JPN_LC"].espn_slug, "")  # not on ESPN; LiveScore only
        self.assertEqual(LEAGUE_REGISTRY["MEX_LMX"].espn_slug, "mex.1")  # ESPN lists the Liguilla under mex.1


class CupEligibilityTest(unittest.TestCase):
    def test_efl_trophy_senior_clubs_allowed(self):
        ok, reason = get_fixture_eligibility("ENG_EFL_TROPHY", "EFL Trophy", "Bristol Rovers", "Reading")
        self.assertTrue(ok, reason)

    def test_efl_trophy_academy_sides_excluded(self):
        for away in ("Liverpool U21", "Fulham U21", "Brentford Academy"):
            ok, _ = get_fixture_eligibility("ENG_EFL_TROPHY", "EFL Trophy", "Stevenage", away)
            self.assertFalse(ok, away)

    def test_copa_del_rey_allowed(self):
        ok, reason = get_fixture_eligibility("ESP_CDR", "Copa del Rey", "Tavernes de la Valldigna", "Valencia")
        self.assertTrue(ok, reason)

    def test_non_league_still_excluded(self):
        ok, _ = get_fixture_eligibility("ENG_SLP", "Southern League Premier", "Sholing", "Chippenham Town")
        self.assertFalse(ok)


class LiveScoreCupStageTest(unittest.TestCase):
    def _fetch(self, code, stages):
        adapter = LiveScoreAdapter()
        adapter.get_json_with_retry = lambda url: {"Stages": stages}
        day = datetime(2026, 11, 10, tzinfo=timezone.utc)
        return adapter.fetch_fixtures(LEAGUE_REGISTRY[code], day, day)

    def test_efl_trophy_group_stages_match(self):
        stages = [
            _stage("England", "EFL Trophy North: Group B", "efl-trophy-north-group-b", "Crewe Alexandra", "Wigan Athletic"),
            _stage("England", "EFL Trophy South: Group H", "efl-trophy-south-group-h", "Bromley", "MK Dons"),
            _stage("England", "EFL Cup", "efl-cup", "Arsenal", "Chelsea"),
            _stage("England", "Southern League Premier: South", "southern-league-premier-south", "Sholing", "Chippenham Town"),
        ]
        homes = sorted(p.home_team_raw for p in self._fetch("ENG_EFL_TROPHY", stages))
        self.assertEqual(homes, ["Bromley", "Crewe Alexandra"])

    def test_copa_del_rey_round_stage_matches_spain_only(self):
        stages = [
            _stage("Spain", "Copa del Rey: Round 1", "copa-del-rey-round-1-2024-2025", "Tavernes de la Valldigna", "Valencia"),
            _stage("Spain", "LaLiga", "laliga", "Real Madrid", "Barcelona"),
        ]
        homes = [p.home_team_raw for p in self._fetch("ESP_CDR", stages)]
        self.assertEqual(homes, ["Tavernes de la Valldigna"])

    def test_colombia_primera_a_stages_match_not_primera_b(self):
        stages = [
            _stage("Colombia", "Primera A: Clausura", "primera-a-clausura", "Once Caldas", "Atletico Nacional"),
            _stage("Colombia", "Primera B: Clausura: Play-off: Group A", "primera-b-clausura-play-off-group-a", "Cucuta", "Boyaca Chico"),
            _stage("Colombia", "Copa Colombia", "copa-colombia", "Millonarios", "Santa Fe"),
        ]
        self.assertEqual([p.home_team_raw for p in self._fetch("COL_PA", stages)], ["Once Caldas"])

    def test_liga_mx_playoffs_match_but_not_women_or_expansion(self):
        stages = [
            _stage("Mexico", "Liga MX: Apertura: Play-off", "liga-mx-apertura-play-off", "Tigres", "Pumas"),
            _stage("Mexico", "Women's Liga MX: Apertura Play-off", "liga-mx-apertura-play-off-women", "Tigres Femenil", "America Femenil"),
            _stage("Mexico", "Liga de Expansion MX: Apertura: Play-off", "liga-de-expansion-mx-apertura-play-off", "Leones Negros", "Morelia"),
        ]
        self.assertEqual([p.home_team_raw for p in self._fetch("MEX_LMX", stages)], ["Tigres"])

    def test_brazil_serie_b_matches_brazil_only(self):
        stages = [
            _stage("Brazil", "Serie B", "serie-b", "Londrina", "Nautico"),
            _stage("Italy", "Serie B", "serie-b", "Palermo", "Bari"),
        ]
        self.assertEqual([p.home_team_raw for p in self._fetch("BRA_SB", stages)], ["Londrina"])

    def test_j_league_cup_matches_japan_only(self):
        stages = [
            _stage("Japan", "J.League Cup", "league-cup", "Kashima Antlers", "Urawa Reds"),
            _stage("England", "EFL Cup", "league-cup", "Arsenal", "Chelsea"),
        ]
        self.assertEqual([p.home_team_raw for p in self._fetch("JPN_LC", stages)], ["Kashima Antlers"])

    def test_efl_cup_unaffected(self):
        stages = [_stage("England", "EFL Trophy North: Group B", "efl-trophy-north-group-b", "Crewe Alexandra", "Wigan Athletic")]
        self.assertEqual(self._fetch("ENG_EFL_CUP", stages), [])


if __name__ == "__main__":
    unittest.main()
