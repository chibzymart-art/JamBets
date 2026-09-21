"""
Oddsbanta — Autonomous Tennis Engine Python Domain Models
Phase 1: Isolated Tennis Data Contracts & Entities

Invariant: Completely independent from football models (models.py).
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Any, List, Optional
from datetime import datetime


class TennisTour(str, Enum):
    ATP = "ATP"
    WTA = "WTA"
    GRAND_SLAM = "GRAND_SLAM"
    CHALLENGER = "CHALLENGER"
    ITF = "ITF"


class TennisTournamentCategory(str, Enum):
    GS = "GS"
    ATP_1000 = "1000"
    ATP_500 = "500"
    ATP_250 = "250"
    CHALLENGER = "CH"
    ITF = "ITF"


class TennisSurface(str, Enum):
    HARD_OUTDOOR = "hard_outdoor"
    HARD_INDOOR = "hard_indoor"
    CLAY = "clay"
    GRASS = "grass"
    CARPET = "carpet"


class TennisFixtureStatus(str, Enum):
    SCHEDULED = "scheduled"
    LIVE = "live"
    FINISHED = "finished"
    CANCELLED = "cancelled"
    POSTPONED = "postponed"
    WALKOVER = "walkover"
    RETIRED = "retired"


class TennisMarket(str, Enum):
    MATCH_WINNER = "match_winner"
    SET_HANDICAP = "set_handicap"
    GAME_HANDICAP = "game_handicap"
    TOTAL_GAMES_OVER_UNDER = "total_games_over_under"
    FIRST_SET_WINNER = "first_set_winner"
    CORRECT_SET_SCORE = "correct_set_score"
    NO_SAFE_BANKER = "NO_SAFE_BANKER"


class TennisConfidenceTier(str, Enum):
    BANGER = "BANGER"
    TOP_PICK = "TOP PICK"
    HIGH_CONFIDENCE = "HIGH CONFIDENCE"
    MID_CONFIDENCE = "MID CONFIDENCE"
    LOW_CONFIDENCE = "LOW CONFIDENCE"
    RISKY = "RISKY"
    NO_SAFE_BANKER = "NO_SAFE_BANKER"


class TennisSettlementStatus(str, Enum):
    PENDING = "pending"
    WON = "won"
    LOST = "lost"
    VOID = "void"
    HALF_WON = "half_won"
    HALF_LOST = "half_lost"


@dataclass
class TennisTournamentModel:
    id: Optional[str]
    name: str
    tour: TennisTour
    category: TennisTournamentCategory
    surface: TennisSurface
    court_pace_index: float = 35.0
    country: Optional[str] = None
    city: Optional[str] = None
    is_active: bool = True


@dataclass
class TennisPlayerModel:
    id: Optional[str]
    canonical_name: str
    display_name: str
    country: Optional[str] = None
    handedness: str = "R"
    backhand_type: str = "two_handed"
    height_cm: Optional[int] = None
    current_rank: Optional[int] = None
    hard_elo: float = 1500.0
    clay_elo: float = 1500.0
    grass_elo: float = 1500.0
    indoor_elo: float = 1500.0
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TennisFixtureModel:
    id: Optional[str]
    canonical_key: str
    tournament_id: str
    round: str
    player1_id: str
    player2_id: str
    best_of_sets: int
    target_kickoff_at: datetime
    status: TennisFixtureStatus = TennisFixtureStatus.SCHEDULED
    score_p1_sets: int = 0
    score_p2_sets: int = 0
    set_scores: List[str] = field(default_factory=list)
    current_game_score: Optional[str] = None
    server_indicator: int = 1
    winner_id: Optional[str] = None
    retired_player_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class TennisPredictionModel:
    id: Optional[str]
    fixture_id: str
    market: TennisMarket
    prediction: str
    probability: float
    confidence_category: TennisConfidenceTier
    secondary_predictions: List[Dict[str, Any]] = field(default_factory=list)
    simulations_count: int = 250000
    tier_required: str = "free"
    publication_status: str = "published"
    target_kickoff_at: datetime = field(default_factory=datetime.utcnow)
    metadata: Dict[str, Any] = field(default_factory=dict)
    settlement_status: TennisSettlementStatus = TennisSettlementStatus.PENDING
    settlement_notes: Optional[str] = None
    settled_at: Optional[datetime] = None
    actual_result: Optional[str] = None


@dataclass
class TennisSettlementModel:
    id: Optional[str]
    prediction_id: str
    fixture_id: str
    status: TennisSettlementStatus
    p1_sets: int = 0
    p2_sets: int = 0
    total_games: int = 0
    was_retired: bool = False
    was_walkover: bool = False
    settlement_logic_version: str = "1.0"
    notes: Optional[str] = None
    settled_at: datetime = field(default_factory=datetime.utcnow)
