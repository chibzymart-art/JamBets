"""
Oddsbanta — Autonomous Basketball Engine Python Domain Models
Phase 1: Isolated Basketball Data Contracts & Entities

Invariant: Completely independent from football and tennis models.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Any, List, Optional
from datetime import datetime


class BasketballLeagueCode(str, Enum):
    NBA = "NBA"
    EUROLEAGUE = "EUROLEAGUE"
    NCAA_M = "NCAA_M"
    WNBA = "WNBA"
    ESP_ACB = "ESP_ACB"
    AUS_NBL = "AUS_NBL"
    ITA_LBA = "ITA_LBA"
    TUR_BSL = "TUR_BSL"
    GER_BBL = "GER_BBL"


class BasketballFixtureStatus(str, Enum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    FINISHED = "finished"
    CANCELLED = "cancelled"
    POSTPONED = "postponed"


class BasketballMarket(str, Enum):
    MONEYLINE = "moneyline"
    POINT_SPREAD = "point_spread"
    GAME_TOTAL_OVER_UNDER = "game_total_over_under"
    FIRST_HALF_POINTS = "first_half_points"
    FIRST_QUARTER_WINNER = "first_quarter_winner"
    TEAM_TOTAL_OVER_UNDER = "team_total_over_under"
    NO_SAFE_BANKER = "NO_SAFE_BANKER"


class BasketballConfidenceTier(str, Enum):
    BANGER = "BANGER"
    TOP_PICK = "TOP PICK"
    HIGH_CONFIDENCE = "HIGH CONFIDENCE"
    MID_CONFIDENCE = "MID CONFIDENCE"
    LOW_CONFIDENCE = "LOW CONFIDENCE"
    RISKY = "RISKY"
    NO_SAFE_BANKER = "NO_SAFE_BANKER"


class BasketballSettlementStatus(str, Enum):
    PENDING = "pending"
    WON = "won"
    LOST = "lost"
    VOID = "void"
    HALF_WON = "half_won"
    HALF_LOST = "half_lost"


class BasketballPlayerStatus(str, Enum):
    ACTIVE = "active"
    QUESTIONABLE = "questionable"
    DOUBTFUL = "doubtful"
    OUT = "out"
    DAY_TO_DAY = "day_to_day"


@dataclass
class BasketballFourFactors:
    efg_pct: float = 0.535
    tov_pct: float = 0.125
    orb_pct: float = 0.250
    ftr: float = 0.220

    def to_dict(self) -> Dict[str, float]:
        return {
            "efg_pct": self.efg_pct,
            "tov_pct": self.tov_pct,
            "orb_pct": self.orb_pct,
            "ftr": self.ftr,
        }


@dataclass
class BasketballLeagueModel:
    id: Optional[str]
    code: str
    name: str
    country: Optional[str] = None
    quarter_minutes: int = 12
    periods_count: int = 4
    default_pace: float = 99.5
    is_active: bool = True


@dataclass
class BasketballTeamModel:
    id: Optional[str]
    canonical_name: str
    league_id: str
    short_name: Optional[str] = None
    conference: Optional[str] = None
    division: Optional[str] = None
    arena_name: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    altitude_ft: int = 0
    offensive_rating: float = 112.0
    defensive_rating: float = 112.0
    net_rating: float = 0.0
    pace: float = 99.5
    four_factors: Dict[str, float] = field(
        default_factory=lambda: {"efg_pct": 0.535, "tov_pct": 0.125, "orb_pct": 0.250, "ftr": 0.220}
    )
    logo_url: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BasketballPlayerModel:
    id: Optional[str]
    team_id: str
    canonical_name: str
    display_name: str
    jersey_number: Optional[str] = None
    position: Optional[str] = None
    status: BasketballPlayerStatus = BasketballPlayerStatus.ACTIVE
    usage_rate: float = 20.0
    per_rating: float = 15.0
    impact_rating: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BasketballFixtureModel:
    id: Optional[str]
    canonical_key: str
    league_id: str
    home_team_id: str
    away_team_id: str
    target_kickoff_at: datetime
    status: BasketballFixtureStatus = BasketballFixtureStatus.SCHEDULED
    home_score: int = 0
    away_score: int = 0
    period_scores: Dict[str, List[int]] = field(
        default_factory=lambda: {"home": [], "away": []}
    )
    current_period: Optional[str] = None
    time_remaining: Optional[str] = None
    winner_id: Optional[str] = None
    market_spread: Optional[float] = None
    market_total: Optional[float] = None
    home_moneyline_odds: Optional[float] = None
    away_moneyline_odds: Optional[float] = None
    home_rest_days: int = 1
    away_rest_days: int = 1
    is_home_b2b: bool = False
    is_away_b2b: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class BasketballPredictionModel:
    id: Optional[str]
    fixture_id: str
    market: BasketballMarket
    prediction: str
    probability: float
    confidence_category: BasketballConfidenceTier
    secondary_predictions: List[Dict[str, Any]] = field(default_factory=list)
    simulations_count: int = 250000
    simulated_home_score: Optional[float] = None
    simulated_away_score: Optional[float] = None
    edge_percentage: Optional[float] = None
    fair_odds: Optional[float] = None
    market_odds: Optional[float] = None
    tier_required: str = "free"
    publication_status: str = "published"
    target_kickoff_at: datetime = field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = field(default_factory=dict)
    settlement_status: BasketballSettlementStatus = BasketballSettlementStatus.PENDING
    settlement_notes: Optional[str] = None
    settled_at: Optional[datetime] = None
    actual_result: Optional[str] = None


@dataclass
class BasketballSettlementModel:
    id: Optional[str]
    prediction_id: str
    fixture_id: str
    status: BasketballSettlementStatus
    final_home_score: int
    final_away_score: int
    score_margin: int
    total_points: int
    was_overtime: bool = False
    settlement_logic_version: str = "1.0"
    notes: Optional[str] = None
    settled_at: datetime = field(default_factory=datetime.utcnow)
