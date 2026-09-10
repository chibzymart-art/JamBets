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


from pydantic import BaseModel, Field, field_validator, model_validator


class RawFixturePayload(BaseModel):
    """Raw extraction from an external data source adapter."""
    source_name: str
    provider_event_id: str
    league_code: str
    season: str = "2026/2027"
    home_team_raw: str
    away_team_raw: str
    kickoff_time: datetime
    status: FixtureStatus
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    venue: Optional[str] = None
    retrieved_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    raw_metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def handle_aliases(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "home_team_name" in data and "home_team_raw" not in data:
                data["home_team_raw"] = data["home_team_name"]
            if "away_team_name" in data and "away_team_raw" not in data:
                data["away_team_raw"] = data["away_team_name"]
            if "scheduled_kickoff" in data and "kickoff_time" not in data:
                data["kickoff_time"] = data["scheduled_kickoff"]
            if "scheduled_kickoff_utc" in data and "kickoff_time" not in data:
                data["kickoff_time"] = data["scheduled_kickoff_utc"]
            if "season" not in data:
                data["season"] = "2026/2027"
        return data

    @property
    def home_team_name(self) -> str:
        return self.home_team_raw

    @property
    def away_team_name(self) -> str:
        return self.away_team_raw

    @property
    def scheduled_kickoff(self) -> datetime:
        return self.kickoff_time


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
