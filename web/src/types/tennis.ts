/**
 * Oddsbanta — Autonomous Tennis Engine TypeScript Type Definitions
 * Phase 1: Isolated Tennis Data Contracts
 * 
 * Invariant: Never import from or modify football types in index.ts.
 */

export type TennisTour = 'ATP' | 'WTA' | 'GRAND_SLAM' | 'CHALLENGER' | 'ITF';
export type TennisTournamentCategory = 'GS' | '1000' | '500' | '250' | 'CH' | 'ITF';
export type TennisSurface = 'hard_outdoor' | 'hard_indoor' | 'clay' | 'grass' | 'carpet';
export type TennisRound = 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'R128' | 'QUAL';
export type TennisHandedness = 'R' | 'L' | 'U';
export type TennisBackhand = 'one_handed' | 'two_handed' | 'unknown';

export type TennisFixtureStatus =
  | 'scheduled'
  | 'live'
  | 'finished'
  | 'cancelled'
  | 'postponed'
  | 'walkover'
  | 'retired';

export type TennisMarket =
  | 'match_winner'
  | 'set_handicap'
  | 'game_handicap'
  | 'total_games_over_under'
  | 'first_set_winner'
  | 'correct_set_score'
  | 'NO_SAFE_BANKER';

export type TennisConfidenceTier =
  | 'BANGER'
  | 'TOP PICK'
  | 'HIGH CONFIDENCE'
  | 'MID CONFIDENCE'
  | 'LOW CONFIDENCE'
  | 'RISKY'
  | 'NO_SAFE_BANKER'
  | 'LOCKED';

export type TennisSettlementStatus =
  | 'pending'
  | 'won'
  | 'lost'
  | 'void'
  | 'half_won'
  | 'half_lost';

export interface TennisTournament {
  id: string;
  name: string;
  tour: TennisTour;
  category: TennisTournamentCategory;
  surface: TennisSurface;
  court_pace_index: number;
  country?: string | null;
  city?: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface TennisPlayer {
  id: string;
  canonical_name: string;
  display_name: string;
  country?: string | null;
  handedness: TennisHandedness;
  backhand_type: TennisBackhand;
  height_cm?: number | null;
  current_rank?: number | null;
  hard_elo: number;
  clay_elo: number;
  grass_elo: number;
  indoor_elo: number;
  metadata?: Record<string, any>;
  created_at?: string;
  updated_at?: string;
}

export interface TennisFixture {
  id: string;
  canonical_key: string;
  tournament_id: string;
  round: TennisRound;
  player1_id: string;
  player2_id: string;
  best_of_sets: 3 | 5;
  target_kickoff_at: string;
  status: TennisFixtureStatus;
  score_p1_sets: number;
  score_p2_sets: number;
  set_scores: string[];
  current_game_score?: string | null;
  server_indicator?: 1 | 2;
  winner_id?: string | null;
  retired_player_id?: string | null;
  metadata?: Record<string, any>;
  // Expanded joins
  tournament?: TennisTournament;
  player1?: TennisPlayer;
  player2?: TennisPlayer;
  winner?: TennisPlayer;
  created_at?: string;
  updated_at?: string;
}

export interface TennisMarkovMetrics {
  p_serve_player1: number;
  p_serve_player2: number;
  p_hold_player1: number;
  p_hold_player2: number;
  p_tiebreak_player1: number;
  dominance_ratio_player1: number;
  dominance_ratio_player2: number;
  court_pace_index: number;
  stylistic_edge_notes?: string;
  fatigue_penalty_player1?: number;
  fatigue_penalty_player2?: number;
}

export interface TennisSecondaryPrediction {
  market: TennisMarket;
  pick: string;
  probability: number;
  tier: TennisConfidenceTier;
}

export interface TennisPrediction {
  id: string;
  fixture_id: string;
  market: TennisMarket;
  prediction: string;
  probability: number | null;
  confidence_category: TennisConfidenceTier;
  secondary_predictions: TennisSecondaryPrediction[];
  simulations_count: number;
  tier_required: 'free' | 'standard' | 'bigbang' | 'vip' | 'admin';
  publication_status: 'draft' | 'published' | 'archived';
  target_kickoff_at: string;
  metadata: {
    markov?: TennisMarkovMetrics;
    ai_tactical_analysis?: string;
    h2h_breakdown?: {
      overall_p1_wins: number;
      overall_p2_wins: number;
      surface_p1_wins: number;
      surface_p2_wins: number;
      last_match?: string;
    };
    [key: string]: any;
  };
  settlement_status: TennisSettlementStatus;
  settlement_notes?: string | null;
  settled_at?: string | null;
  actual_result?: string | null;
  is_locked?: boolean;
  // Expanded fixture join
  fixture?: TennisFixture;
  created_at?: string;
  updated_at?: string;
}

export interface TennisSettlement {
  id: string;
  prediction_id: string;
  fixture_id: string;
  status: TennisSettlementStatus;
  p1_sets: number;
  p2_sets: number;
  total_games: number;
  was_retired: boolean;
  was_walkover: boolean;
  settlement_logic_version: string;
  notes?: string | null;
  settled_at: string;
  created_at: string;
}
