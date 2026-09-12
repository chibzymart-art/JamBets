-- =====================================================================
-- JamBets — Security Hardening & RLS Lockdown Migration
-- 1. Fix admin_tasks public insert/update vulnerability
-- 2. Drop legacy permissive policies on football_predictions
-- 3. Lock down pending predictions to prevent paywall bypass
-- =====================================================================

-- 1. Lock down admin_tasks table
ALTER TABLE public.admin_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_tasks_public_read" ON public.admin_tasks;
DROP POLICY IF EXISTS "admin_tasks_public_insert" ON public.admin_tasks;
DROP POLICY IF EXISTS "admin_tasks_public_update" ON public.admin_tasks;
DROP POLICY IF EXISTS "admin_tasks_admin_all" ON public.admin_tasks;

CREATE POLICY "admin_tasks_admin_all" ON public.admin_tasks
FOR ALL
TO authenticated, service_role
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 2. Drop all legacy permissive policies on football_predictions
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_predictions" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_read_policy" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_entitled_read_policy" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_paywall_read_policy" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_admin_all_access_policy" ON public.football_predictions;

-- Grant full access to admins and service_role
CREATE POLICY "predictions_admin_all_access_policy" ON public.football_predictions
FOR ALL
TO authenticated, service_role
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Allow public read of predictions ONLY if published AND (already settled OR user is paid subscriber)
CREATE POLICY "predictions_paywall_read_policy" ON public.football_predictions
FOR SELECT
TO authenticated, anon
USING (
    publication_status = 'published'
    AND (
        settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled')
        OR public.is_paid_subscriber()
    )
);

-- Revoke any direct public writes to football_predictions
DROP POLICY IF EXISTS "predictions_public_write" ON public.football_predictions;
