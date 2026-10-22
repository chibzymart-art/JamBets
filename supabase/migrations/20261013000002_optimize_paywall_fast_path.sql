-- =====================================================================
-- Migration: 20261013000002_optimize_paywall_fast_path.sql
-- Optimizes public.is_admin() and public.is_paid_subscriber() with
-- ultra-fast guard clauses for anonymous visitors and service_role.
-- Eliminates table subquery amplification across paywall views.
-- =====================================================================

-- 1. Optimized public.is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    -- Fast-path 1: Service role key has full admin bypass
    IF (auth.jwt() ->> 'role') = 'service_role' THEN
        RETURN true;
    END IF;

    -- Fast-path 2: Anonymous visitor without credentials is never admin
    IF auth.uid() IS NULL AND (auth.jwt() ->> 'email') IS NULL THEN
        RETURN false;
    END IF;

    -- Fast-path 3: Hardcoded primary administrator email whitelist
    IF LOWER(auth.jwt() ->> 'email') IN (
        'chibzymart@gmail.com',
        'whizzchibz@gmail.com',
        'chibuezec.amuchie@gmail.com',
        'nnamdiamuchie@gmail.com'
    ) THEN
        RETURN true;
    END IF;

    -- Check 4: server-controlled app_metadata role = 'admin'.
    -- (user_metadata is writable by the user, so it must never grant admin. Fixed 22 Oct 2026.)
    IF (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
        RETURN true;
    END IF;

    -- Check 5: User record in public.users has role = 'admin'
    IF EXISTS (
        SELECT 1 FROM public.users
        WHERE (id = auth.uid() OR LOWER(email) = LOWER(auth.jwt() ->> 'email'))
          AND role = 'admin'
    ) THEN
        RETURN true;
    END IF;

    -- Check 6: Active entitlement tier = 'admin' or features ->> 'admin' = true
    IF EXISTS (
        SELECT 1 FROM public.entitlements
        WHERE (user_id = auth.uid())
          AND (tier = 'admin' OR (features ->> 'admin')::boolean = true)
    ) THEN
        RETURN true;
    END IF;

    -- Check 7: Active subscription tier = 'admin'
    IF EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE (user_id = auth.uid())
          AND tier = 'admin'
          AND status = 'active'
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 2. Optimized public.is_paid_subscriber()
CREATE OR REPLACE FUNCTION public.is_paid_subscriber()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    -- Fast-path 1: Service role always has access
    IF (auth.jwt() ->> 'role') = 'service_role' THEN
        RETURN true;
    END IF;

    -- Fast-path 2: Anonymous visitor without credentials is never paid subscriber
    IF auth.uid() IS NULL AND (auth.jwt() ->> 'email') IS NULL THEN
        RETURN false;
    END IF;

    -- Fast-path 3: Administrators automatically have full subscriber access
    IF public.is_admin() THEN
        RETURN true;
    END IF;

    -- Check 4: Active entitlement
    IF EXISTS (
        SELECT 1
        FROM public.entitlements e
        WHERE e.user_id = auth.uid()
          AND (e.tier IN ('standard', 'bigbang', 'pro', 'premium', 'admin') OR (e.features ->> 'admin')::boolean = true)
          AND (e.valid_until IS NULL OR e.valid_until > now())
    ) THEN
        RETURN true;
    END IF;

    -- Check 5: Active subscription
    IF EXISTS (
        SELECT 1
        FROM public.subscriptions s
        WHERE s.user_id = auth.uid()
          AND s.status = 'active'
          AND s.tier IN ('standard', 'bigbang', 'pro', 'premium', 'admin')
          AND (s.current_period_end IS NULL OR s.current_period_end > now())
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_paid_subscriber() TO anon, authenticated, service_role;
