"""
JamBets — Football Live Match State Monitor & Normalizer
Enforces verified live feed ingestion, freshness validation, multi-source conflict detection,
and strict "kickoff passed != LIVE" rules.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple
from pydantic import BaseModel, Field
from python.src.football.models import FixtureStatus, DataFreshnessState, RawFixturePayload


class LiveMatchState(BaseModel):
    """Normalized, verified match state for in-play monitoring and settlement."""
    fixture_id: str
    canonical_key: str
    provider_event_id: str
    source_name: str
    status: FixtureStatus
    raw_status: str
    scheduled_kickoff: datetime
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    match_minute: Optional[int] = None
    period: Optional[str] = None  # 'PRE', '1H', 'HT', '2H', 'FT', 'ET', 'PK'
    half_time_home_score: Optional[int] = None
    half_time_away_score: Optional[int] = None
    corners_home: Optional[int] = None
    corners_away: Optional[int] = None
    events: List[Dict[str, Any]] = Field(default_factory=list)
    retrieval_time: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    source_timestamp: Optional[datetime] = None
    is_stale: bool = False
    is_verified: bool = True
    has_conflict: bool = False
    conflict_reason: Optional[str] = None

    @property
    def total_goals(self) -> Optional[int]:
        if self.home_score is not None and self.away_score is not None:
            return self.home_score + self.away_score
        return None

    @property
    def total_corners(self) -> Optional[int]:
        if self.corners_home is not None and self.corners_away is not None:
            return self.corners_home + self.corners_away
        return None

    @property
    def score_string(self) -> str:
        if self.home_score is not None and self.away_score is not None:
            return f"{self.home_score}-{self.away_score}"
        return "0-0"


class LiveMonitorEngine:
    """
    Ingests raw source payloads, validates freshness and identity,
    detects multi-source conflicts, and normalizes match states.
    """

    STALE_DATA_THRESHOLD_MINUTES = 30

    @classmethod
    def normalize_status(
        cls,
        raw_status: str,
        scheduled_kickoff: datetime,
        now_utc: Optional[datetime] = None
    ) -> FixtureStatus:
        """
        Enforces Rule 4: DO NOT CONFUSE 'KICKOFF PASSED' WITH 'LIVE'.
        A match is LIVE only when an approved verified source explicitly indicates it.
        If kickoff time has passed but source says SCHEDULED, it remains SCHEDULED.
        """
        raw_upper = (raw_status or "").strip().upper()

        # Explicit Finished
        if any(term in raw_upper for term in ("FINAL", "FULL_TIME", "STATUS_FINAL", "STATUS_FULL_TIME", "FT", "FINISHED", "ENDED")):
            return FixtureStatus.FINISHED

        # Explicit Postponed
        if any(term in raw_upper for term in ("POSTPONED", "STATUS_POSTPONED", "PPD")):
            return FixtureStatus.POSTPONED

        # Explicit Cancelled
        if any(term in raw_upper for term in ("CANCELLED", "CANCELED", "STATUS_CANCELED", "STATUS_CANCELLED")):
            return FixtureStatus.CANCELLED

        # Explicit Suspended / Interrupted
        if any(term in raw_upper for term in ("SUSPENDED", "STATUS_SUSPENDED", "INTERRUPTED")):
            return FixtureStatus.SUSPENDED

        # Explicit Live / In Progress / Halftime
        if any(term in raw_upper for term in (
            "IN_PROGRESS", "FIRST_HALF", "SECOND_HALF", "HALFTIME", "HALF_TIME",
            "STATUS_IN_PROGRESS", "STATUS_FIRST_HALF", "STATUS_SECOND_HALF", "STATUS_HALFTIME", "LIVE"
        )):
            return FixtureStatus.LIVE

        # Default fallback: strictly remain SCHEDULED.
        # Even if scheduled_kickoff < now, do NOT promote to LIVE without explicit source confirmation.
        return FixtureStatus.SCHEDULED

    @classmethod
    def validate_freshness(
        cls,
        retrieval_time: datetime,
        source_timestamp: Optional[datetime] = None,
        now_utc: Optional[datetime] = None
    ) -> bool:
        """
        Returns True if data is fresh, False if stale.
        Stale data (>30m old) must NEVER settle predictions.
        """
        ref_time = now_utc or datetime.now(timezone.utc)
        effective_ts = source_timestamp or retrieval_time

        if effective_ts.tzinfo is None:
            effective_ts = effective_ts.replace(tzinfo=timezone.utc)

        age = (ref_time - effective_ts).total_seconds()
        return age <= (cls.STALE_DATA_THRESHOLD_MINUTES * 60)

    @classmethod
    def reconcile_multi_sources(
        cls,
        fixture_id: str,
        canonical_key: str,
        scheduled_kickoff: datetime,
        source_payloads: List[RawFixturePayload],
        now_utc: Optional[datetime] = None
    ) -> LiveMatchState:
        """
        Multi-source reconciliation:
        - If multiple sources cover the same fixture, compare scores and status.
        - If sources agree: VERIFIED.
        - If critical sources disagree (e.g. Source A says 2-1, Source B says 1-1): CONFLICT.
        """
        if not source_payloads:
            # No data retrieved — keep PENDING / SCHEDULED with no fake score
            return LiveMatchState(
                fixture_id=fixture_id,
                canonical_key=canonical_key,
                provider_event_id="unknown",
                source_name="none",
                status=FixtureStatus.SCHEDULED,
                raw_status="NO_DATA",
                scheduled_kickoff=scheduled_kickoff,
                is_stale=False,
                is_verified=False
            )

        now = now_utc or datetime.now(timezone.utc)

        # Primary source
        primary = source_payloads[0]
        raw_status = primary.raw_metadata.get("espn_status") or str(primary.status.value)
        status = cls.normalize_status(raw_status, scheduled_kickoff, now)

        is_fresh = cls.validate_freshness(primary.retrieved_at, now_utc=now)

        # Extract period and minute from metadata
        match_minute = primary.raw_metadata.get("minute")
        period = primary.raw_metadata.get("period")
        if "HALFTIME" in raw_status.upper():
            period = "HT"
        elif status == FixtureStatus.FINISHED:
            period = "FT"
        elif status == FixtureStatus.LIVE and not period:
            period = "2H" if (match_minute and match_minute > 45) else "1H"

        # Check multi-source conflict if >1 sources exist
        has_conflict = False
        conflict_reason = None

        if len(source_payloads) > 1:
            for other in source_payloads[1:]:
                # Check score conflict
                if primary.home_score is not None and other.home_score is not None:
                    if primary.home_score != other.home_score or primary.away_score != other.away_score:
                        has_conflict = True
                        conflict_reason = f"Score mismatch: {primary.source_name} ({primary.home_score}-{primary.away_score}) vs {other.source_name} ({other.home_score}-{other.away_score})"
                        break

                # Check status conflict
                other_raw_status = other.raw_metadata.get("espn_status") or str(other.status.value)
                other_status = cls.normalize_status(other_raw_status, scheduled_kickoff, now)
                if status in (FixtureStatus.FINISHED, FixtureStatus.CANCELLED) and other_status == FixtureStatus.LIVE:
                    has_conflict = True
                    conflict_reason = f"Status conflict: {primary.source_name} ({status}) vs {other.source_name} ({other_status})"
                    break

        # Extract half-time scores if recorded
        ht_home = primary.raw_metadata.get("half_time_home_score")
        ht_away = primary.raw_metadata.get("half_time_away_score")

        # Extract corners if available (do NOT fabricate 0 if absent!)
        corners_h = primary.raw_metadata.get("corners_home")
        corners_a = primary.raw_metadata.get("corners_away")

        events = primary.raw_metadata.get("events") or []

        return LiveMatchState(
            fixture_id=fixture_id,
            canonical_key=canonical_key,
            provider_event_id=primary.provider_event_id,
            source_name=primary.source_name,
            status=status,
            raw_status=raw_status,
            scheduled_kickoff=scheduled_kickoff,
            home_score=primary.home_score,
            away_score=primary.away_score,
            match_minute=match_minute,
            period=period,
            half_time_home_score=ht_home,
            half_time_away_score=ht_away,
            corners_home=corners_h,
            corners_away=corners_a,
            events=events,
            retrieval_time=primary.retrieved_at,
            is_stale=not is_fresh,
            is_verified=not has_conflict and is_fresh,
            has_conflict=has_conflict,
            conflict_reason=conflict_reason
        )
