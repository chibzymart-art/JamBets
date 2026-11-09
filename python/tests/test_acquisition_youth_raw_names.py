"""Academy/U21 sides must be dropped on the provider's raw names, before fuzzy name resolution.

On 9 Nov 2026 "Nottingham Forest U21" and "Ipswich Town U21" (EFL Trophy) were resolved to the
senior clubs ("nottingham-forest", "ipswich-town"), so the youth filter never saw them and two
academy fixtures were predicted as if the Premier League sides were playing.
"""

import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

from python.src.football.identity import resolve_fuzzy_team_name
from python.src.football.models import RawFixturePayload, FixtureStatus
from python.src.football.pipeline import AcquisitionPipeline


def _raw(home, away, hours_ahead=30):
    now = datetime.now(timezone.utc)
    return RawFixturePayload(
        source_name="ESPN", provider_event_id=f"{home}-{away}", league_code="ENG_EFL_TROPHY", season="2026",
        home_team_raw=home, away_team_raw=away, kickoff_time=now + timedelta(hours=hours_ahead),
        status=FixtureStatus.SCHEDULED, retrieved_at=now,
    )


class YouthRawNameTest(unittest.TestCase):
    def test_fuzzy_resolution_is_the_trap(self):
        # Documents why the raw-name check is needed: these resolve to the senior clubs.
        self.assertEqual(resolve_fuzzy_team_name("Nottingham Forest U21")[0], "nottingham-forest")
        self.assertEqual(resolve_fuzzy_team_name("Ipswich Town U21")[0], "ipswich-town")

    def test_academy_fixtures_are_not_written(self):
        payloads = [
            _raw("Grimsby Town", "Nottingham Forest U21"),
            _raw("Colchester United", "Ipswich Town U21"),
            _raw("Crawley Town", "Brentford Academy"),
            _raw("Bristol Rovers", "Reading"),
        ]
        adapter = MagicMock()
        adapter.slug = "espn"
        adapter.fetch_fixtures.return_value = payloads

        supabase = MagicMock()
        supabase.get.return_value = []
        supabase.upsert_fixture.return_value = {"id": "fx"}

        pipeline = AcquisitionPipeline(supabase=supabase)
        pipeline.registry = MagicMock()
        pipeline.registry.get_all_active_adapters.return_value = [adapter]

        metrics = pipeline.run_acquisition(leagues=["ENG_EFL_TROPHY"])

        written = [c.args[0]["canonical_key"] for c in supabase.upsert_fixture.call_args_list]
        self.assertEqual(len(written), 1, written)
        self.assertIn("bristol-rovers", written[0])
        self.assertFalse(any("nottingham-forest" in k or "ipswich-town" in k for k in written), written)
        self.assertEqual(metrics.get("youth_or_women_rejected"), 3)


if __name__ == "__main__":
    unittest.main()
