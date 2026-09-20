-- Migration: 20260920000001_harden_is_admin_privilege_escalation.sql
-- Description: Patch client-side privilege escalation by removing user_metadata role check.
-- user_metadata is client-writable via supabase.auth.updateUser().
-- Only app_metadata, public.users table, public.entitlements, and hardcoded email whitelist are permitted.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    -- Check 1: Direct Service Role Key bypass
    IF (auth.jwt() ->> 'role') = 'service_role' THEN
        RETURN true;
    END IF;

    -- Check 2: Server-governed app_metadata role claim ONLY (client cannot write app_metadata)
    IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
        RETURN true;
    END IF;

    -- Check 3: Hardcoded primary administrator accounts whitelist (Zero DB lookup, zero recursion)
    IF LOWER(COALESCE(auth.jwt() ->> 'email', '')) IN (
        'chibzymart@gmail.com',
        'whizzchibz@gmail.com',
        'chibuezec.amuchie@gmail.com',
        'chibuezeamuchie@gmail.com',
        'nnamdiamuchie@gmail.com'
    ) THEN
        RETURN true;
    END IF;

    -- Check 4: Check database role in public.users if auth.uid() exists
    IF auth.uid() IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.users
            WHERE id = auth.uid() AND role = 'admin'
        ) THEN
            RETURN true;
        END IF;

        IF EXISTS (
            SELECT 1 FROM public.entitlements
            WHERE user_id = auth.uid() AND (tier = 'admin' OR (features ->> 'admin')::boolean = true)
        ) THEN
            RETURN true;
        END IF;
    END IF;

    RETURN false;
END;
$$;
