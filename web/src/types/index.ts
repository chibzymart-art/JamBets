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
