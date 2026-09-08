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
  simulation_id?: string;
  simulation_run_id?: string;
  market: string;
  prediction: string;
  probability: number;
  confidence_category: ConfidenceTier;
  publication_status: string;
  tier_required: string;
  source_data_version: string;
  metadata?: {
    simulation_job_id?: string;
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
  target_simulations: number;
  completed_simulations: number;
  status: string;
  created_at: string;
  run_tracking?: {
    simulation_job_id?: string;
    model_version?: string;
    dataset_version?: string;
    feature_version?: string;
    calibration_version?: string;
    rng_algorithm?: string;
    seed?: number;
    duration_ms?: number;
    lambda_home?: number;
    lambda_away?: number;
    home_win_pct?: number;
    draw_pct?: number;
    away_win_pct?: number;
    over_25_pct?: number;
    under_25_pct?: number;
    btts_yes_pct?: number;
    first_half_avg_goals?: number;
    second_half_avg_goals?: number;
    corners_simulated?: boolean;
    sanity_report?: {
      sum_1x2?: number;
      sum_btts?: number;
      is_valid?: boolean;
    };
    scoreline_distribution?: Record<string, number>;
  };
}

export interface SchedulerJob {
  id: string;
  job_type: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  idempotency_key: string;
  started_at: string;
  completed_at?: string;
  error_message?: string;
  metadata?: {
    slot?: number;
    cycle_id?: string;
    timezone?: string;
    slot_time_wat?: string;
    next_scheduled_wat?: string;
    worker_id?: string;
    duration_ms?: number;
    fixtures_discovered?: number;
    fixtures_eligible?: number;
    fixtures_processed?: number;
    simulations_completed?: number;
    total_simulated_draws?: number;
    predictions_published?: number;
    fixtures_skipped?: number;
    fixtures_failed?: number;
    retried_count?: number;
  };
  created_at: string;
}

