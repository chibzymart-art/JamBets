"""
JamBets — End-to-End Football Data Acquisition Pipeline
Executes acquisition, source validation, canonical identity resolution,
stale data protection, multi-source cross-validation, and Cloud Supabase persistence.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any
from python.src.config import LEAGUE_REGISTRY, MAX_PREDICTION_WINDOW_DAYS, LeagueConfig
from python.src.football.models import (
    CanonicalFixture,
    RawFixturePayload,
    DataFreshnessState,
    FixtureStatus
)
from python.src.football.identity import build_canonical_fixture
from python.src.football.stale_checker import evaluate_freshness
from python.src.football.validator import merge_and_validate_fixture
from python.src.sources.registry import SourceRegistry
from python.src.db.supabase_client import SupabaseClient


class AcquisitionPipeline:
    def __init__(self, supabase: Optional[SupabaseClient] = None):
        self.supabase = supabase or SupabaseClient()
        self.registry = SourceRegistry()

    def sync_leagues_registry(self) -> None:
        """Ensures all 25+ configured leagues exist in Cloud Supabase."""
        existing_leagues = self.supabase.get("football_leagues", {"select": "code"})
        existing_codes = {l["code"] for l in existing_leagues if "code" in l}

        for code, config in LEAGUE_REGISTRY.items():
            if code not in existing_codes:
                self.supabase.post("football_leagues", {
                    "name": config.name,
                    "code": config.code,
                    "country": config.country,
                    "is_active": config.is_active
                })

    def run_acquisition(self, leagues: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Executes data acquisition cycle for the specified leagues (or all configured leagues).
        Enforces four-day window, stale data rejection, and multi-source verification.
        """
        now_utc = datetime.now(timezone.utc)
        date_from = now_utc
        # Strict four-day window enforcement: Today + 4 days
        date_to = now_utc + timedelta(days=MAX_PREDICTION_WINDOW_DAYS)

        target_leagues = (
            [LEAGUE_REGISTRY[code] for code in leagues if code in LEAGUE_REGISTRY]
            if leagues else list(LEAGUE_REGISTRY.values())
        )

        metrics = {
            "leagues_queried": len(target_leagues),
            "raw_payloads_fetched": 0,
            "stale_payloads_rejected": 0,
            "canonical_fixtures_created": 0,
            "multi_source_verified": 0,
            "conflicts_detected": 0,
            "supabase_records_written": 0
        }

        # Ensure leagues are registered in Supabase
        self.sync_leagues_registry()

        adapters = self.registry.get_all_active_adapters()

        for league in target_leagues:
            league_canonical_fixtures: Dict[str, CanonicalFixture] = {}

            # 1. Fetch from all approved adapters
            for adapter in adapters:
                try:
                    payloads = adapter.fetch_fixtures(league, date_from, date_to)
                    metrics["raw_payloads_fetched"] += len(payloads)
                    self.registry.record_success(adapter.slug)

                    for raw in payloads:
                        # 2. Stale Data Protection
                        freshness, reason = evaluate_freshness(raw, now_utc)
                        if freshness == DataFreshnessState.STALE:
                            metrics["stale_payloads_rejected"] += 1
                            continue

                        # 3. Canonical Identity Resolution
                        canonical_candidate = build_canonical_fixture(raw)
                        key = canonical_candidate.canonical_key

                        # 4. Multi-Source Validation
                        if key in league_canonical_fixtures:
                            # Merge & cross-validate with existing record
                            existing = league_canonical_fixtures[key]
                            merged = merge_and_validate_fixture(existing, raw)
                            league_canonical_fixtures[key] = merged
                            if merged.has_conflict:
                                metrics["conflicts_detected"] += 1
                            else:
                                metrics["multi_source_verified"] += 1
                        else:
                            league_canonical_fixtures[key] = canonical_candidate

                except Exception as exc:
                    self.registry.record_failure(adapter.slug, str(exc))

            # 5. Persist Validated Data to Cloud Supabase
            league_db_id = self.supabase.get_league_id_by_code(league.code)

            for key, canonical in league_canonical_fixtures.items():
                metrics["canonical_fixtures_created"] += 1

                # Upsert home and away teams
                home_team_id = self.supabase.upsert_team(canonical.canonical_home_team)
                away_team_id = self.supabase.upsert_team(canonical.canonical_away_team)

                # Use FixtureEngine to compute 4-day prediction queue window & lifecycle metadata
                from python.src.football.fixture_engine import FixtureEngine
                engine = FixtureEngine()
                queue_res = engine.compute_queue_window(canonical.kickoff_utc, now_utc)
                in_queue = queue_res.is_eligible and (canonical.status.value == "scheduled")
                queue_day = queue_res.queue_day if in_queue else None

                # Upsert fixture in Cloud Supabase with canonical key and queue attributes
                fixture_payload = {
                    "league_id": league_db_id,
                    "home_team_id": home_team_id,
                    "away_team_id": away_team_id,
                    "target_kickoff_at": canonical.kickoff_utc.isoformat(),
                    "status": canonical.status.value,
                    "canonical_key": canonical.canonical_key,
                    "in_prediction_queue": in_queue,
                    "queue_day": queue_day,
                    "metadata": {
                        "verified": not canonical.has_conflict,
                        "queue_reason": queue_res.reason,
                    }
                }
                
                try:
                    created_fixture = self.supabase.upsert_fixture(fixture_payload)
                    if created_fixture:
                        fixture_id = created_fixture["id"] if isinstance(created_fixture, dict) else created_fixture[0]["id"]
                        metrics["supabase_records_written"] += 1

                        # Store Provenance for each source contributing to this fixture
                        for source_payload in canonical.sources:
                            source_uuid = self.supabase.get_source_id_by_slug(source_payload.source_name.lower().replace("-", "_").replace(".", "_"))
                            if not source_uuid:
                                source_uuid = self.supabase.get_source_id_by_slug("espn")  # default fallback

                            if source_uuid:
                                self.supabase.record_fixture_source(
                                    fixture_id=fixture_id,
                                    source_id=source_uuid,
                                    provider_event_id=source_payload.provider_event_id,
                                    provider_data={
                                        "source": source_payload.source_name,
                                        "retrieved_at": source_payload.retrieved_at.isoformat(),
                                        "home_team_raw": source_payload.home_team_raw,
                                        "away_team_raw": source_payload.away_team_raw,
                                        "metadata": source_payload.raw_metadata
                                    }
                                )

                        # If multi-source conflict detected, log to football_data_conflicts
                        if canonical.has_conflict and canonical.conflict_details:
                            source_a_id = self.supabase.get_source_id_by_slug("espn")
                            source_b_id = self.supabase.get_source_id_by_slug("livescore")
                            if source_a_id and source_b_id:
                                self.supabase.log_conflict(
                                    fixture_id=fixture_id,
                                    conflict_type=canonical.conflict_details.get("type", "status_conflict"),
                                    source_a_id=source_a_id,
                                    source_b_id=source_b_id,
                                    details_a={"source": canonical.conflict_details.get("existing_source"), "data": canonical.conflict_details},
                                    details_b={"source": canonical.conflict_details.get("incoming_source"), "data": canonical.conflict_details}
                                )
                except Exception as persist_err:
                    pass

        return metrics
