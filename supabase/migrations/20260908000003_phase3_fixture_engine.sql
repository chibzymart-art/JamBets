-- JamBets Phase 3: Football Fixture Engine & Four-Day Queue
-- Extends football_fixtures with canonical key, prediction queue gating, and lifecycle timestamps.
-- Creates football_prediction_queue view with public read RLS policies.

-- 1. Add columns to football_fixtures if they do not exist
ALTER TABLE public.football_fixtures
  ADD COLUMN IF NOT EXISTS canonical_key TEXT,
  ADD COLUMN IF NOT EXISTS in_prediction_queue BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS queue_day INTEGER,
  ADD COLUMN IF NOT EXISTS postponed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Add unique constraint on canonical_key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'football_fixtures_canonical_key_key'
  ) THEN
    -- If there are duplicates currently, keep the latest one before adding constraint
    DELETE FROM public.football_fixtures a
    WHERE a.canonical_key IS NOT NULL
      AND a.ctid <> (
        SELECT max(b.ctid)
        FROM public.football_fixtures b
        WHERE b.canonical_key = a.canonical_key
      );
    ALTER TABLE public.football_fixtures ADD CONSTRAINT football_fixtures_canonical_key_key UNIQUE (canonical_key);
  END IF;
END $$;

-- 3. Add check constraints for queue_day and queue status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_queue_day_window'
  ) THEN
    ALTER TABLE public.football_fixtures
      ADD CONSTRAINT check_queue_day_window
      CHECK (queue_day IS NULL OR (queue_day >= 0 AND queue_day <= 4));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_queue_eligibility'
  ) THEN
    ALTER TABLE public.football_fixtures
      ADD CONSTRAINT check_queue_eligibility
      CHECK (in_prediction_queue = false OR (status = 'scheduled' AND queue_day IS NOT NULL));
  END IF;
END $$;

-- 4. Create or replace the public football_prediction_queue view
CREATE OR REPLACE VIEW public.football_prediction_queue AS
SELECT
  f.id,
  f.canonical_key,
  f.target_kickoff_at,
  f.status,
  f.queue_day,
  f.in_prediction_queue,
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
  AND f.status = 'scheduled'
ORDER BY f.target_kickoff_at ASC;

-- 5. Grant access on view to anon and authenticated
GRANT SELECT ON public.football_prediction_queue TO anon, authenticated;
