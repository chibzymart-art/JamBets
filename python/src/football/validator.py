"""
JamBets — Multi-Source Validation & Conflict Detection
Cross-validates fixture representations across multiple independent sources.
Strictly classifies as VERIFIED on agreement, or CONFLICT on discrepancy.
"""

from datetime import datetime, timezone
from typing import List, Dict, Any, Tuple, Optional
from python.src.config import KICKOFF_TOLERANCE_MINUTES
from python.src.football.models import CanonicalFixture, RawFixturePayload, DataFreshnessState, FixtureStatus


def merge_and_validate_fixture(
    canonical: CanonicalFixture,
    incoming: RawFixturePayload
) -> CanonicalFixture:
    """
    Merges an incoming raw payload from another source into an existing canonical fixture.
    Evaluates cross-source agreement or detects conflicts.
    """
    # 1. Compare kickoff time tolerance
    time_delta = abs((canonical.kickoff_utc - incoming.kickoff_time).total_seconds()) / 60.0
    if time_delta > KICKOFF_TOLERANCE_MINUTES:
        canonical.has_conflict = True
        canonical.freshness_state = DataFreshnessState.CONFLICTING
        canonical.conflict_details = {
            "type": "kickoff_time_conflict",
            "existing_source": canonical.sources[0].source_name,
            "existing_kickoff": canonical.kickoff_utc.isoformat(),
            "incoming_source": incoming.source_name,
            "incoming_kickoff": incoming.kickoff_time.isoformat(),
            "difference_minutes": time_delta
        }
        canonical.sources.append(incoming)
        return canonical

    # 2. Compare status
    if canonical.status != incoming.status:
        # Check if one is live and one is finished or scheduled
        canonical.has_conflict = True
        canonical.freshness_state = DataFreshnessState.CONFLICTING
        canonical.conflict_details = {
            "type": "status_conflict",
            "existing_source": canonical.sources[0].source_name,
            "existing_status": canonical.status.value,
            "incoming_source": incoming.source_name,
            "incoming_status": incoming.status.value
        }
        canonical.sources.append(incoming)
        return canonical

    # 3. Compare scores (if status is finished or live)
    if canonical.status in (FixtureStatus.LIVE, FixtureStatus.FINISHED):
        if (incoming.home_score is not None and canonical.home_score is not None and
            (canonical.home_score != incoming.home_score or canonical.away_score != incoming.away_score)):
            canonical.has_conflict = True
            canonical.freshness_state = DataFreshnessState.CONFLICTING
            canonical.conflict_details = {
                "type": "score_mismatch",
                "existing_source": canonical.sources[0].source_name,
                "existing_score": f"{canonical.home_score}-{canonical.away_score}",
                "incoming_source": incoming.source_name,
                "incoming_score": f"{incoming.home_score}-{incoming.away_score}"
            }
            canonical.sources.append(incoming)
            return canonical

    # If all checks pass: sources agree!
    if not canonical.venue and incoming.venue:
        canonical.venue = incoming.venue
    canonical.sources.append(incoming)
    canonical.agreement_count = len(canonical.sources)
    canonical.has_conflict = False
    canonical.freshness_state = DataFreshnessState.VERIFIED
    canonical.conflict_details = None
    return canonical


class MultiSourceValidator:
    """Class wrapper for multi-source validation and conflict detection."""

    @staticmethod
    def merge_and_validate(canonical: CanonicalFixture, incoming: RawFixturePayload) -> CanonicalFixture:
        return merge_and_validate_fixture(canonical, incoming)

    @staticmethod
    def validate_fixture_pair(payload_a: RawFixturePayload, payload_b: RawFixturePayload) -> Tuple[CanonicalFixture, bool, Optional[Dict[str, Any]]]:
        from python.src.football.identity import build_canonical_fixture
        canon = build_canonical_fixture(payload_a)
        merged = merge_and_validate_fixture(canon, payload_b)
        is_valid = not merged.has_conflict
        return merged, is_valid, merged.conflict_details
