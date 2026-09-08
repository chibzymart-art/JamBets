"""
JamBets — Football Fixture Engine & Four-Day Queue
Manages fixture discovery, lifecycle transitions, canonical identity deduplication,
historical contamination prevention, and the strict four-day prediction queue.
"""

from datetime import datetime, timezone, timedelta, date
from typing import Optional, Dict, Any, List, Tuple
from pydantic import BaseModel, Field

from python.src.football.models import (
    FixtureStatus,
    RawFixturePayload,
    CanonicalFixture,
    DataFreshnessState,
)
from python.src.football.identity import CanonicalIdentityResolver
from python.src.football.stale_checker import StaleDataChecker


class QueueWindowResult(BaseModel):
    is_eligible: bool
    queue_day: Optional[int] = Field(None, ge=0, le=4)
    reason: str


class FixtureEngine:
    """
    Core engine managing football fixtures, lifecycle states, and the 4-day prediction queue.
    """

    MAX_QUEUE_DAYS = 4  # Strict four-day window: TODAY (0), +1, +2, +3, +4

    def __init__(self):
        self.identity_resolver = CanonicalIdentityResolver()
        self.stale_checker = StaleDataChecker()

    def compute_queue_window(
        self,
        kickoff_utc: datetime,
        reference_time: Optional[datetime] = None,
    ) -> QueueWindowResult:
        """
        Determines whether a fixture falls strictly within the four-day prediction window:
        TODAY (Day 0), +1 (Day 1), +2 (Day 2), +3 (Day 3), +4 (Day 4).
        Anything beyond +4 days or in the past is disqualified from the prediction queue.
        """
        if reference_time is None:
            reference_time = datetime.now(timezone.utc)

        # Normalize to UTC
        if kickoff_utc.tzinfo is None:
            kickoff_utc = kickoff_utc.replace(tzinfo=timezone.utc)
        if reference_time.tzinfo is None:
            reference_time = reference_time.replace(tzinfo=timezone.utc)

        ref_date = reference_time.date()
        kickoff_date = kickoff_utc.date()

        delta_days = (kickoff_date - ref_date).days

        # Rule 1: Past matches cannot enter the queue
        if kickoff_utc < reference_time - timedelta(minutes=10):
            return QueueWindowResult(
                is_eligible=False,
                queue_day=None,
                reason="PAST_OR_HISTORICAL_MATCH",
            )

        if delta_days < 0:
            return QueueWindowResult(
                is_eligible=False,
                queue_day=None,
                reason="NEGATIVE_DAY_OFFSET",
            )

        # Rule 2: Strictly within [0, 4] days
        if 0 <= delta_days <= self.MAX_QUEUE_DAYS:
            return QueueWindowResult(
                is_eligible=True,
                queue_day=delta_days,
                reason=f"DAY_{delta_days}_QUEUE_ELIGIBLE",
            )

        # Rule 3: Beyond 4 days is strictly disqualified
        return QueueWindowResult(
            is_eligible=False,
            queue_day=None,
            reason=f"EXCEEDS_FOUR_DAY_WINDOW (offset: +{delta_days} days)",
        )

    def evaluate_lifecycle_state(
        self,
        current_status: FixtureStatus,
        incoming_status_signal: str,
    ) -> Tuple[FixtureStatus, Dict[str, Any]]:
        """
        Transitions fixture status based on incoming provider signal.
        Detects postponement, cancellation, in-play, or completion.
        """
        signal = incoming_status_signal.lower().strip()
        metadata: Dict[str, Any] = {}
        now_str = datetime.now(timezone.utc).isoformat()

        # Postponement signals
        if any(term in signal for term in ["postponed", "postp", "p-p", "suspended"]):
            metadata["postponed_at"] = now_str
            metadata["lifecycle_transition"] = "postponed"
            return FixtureStatus.POSTPONED, metadata

        # Cancellation signals
        if any(term in signal for term in ["cancelled", "canceled", "canc", "abandoned"]):
            metadata["cancelled_at"] = now_str
            metadata["lifecycle_transition"] = "cancelled"
            return FixtureStatus.CANCELLED, metadata

        # Live / In-play signals
        if any(term in signal for term in ["in_play", "live", "first_half", "second_half", "halftime", "ht"]):
            metadata["in_play_at"] = now_str
            return FixtureStatus.IN_PLAY, metadata

        # Completed / Finished signals
        if any(term in signal for term in ["finished", "full_time", "ft", "completed", "final"]):
            metadata["completed_at"] = now_str
            return FixtureStatus.FINISHED, metadata

        # Scheduled
        return FixtureStatus.SCHEDULED, metadata

    def verify_historical_isolation(
        self,
        target_canonical_key: str,
        target_kickoff: datetime,
        candidate_event_date: date,
        candidate_event_id: str,
    ) -> bool:
        """
        Guarantees that a current/upcoming fixture scheduled today can NEVER be
        associated with, or retrieve results from, a historical match simply
        because the teams or league are identical.

        Returns True ONLY IF the candidate event strictly matches the exact date.
        """
        target_date = target_kickoff.date()
        if candidate_event_date != target_date:
            return False

        # Extract date from canonical key ({league}:{home}:{away}:{YYYYMMDD})
        key_parts = target_canonical_key.split(":")
        if len(key_parts) == 4:
            canonical_date_str = key_parts[3]
            expected_date_str = target_date.strftime("%Y%m%d")
            if canonical_date_str != expected_date_str:
                return False

        return True

    def process_fixture(
        self,
        raw_payload: RawFixturePayload,
        reference_time: Optional[datetime] = None,
    ) -> Tuple[Optional[CanonicalFixture], Dict[str, Any]]:
        """
        Full fixture processing:
        1. Stale data check
        2. Canonical identity resolution (duplicate protection)
        3. Lifecycle state evaluation (postponement/cancellation)
        4. Four-day window calculation
        """
        now = reference_time or datetime.now(timezone.utc)
        meta: Dict[str, Any] = {}

        # 1. Stale Data Protection
        is_stale, freshness_state = self.stale_checker.is_stale(raw_payload, now)
        meta["freshness_state"] = freshness_state.value
        if is_stale:
            meta["rejection_reason"] = "STALE_DATA_PAYLOAD"
            return None, meta

        # 2. Canonical Identity
        canonical_key = self.identity_resolver.generate_canonical_key(
            league_code=raw_payload.league_code,
            home_name=raw_payload.home_team_name,
            away_name=raw_payload.away_team_name,
            kickoff_at=raw_payload.scheduled_kickoff,
        )

        # 3. Lifecycle State
        status, lifecycle_meta = self.evaluate_lifecycle_state(
            current_status=raw_payload.status,
            incoming_status_signal=raw_payload.status.value,
        )
        meta.update(lifecycle_meta)

        # 4. Four-day Window Calculation
        queue_result = self.compute_queue_window(
            kickoff_utc=raw_payload.scheduled_kickoff,
            reference_time=now,
        )
        meta["queue_window"] = queue_result.model_dump()

        # Final queue eligibility: must be within [0, 4] days AND scheduled (not postponed/cancelled)
        is_in_queue = queue_result.is_eligible and (status == FixtureStatus.SCHEDULED)
        queue_day = queue_result.queue_day if is_in_queue else None

        canonical_fixture = CanonicalFixture(
            canonical_key=canonical_key,
            league_code=raw_payload.league_code,
            season=raw_payload.season,
            canonical_home_team=self.identity_resolver.normalize_team_name(raw_payload.home_team_name),
            canonical_away_team=self.identity_resolver.normalize_team_name(raw_payload.away_team_name),
            kickoff_utc=raw_payload.scheduled_kickoff,
            status=status,
            home_score=raw_payload.home_score,
            away_score=raw_payload.away_score,
            freshness_state=freshness_state,
            sources=[raw_payload],
            agreement_count=1,
            has_conflict=False,
        )

        return canonical_fixture, {
            "in_prediction_queue": is_in_queue,
            "queue_day": queue_day,
            "postponed_at": meta.get("postponed_at"),
            "cancelled_at": meta.get("cancelled_at"),
            "queue_reason": queue_result.reason,
        }
