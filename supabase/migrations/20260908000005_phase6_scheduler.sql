-- JamBets Phase 6: Automatic 6-Hour Scheduler Schema Extension
-- Adds idempotency_key, metadata, and items counters to system_jobs,
-- ensures indexes, and grants public read policies for scheduler observability.

-- 1. Extend system_jobs columns
ALTER TABLE public.system_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS items_processed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_failed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Ensure system_jobs indexes
CREATE INDEX IF NOT EXISTS idx_system_jobs_idempotency ON public.system_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_system_jobs_type_status ON public.system_jobs(job_type, status);

-- 3. Extend audit_logs columns
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_type TEXT,
  ADD COLUMN IF NOT EXISTS actor_id TEXT,
  ADD COLUMN IF NOT EXISTS resource_type TEXT,
  ADD COLUMN IF NOT EXISTS resource_id TEXT,
  ADD COLUMN IF NOT EXISTS details JSONB DEFAULT '{}'::jsonb;

-- 4. Enable RLS and public read policies for scheduler observability
ALTER TABLE public.system_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read system_jobs" ON public.system_jobs;
CREATE POLICY "Public read system_jobs"
  ON public.system_jobs
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read audit_logs" ON public.audit_logs;
CREATE POLICY "Public read audit_logs"
  ON public.audit_logs
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.system_jobs TO anon, authenticated;
GRANT SELECT ON public.audit_logs TO anon, authenticated;
