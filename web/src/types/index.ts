export interface QueueFixture {
  id: string;
  canonical_key: string;
  target_kickoff_at: string;
  status: 'scheduled' | 'live' | 'finished' | 'postponed' | 'cancelled' | 'data_unavailable' | string;
  queue_day: number;
  in_prediction_queue: boolean;
  home_score?: number | null;
  away_score?: number | null;
  match_minute?: number | null;
  period?: string | null;
  half_time_home_score?: number | null;
  half_time_away_score?: number | null;
  corners_home?: number | null;
  corners_away?: number | null;
  last_synced_at?: string | null;
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
  | 'TOP_PICK'
  | 'TOP PICK'
  | 'HIGH_CONFIDENCE'
  | 'HIGH CONFIDENCE'
  | 'MID_CONFIDENCE'
  | 'MID CONFIDENCE'
  | 'LOW_CONFIDENCE'
  | 'LOW CONFIDENCE'
  | 'RISKY'
  | 'NO_SAFE_BANKER'
  | 'no_safe_banker'
  | 'LOCKED'
  | 'HIDDEN';

export interface SecondaryPrediction {
  market: string;
  prediction?: string;
  probability: number;
  prob?: number;
  raw_probability?: number;
  confidence_tier?: ConfidenceTier | string;
  confidence_category?: ConfidenceTier | string;
  consensus_verified?: boolean;
}

export interface PoissonParameters {
  home_attack_str: number;
  away_attack_str: number;
  home_defense_str: number;
  away_defense_str: number;
  home_boost_pct: number;
  xg_home: number;
  xg_away: number;
}

export interface GoalsDimension {
  top_market: string;
  top_prob: number;
  over_1_5_prob: number;
  over_2_5_prob: number;
  xg_home: number;
  xg_away: number;
  xg_summary: string;
}

export interface MoneylineDimension {
  top_pick: string;
  top_prob: number;
  home_win_prob: number;
  draw_prob: number;
  away_win_prob: number;
  home_team?: string;
  away_team?: string;
}

export interface CornersDimension {
  top_market: string;
  top_prob: number;
  over_8_5_prob: number;
  over_9_5_prob: number;
  corners_avg?: number;
}

export interface BttsDimension {
  top_market: string;
  top_prob: number;
  gg_yes_prob: number;
  gg_no_prob: number;
}

export interface AnytimeScorerDimension {
  home_scorer: string;
  home_scorer_prob: number;
  away_scorer: string;
  away_scorer_prob: number;
}

export interface SimulationOutlines {
  goals: GoalsDimension;
  moneyline: MoneylineDimension;
  corners: CornersDimension;
  btts: BttsDimension;
  anytime_scorer: AnytimeScorerDimension;
}

export interface FootballPrediction {
  id: string;
  fixture_id: string;
  simulation_id?: string;
  simulation_run_id?: string;
  simulations_count?: number;
  market: string;
  prediction: string | null;
  probability: number | null;
  confidence_category: ConfidenceTier;
  publication_status: string;
  tier_required: string;
  source_data_version: string;
  is_locked?: boolean;
  settlement_status?: 'pending' | 'won' | 'lost' | 'void' | 'voided' | 'conflict';
  settled_at?: string | null;
  settlement_notes?: string | null;
  actual_score?: string | null;
  secondary_predictions?: SecondaryPrediction[];
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
    secondary_count?: number;
    ai_summary?: string;
    poisson_parameters?: PoissonParameters;
    simulation_outlines?: SimulationOutlines;
    [key: string]: any;
  };
  target_kickoff_at: string;
  created_at: string;
}

export interface SettlementRecord {
  id: string;
  fixture_id: string;
  prediction_id: string;
  market_type: string;
  target_value: string;
  status: 'pending' | 'won' | 'lost' | 'void' | 'voided' | 'conflict';
  settlement_reason?: string;
  source_confirmation_count: number;
  sources_verified: string[];
  settled_at: string;
}

export interface SettlementJob {
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
    fixtures_inspected?: number;
    fixtures_live?: number;
    fixtures_finished?: number;
    predictions_inspected?: number;
    predictions_settled?: number;
    settled_won?: number;
    settled_lost?: number;
    settled_void?: number;
    predictions_pending?: number;
    conflicts_detected?: number;
    errors_count?: number;
  };
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

export type SubscriptionTier = 'visitor' | 'free' | 'standard' | 'bigbang' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  display_name?: string;
  role: 'free' | 'standard' | 'bigbang' | 'admin';
  disclaimer_age_accepted: boolean;
  disclaimer_age_accepted_at?: string;
  disclaimer_financial_accepted: boolean;
  disclaimer_financial_accepted_at?: string;
  disclaimer_version?: string;
  is_deleted?: boolean;
  status?: 'active' | 'disabled' | 'suspended';
  deleted_at?: string;
  created_at: string;
}

export interface UserSubscription {
  id: string;
  user_id: string;
  tier: 'free' | 'standard' | 'bigbang';
  status: 'active' | 'cancelled' | 'expired';
  starts_at: string;
  expires_at?: string;
}

export interface UserEntitlement {
  id: string;
  user_id: string;
  tier: 'free' | 'standard' | 'bigbang';
  can_view_predictions: boolean;
  can_view_detailed_stats: boolean;
  can_view_simulation_breakdown: boolean;
  expires_at?: string;
}

export interface PredictionTeaser {
  id: string;
  fixture_id: string;
  market: string;
  confidence_category: ConfidenceTier;
  publication_status: string;
  secondary_predictions?: SecondaryPrediction[];
  target_kickoff_at: string;
  is_locked: boolean;
}

export interface LeagueRecord {
  id: string;
  name: string;
  code: string;
  country: string;
  is_active?: boolean;
  priority?: number;
  tier?: string;
}

export interface TierPerformanceMetrics {
  total_decided: number;
  won: number;
  lost: number;
  pending: number;
  voided: number;
  conflict: number;
  win_rate_pct: number;
}

export interface DailyPerformanceRecord {
  date: string;
  decided: number;
  won: number;
  lost: number;
  pending: number;
  voided: number;
  win_rate_pct: number;
  loss_rate_pct: number;
}

export interface PlatformAnalytics {
  total_eligible_published: number;
  total_decided: number;
  total_won: number;
  total_lost: number;
  total_pending: number;
  total_voided: number;
  total_conflict: number;
  overall_win_rate_pct: number;
  overall_loss_rate_pct: number;
  tier_performance: {
    banger: TierPerformanceMetrics;
    top_pick: TierPerformanceMetrics;
    high_confidence: TierPerformanceMetrics;
    mid_confidence: TierPerformanceMetrics;
    low_confidence: TierPerformanceMetrics;
    risky: TierPerformanceMetrics;
  };
  daily_performance: DailyPerformanceRecord[];
  treatment_rules: {
    pending: string;
    voided_cancelled: string;
    conflicts: string;
  };
  computed_at: string;
}

export interface SourceHealth {
  source_name: string;
  status: 'active' | 'error' | 'warning';
  error_count: number;
  last_checked: string | null;
}

export interface SystemHealthStatus {
  scrapers: {
    status: 'healthy' | 'degraded' | 'error';
    stale_fixtures_count: number;
    last_sync_timestamp: string | null;
  };
  sources: SourceHealth[];
  phase6_scheduler: {
    status: string;
    job_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    metadata: Record<string, any> | null;
  };
  phase7_settlement: {
    status: string;
    job_id: string | null;
    started_at: string | null;
    completed_at: string | null;
    error_message: string | null;
    metadata: Record<string, any> | null;
  };
  conflicts: {
    active_conflicts_count: number;
    conflicts_list: any[];
  };
  stale_data: {
    stale_live_fixtures: number;
    stale_fixtures_sample: any[];
  };
  simulation_integrity: {
    incomplete_simulations_count: number;
    incomplete_list: any[];
  };
  settlement_failures: {
    failed_settlements_count: number;
    failures_list: any[];
  };
  evaluated_at: string;
}

export interface AuditRecord {
  id: string;
  actor_id: string | null;
  actor_email?: string | null;
  actor_role?: string | null;
  action: string;
  affected_table: string;
  affected_record_id: string | null;
  previous_state: any;
  new_state: any;
  reason: string;
  ip_address?: string | null;
  user_agent?: string | null;
  created_at: string;
}
