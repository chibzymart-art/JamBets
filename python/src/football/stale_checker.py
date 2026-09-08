"""
JamBets — Stale Data Protection & Freshness Classifier
Ensures no stale data is processed or allowed to become the result of a fixture.
Distinguishes: CURRENT, HISTORICAL, STALE, UNKNOWN, VERIFIED, CONFLICTING.
"""

from datetime import datetime, timezone, timedelta
from typing import Tuple, Optional
from python.src.config import (
    STALE_THRESHOLD_SCHEDULED_SECONDS,
    STALE_THRESHOLD_LIVE_SECONDS,
    STALE_THRESHOLD_RESULT_SECONDS,
    MAX_PREDICTION_WINDOW_DAYS
)
from python.src.football.models import RawFixturePayload, DataFreshnessState, FixtureStatus


class StaleDataError(Exception):
    """Raised when data violates staleness thresholds."""
    pass


def evaluate_freshness(payload: RawFixturePayload, now_utc: Optional[datetime] = None) -> Tuple[DataFreshnessState, str]:
    """
    Evaluates whether a raw payload is fresh, stale, historical, or unknown.
    Returns (DataFreshnessState, reason_str).
    """
    if now_utc is None:
        now_utc = datetime.now(timezone.utc)

    # 1. Check retrieval timestamp
    if not payload.retrieved_at:
        return DataFreshnessState.UNKNOWN, "Payload lacks retrieval timestamp"

    retrieval_age = (now_utc - payload.retrieved_at).total_seconds()
    if retrieval_age < 0:
        return DataFreshnessState.UNKNOWN, "Payload retrieval time is in the future"

    # 2. Check stale threshold based on status
    if payload.status == FixtureStatus.LIVE:
        if retrieval_age > STALE_THRESHOLD_LIVE_SECONDS:
            return DataFreshnessState.STALE, f"Live status age ({int(retrieval_age)}s) exceeds max allowed ({STALE_THRESHOLD_LIVE_SECONDS}s)"
    elif payload.status == FixtureStatus.FINISHED:
        if retrieval_age > STALE_THRESHOLD_RESULT_SECONDS:
            return DataFreshnessState.HISTORICAL, f"Finished result age ({int(retrieval_age)}s) is historical"
    else:  # SCHEDULED
        if retrieval_age > STALE_THRESHOLD_SCHEDULED_SECONDS:
            return DataFreshnessState.STALE, f"Scheduled fixture age ({int(retrieval_age)}s) exceeds max allowed ({STALE_THRESHOLD_SCHEDULED_SECONDS}s)"

    # 3. Check for temporal alignment: Never allow old kickoff to be treated as upcoming
    kickoff_diff = (payload.kickoff_time - now_utc).total_seconds()
    if payload.status == FixtureStatus.SCHEDULED and kickoff_diff < -3600:
        return DataFreshnessState.STALE, "Scheduled fixture kickoff time has already passed by over 1 hour"

    return DataFreshnessState.CURRENT, "Payload is fresh and valid"


def validate_not_stale(payload: RawFixturePayload) -> None:
    """Enforces strict rejection of stale payloads."""
    state, reason = evaluate_freshness(payload)
    if state == DataFreshnessState.STALE:
        raise StaleDataError(f"Stale data rejected: {reason}")
