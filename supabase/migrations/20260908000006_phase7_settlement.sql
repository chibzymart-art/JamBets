-- JamBets Phase 7: Automatic 15-Minute Live Data + Result Settlement Engine Schema Extension
-- Adds live score and period tracking to football_fixtures, extends football_predictions with settlement status,
-- adjusts football_settlements status constraint, and grants public read policies.

-- 1. Extend football_fixtures with live monitoring columns
ALTER TABLE public.football_fixtures
  ADD COLUMN IF NOT EXISTS home_score INTEGER,
  ADD COLUMN IF NOT EXISTS away_score INTEGER,
  ADD COLUMN IF NOT EXISTS match_minute INTEGER,
  ADD COLUMN IF NOT EXISTS period TEXT,
  ADD COLUMN IF NOT EXISTS half_time_home_score INTEGER,
  ADD COLUMN IF NOT EXISTS half_time_away_score INTEGER,
  ADD COLUMN IF NOT EXISTS corners_home INTEGER,
  ADD COLUMN IF NOT EXISTS corners_away INTEGER,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

-- 2. Extend football_predictions with direct settlement attributes for fast indexing
ALTER TABLE public.football_predictions
  ADD COLUMN IF NOT EXISTS settlement_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_notes TEXT,
  ADD COLUMN IF NOT EXISTS actual_score TEXT;

-- Update check constraint on football_predictions.settlement_status
ALTER TABLE public.football_predictions
  DROP CONSTRAINT IF EXISTS football_predictions_settlement_status_check;

ALTER TABLE public.football_predictions
  ADD CONSTRAINT football_predictions_settlement_status_check
  CHECK (settlement_status IN ('pending', 'won', 'lost', 'void', 'voided', 'conflict'));

CREATE INDEX IF NOT EXISTS idx_predictions_settlement_status ON public.football_predictions(settlement_status);
CREATE INDEX IF NOT EXISTS idx_predictions_fixture_settlement ON public.football_predictions(fixture_id, settlement_status);

-- 3. Adjust status check constraint on football_settlements to support 'void'
ALTER TABLE public.football_settlements
  DROP CONSTRAINT IF EXISTS football_settlements_status_check;

ALTER TABLE public.football_settlements
  ADD CONSTRAINT football_settlements_status_check
  CHECK (status IN ('pending', 'won', 'lost', 'void', 'voided', 'conflict', 'verification_required'));

-- 4. Adjust check_queue_eligibility constraint on football_fixtures to allow live/finished queued fixtures
ALTER TABLE public.football_fixtures
  DROP CONSTRAINT IF EXISTS check_queue_eligibility;

ALTER TABLE public.football_fixtures
  ADD CONSTRAINT check_queue_eligibility
  CHECK (in_prediction_queue = false OR (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled') AND queue_day IS NOT NULL));

-- 5. Update football_prediction_queue view to include live match state and support all queue statuses
CREATE OR REPLACE VIEW public.football_prediction_queue AS
SELECT
  f.id,
  f.canonical_key,
  f.target_kickoff_at,
  f.status,
  f.queue_day,
  f.in_prediction_queue,
  f.home_score,
  f.away_score,
  f.match_minute,
  f.period,
  f.half_time_home_score,
  f.half_time_away_score,
  f.corners_home,
  f.corners_away,
  f.last_synced_at,
  f.postponed_at,
  f.cancelled_at,
  f.created_at,
  f.updated_at,
  l.id AS league_id,
  l.name AS league_name,
  l.code AS league_code,
  l.country AS league_country,
  ht.id AS home_team_id,
  ht.name AS home_team_name,
  at.id AS away_team_id,
  at.name AS away_team_name
FROM public.football_fixtures f
JOIN public.football_leagues l ON f.league_id = l.id
JOIN public.football_teams ht ON f.home_team_id = ht.id
JOIN public.football_teams at ON f.away_team_id = at.id
WHERE f.in_prediction_queue = true
ORDER BY f.target_kickoff_at ASC;

-- 6. Enable RLS and public read policies on settlement and live tables
ALTER TABLE public.football_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_settlements" ON public.football_settlements;
CREATE POLICY "Public read football_settlements"
  ON public.football_settlements
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_results" ON public.football_results;
CREATE POLICY "Public read football_results"
  ON public.football_results
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.football_live_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_live_events" ON public.football_live_events;
CREATE POLICY "Public read football_live_events"
  ON public.football_live_events
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.football_settlements TO anon, authenticated;
GRANT SELECT ON public.football_results TO anon, authenticated;
GRANT SELECT ON public.football_live_events TO anon, authenticated;
GRANT SELECT ON public.football_prediction_queue TO anon, authenticated;

