-- =====================================================================
-- JamBets — Security Hardening: Restrict Audit Logs Access
-- Drops permissive public read policy and restricts SELECT to verified admins.
-- =====================================================================

-- 1. Drop the legacy permissive public read policy
DROP POLICY IF EXISTS "Public read audit_logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Public read access" ON public.audit_logs;
DROP POLICY IF EXISTS "Allow public read audit_logs" ON public.audit_logs;

-- 2. Ensure RLS is enabled on audit_logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 3. Create Admin-only SELECT policy
CREATE POLICY "Admin read audit_logs" ON public.audit_logs
FOR SELECT
TO authenticated, service_role
USING (public.is_admin());

-- 4. Ensure service_role and admins can insert audit logs
DROP POLICY IF EXISTS "Service role insert audit_logs" ON public.audit_logs;
CREATE POLICY "Service role insert audit_logs" ON public.audit_logs
FOR INSERT
TO authenticated, service_role
WITH CHECK (true);
