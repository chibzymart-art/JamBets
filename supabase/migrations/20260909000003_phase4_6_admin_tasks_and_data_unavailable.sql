-- ==============================================================================
-- Migration: 20260909000003_phase4_6_admin_tasks_and_data_unavailable.sql
-- JamBets Phase 4.6: Admin Tasks Automation & DATA_UNAVAILABLE Status Support
-- ==============================================================================

-- 1. Create admin_tasks table for orchestrating manual/UI engine overrides
CREATE TABLE IF NOT EXISTS public.admin_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
    metadata JSONB DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS for admin_tasks
ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_tasks_public_read" ON public.admin_tasks;
CREATE POLICY "admin_tasks_public_read" ON public.admin_tasks FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin_tasks_public_insert" ON public.admin_tasks;
CREATE POLICY "admin_tasks_public_insert" ON public.admin_tasks FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "admin_tasks_public_update" ON public.admin_tasks;
CREATE POLICY "admin_tasks_public_update" ON public.admin_tasks FOR UPDATE USING (true) WITH CHECK (true);

-- Index for polling pending tasks quickly
CREATE INDEX IF NOT EXISTS idx_admin_tasks_status_created ON public.admin_tasks(status, created_at ASC);

-- 2. Update status constraint on football_fixtures to support DATA_UNAVAILABLE
ALTER TABLE public.football_fixtures DROP CONSTRAINT IF EXISTS football_fixtures_status_check;
ALTER TABLE public.football_fixtures 
  ADD CONSTRAINT football_fixtures_status_check 
  CHECK (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'interrupted', 'suspended', 'data_unavailable', 'DATA_UNAVAILABLE'));

-- 3. Update queue eligibility check to allow data_unavailable matches in queue history if needed
ALTER TABLE public.football_fixtures DROP CONSTRAINT IF EXISTS check_queue_eligibility;
ALTER TABLE public.football_fixtures 
  ADD CONSTRAINT check_queue_eligibility 
  CHECK (in_prediction_queue = false OR (status IN ('scheduled', 'live', 'finished', 'postponed', 'cancelled', 'data_unavailable', 'DATA_UNAVAILABLE') AND queue_day IS NOT NULL));

-- 4. Enable real-time replication for admin_tasks (optional/safe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'admin_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_tasks;
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
