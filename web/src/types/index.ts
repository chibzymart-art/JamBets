export interface QueueFixture {
  id: string;
  canonical_key: string;
  target_kickoff_at: string;
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled';
  queue_day: number;
  in_prediction_queue: boolean;
  postponed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  league_id: string;
  league_name: string;
  league_code: string;
  league_country: string;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
}

export interface DayTab {
  day: number | 'all';
  label: string;
  sublabel: string;
  count: number;
}

export type ConfidenceTier =
  | 'BANGER'
  | 'TOP PICK'
  | 'HIGH CONFIDENCE'
  | 'MID CONFIDENCE'
  | 'LOW CONFIDENCE'
  | 'RISKY';

export interface FootballPrediction {
  id: string;
  fixture_id: string;
  simulation_run_id?: string;
  market: string;
  prediction: string;
  probability: number;
  confidence_category: ConfidenceTier;
  publication_status: string;
  tier_required: string;
  source_data_version: string;
  metadata?: {
    probability_pct?: number;
    simulations?: number;
    canonical_key?: string;
    model_version?: string;
    home_attack?: number;
    away_attack?: number;
    lambda_home?: number;
    lambda_away?: number;
  };
  target_kickoff_at: string;
  created_at: string;
}

export interface SimulationRecord {
  id: string;
  fixture_id: string;
  simulation_run_id: string;
  target_simulations: number;
  completed_simulations: number;
  duration_ms: number;
  status: string;
  summary_stats?: {
    model_version?: string;
    home_win_pct?: number;
    draw_pct?: number;
    away_win_pct?: number;
    over_25_pct?: number;
    under_25_pct?: number;
    btts_yes_pct?: number;
    lambda_home?: number;
    lambda_away?: number;
  };
}
