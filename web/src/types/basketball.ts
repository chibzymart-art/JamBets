/**
 * Oddsbanta — Autonomous Basketball Engine TypeScript Type Definitions
 * Phase 1: Isolated Basketball Data Contracts
 * 
 * Invariant: Never import from or modify football/tennis types.
 */

export type BasketballLeagueCode =
  | 'NBA'
  | 'EUROLEAGUE'
  | 'NCAA_M'
  | 'WNBA'
  | 'ESP_ACB'
  | 'AUS_NBL'
  | 'ITA_LBA'
  | 'TUR_BSL'
  | 'GER_BBL';

export type BasketballFixtureStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'cancelled'
  | 'postponed';

export type BasketballMarket =
  | 'moneyline'
  | 'point_spread'
  | 'game_total_over_under'
  | 'first_half_points'
  | 'first_quarter_winner'
  | 'team_total_over_under'
  | 'NO_SAFE_BANKER';

export type BasketballConfidenceTier =
  | 'BANGER'
  | 'TOP PICK'
  | 'HIGH CONFIDENCE'
  | 'MID CONFIDENCE'
  | 'LOW CONFIDENCE'
  | 'RISKY'
  | 'NO_SAFE_BANKER'
  | 'LOCKED';

export type BasketballSettlementStatus =
  | 'pending'
  | 'won'
  | 'lost'
  | 'void'
  | 'half_won'
  | 'half_lost';

export type BasketballPlayerStatus =
  | 'active'
  | 'questionable'
  | 'doubtful'
  | 'out'
  | 'day_to_day';

export interface BasketballFourFactors {
  efg_pct: number; // Effective Field Goal Percentage (eFG%)
  tov_pct: number; // Turnover Percentage (TOV%)
  orb_pct: number; // Offensive Rebounding Percentage (ORB%)
  ftr: number;     // Free Throw Rate (FTR)
}

export interface BasketballLeague {
  id: string;
  code: BasketballLeagueCode | string;
  name: string;
  country?: string | null;
  quarter_minutes: number;
  periods_count: number;
  default_pace: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BasketballTeam {
  id: string;
  canonical_name: string;
  short_name?: string | null;
  league_id: string;
  conference?: string | null;
  division?: string | null;
  arena_name?: string | null;
  city?: string | null;
  state?: string | null;
  altitude_ft: number;
  offensive_rating: number;
  defensive_rating: number;
  net_rating: number;
  pace: number;
  four_factors: BasketballFourFactors;
  logo_url?: string | null;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  league?: BasketballLeague;
}

export interface BasketballPlayer {
  id: string;
  team_id: string;
  canonical_name: string;
  display_name: string;
  jersey_number?: string | null;
  position?: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | string;
  status: BasketballPlayerStatus;
  usage_rate: number;
  per_rating: number;
  impact_rating: number;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  team?: BasketballTeam;
}

export interface BasketballPeriodScores {
  home: number[];
  away: number[];
}

export interface BasketballFixture {
  id: string;
  canonical_key: string;
  league_id: string;
  home_team_id: string;
  away_team_id: string;
  target_kickoff_at: string;
  status: BasketballFixtureStatus;
  home_score: number;
  away_score: number;
  period_scores: BasketballPeriodScores;
  current_period?: string | null;
  time_remaining?: string | null;
  winner_id?: string | null;
  market_spread?: number | null;
  market_total?: number | null;
  home_moneyline_odds?: number | null;
  away_moneyline_odds?: number | null;
  home_rest_days: number;
  away_rest_days: number;
  is_home_b2b: boolean;
  is_away_b2b: boolean;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
  // Joins
  league?: BasketballLeague;
  home_team?: BasketballTeam;
  away_team?: BasketballTeam;
  winner?: BasketballTeam;
}

export interface BasketballSecondaryPrediction {
  market: BasketballMarket;
  pick: string;
  probability: number;
  tier: BasketballConfidenceTier;
}

export interface BasketballSimulationMetrics {
  simulations_count: number;
  expected_pace: number;
  home_projected_possessions: number;
  away_projected_possessions: number;
  home_adjusted_ortg: number;
  away_adjusted_ortg: number;
  fatigue_adjustment_home: number;
  fatigue_adjustment_away: number;
  altitude_hca_bonus: number;
  simulated_spread_cover_prob?: number;
  simulated_total_over_prob?: number;
  simulated_moneyline_prob?: number;
  distribution?: {
    margin_p10?: number;
    margin_p50?: number;
    margin_p90?: number;
    total_p10?: number;
    total_p50?: number;
    total_p90?: number;
  };
}

export interface BasketballPrediction {
  id: string;
  fixture_id: string;
  market: BasketballMarket;
  prediction: string;
  probability: number | null;
  confidence_category: BasketballConfidenceTier;
  secondary_predictions: BasketballSecondaryPrediction[];
  simulations_count: number;
  simulated_home_score?: number | null;
  simulated_away_score?: number | null;
  edge_percentage?: number | null;
  fair_odds?: number | null;
  market_odds?: number | null;
  tier_required: 'free' | 'standard' | 'bigbang' | 'vip' | 'admin';
  publication_status: 'draft' | 'published' | 'archived';
  target_kickoff_at: string;
  metadata: {
    simulation?: BasketballSimulationMetrics;
    four_factors_differential?: {
      efg_diff: number;
      tov_diff: number;
      orb_diff: number;
      ftr_diff: number;
    };
    ai_tactical_analysis?: string;
    rest_advantage?: string;
    [key: string]: any;
  };
  settlement_status: BasketballSettlementStatus;
  settlement_notes?: string | null;
  settled_at?: string | null;
  actual_result?: string | null;
  is_locked?: boolean;
  fixture?: BasketballFixture;
  created_at?: string;
  updated_at?: string;
}

export interface BasketballSettlement {
  id: string;
  prediction_id: string;
  fixture_id: string;
  status: BasketballSettlementStatus;
  final_home_score: number;
  final_away_score: number;
  score_margin: number;
  total_points: number;
  was_overtime: boolean;
  settlement_logic_version: string;
  notes?: string | null;
  settled_at: string;
  created_at: string;
}
