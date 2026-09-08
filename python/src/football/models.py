"""
JamBets — Football Data Acquisition Models
Strict Pydantic schemas enforcing provenance, validation, and freshness.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional, Any
from pydantic import BaseModel, Field, field_validator


class FixtureStatus(str, Enum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    FINISHED = "finished"
    POSTPONED = "postponed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"
    SUSPENDED = "suspended"


class DataFreshnessState(str, Enum):
    CURRENT = "current"
    HISTORICAL = "historical"
    STALE = "stale"
    UNKNOWN = "unknown"
    VERIFIED = "verified"
    CONFLICTING = "conflicting"


class RawFixturePayload(BaseModel):
    """Raw extraction from an external data source adapter."""
    source_name: str
    provider_event_id: str
    league_code: str
    season: str
    home_team_raw: str
    away_team_raw: str
    kickoff_time: datetime
    status: FixtureStatus
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    venue: Optional[str] = None
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    raw_metadata: Dict[str, Any] = Field(default_factory=dict)


class CanonicalFixture(BaseModel):
    """Normalized, canonical fixture identity representation."""
    sport: str = "football"
    league_code: str
    season: str
    canonical_home_team: str
    canonical_away_team: str
    kickoff_utc: datetime
    canonical_key: str  # Format: {league_code}:{home}:{away}:{YYYYMMDD}
    status: FixtureStatus
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    freshness_state: DataFreshnessState = DataFreshnessState.CURRENT
    sources: List[RawFixturePayload] = Field(default_factory=list)
    agreement_count: int = 1
    has_conflict: bool = False
    conflict_details: Optional[Dict[str, Any]] = None

    @field_validator("canonical_key")
    @classmethod
    def validate_canonical_key(cls, v: str) -> str:
        parts = v.split(":")
        if len(parts) != 4:
            raise ValueError(f"Invalid canonical key format: {v}")
        return v
