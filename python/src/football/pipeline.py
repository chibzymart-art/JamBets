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
from python.src.football.identity import build_canonical_fixture, find_matching_canonical_fixture
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
        # Start at 00:00:00 UTC of today to capture all matches scheduled for today
        date_from = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
        # Strict 5-day horizon enforcement: Today (Day 0) + 4 days (Days 1, 2, 3, 4)
        date_to = (now_utc + timedelta(days=MAX_PREDICTION_WINDOW_DAYS)).replace(hour=23, minute=59, second=59)

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

        adapters = [
            a for a in self.registry.get_all_active_adapters()
            if a.slug in ("fotmob", "espn", "livescore")
        ]

        for league in target_leagues:
            print(f"  • Scraping 5-day horizon for {league.name} ({league.code})...", flush=True)
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

                        # 4. Multi-Source Validation & Matching Fixture Lookup
                        matched_key = find_matching_canonical_fixture(canonical_candidate, league_canonical_fixtures)
                        if matched_key:
                            # Merge & cross-validate with existing record
                            existing = league_canonical_fixtures[matched_key]
                            merged = merge_and_validate_fixture(existing, raw)
                            league_canonical_fixtures[matched_key] = merged
                            if merged.has_conflict:
                                metrics["conflicts_detected"] += 1
                            else:
                                metrics["multi_source_verified"] += 1
                        else:
                            league_canonical_fixtures[canonical_candidate.canonical_key] = canonical_candidate

                except Exception as exc:
                    self.registry.record_failure(adapter.slug, str(exc))

            # 5. Persist Validated Data to Cloud Supabase
            league_db_id = self.supabase.get_league_id_by_code(league.code)

            for key, canonical in league_canonical_fixtures.items():
                metrics["canonical_fixtures_created"] += 1

                # Upsert home and away teams
                home_raw = canonical.sources[0].home_team_raw if canonical.sources else None
                away_raw = canonical.sources[0].away_team_raw if canonical.sources else None
                home_team_id = self.supabase.upsert_team(canonical.canonical_home_team, short_name=home_raw)
                away_team_id = self.supabase.upsert_team(canonical.canonical_away_team, short_name=away_raw)

                # Extract real venue from canonical or sources
                venue_str = canonical.venue
                if not venue_str:
                    for s in canonical.sources:
                        if s.venue:
                            venue_str = s.venue
                            break

                # Use FixtureEngine to compute 4-day prediction queue window & lifecycle metadata
                from python.src.football.fixture_engine import FixtureEngine
                engine = FixtureEngine()
                queue_res = engine.compute_queue_window(canonical.kickoff_utc, now_utc)
                in_queue = queue_res.is_eligible and (canonical.status.value == "scheduled")
                queue_day = queue_res.queue_day if in_queue else None

                # Upsert fixture in Cloud Supabase with canonical key, venue, and queue attributes
                fixture_payload = {
                    "league_id": league_db_id,
                    "home_team_id": home_team_id,
                    "away_team_id": away_team_id,
                    "target_kickoff_at": canonical.kickoff_utc.isoformat(),
                    "status": canonical.status.value,
                    "canonical_key": canonical.canonical_key,
                    "venue": venue_str,
                    "in_prediction_queue": in_queue,
                    "queue_day": queue_day,
                    "metadata": {
                        "verified": not canonical.has_conflict,
                        "queue_reason": queue_res.reason,
                        "venue": venue_str,
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
