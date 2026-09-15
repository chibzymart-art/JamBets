-- =====================================================================
-- Oddsbanta / JamBets — Migration: Fix Admin Users RLS & Atomic Admin RPCs
-- Resolves:
-- 1. Circular RLS recursion where public.is_admin() queried public.users
--    during users table scans, causing PostgreSQL to silently exclude all rows.
-- 2. Establishes dedicated, atomic SECURITY DEFINER functions:
--    - public.admin_get_users()
--    - public.admin_get_audit_logs()
--    - public.admin_get_payments()
-- 3. Ensures UNIQUE (user_id) constraint on entitlements and subscriptions
--    so admin_manage_user_tier ON CONFLICT clauses succeed reliably.
-- =====================================================================

-- 1. Ensure unique constraints for ON CONFLICT (user_id) in subscriptions & entitlements
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'entitlements_user_id_key' OR conname = 'entitlements_user_id_unique'
    ) THEN
        BEGIN
            ALTER TABLE public.entitlements ADD CONSTRAINT entitlements_user_id_unique UNIQUE (user_id);
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'Constraint already exists or duplicates present';
        END;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_user_id_key' OR conname = 'subscriptions_user_id_unique'
    ) THEN
        BEGIN
            ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_unique UNIQUE (user_id);
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'Constraint already exists or duplicates present';
        END;
    END IF;
END $$;

-- 2. Non-Recursive, Zero-Table-Access Fast Path for public.is_admin()
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

    -- Check 2: Direct JWT role claims (user_metadata or app_metadata)
    IF (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR
       (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
        RETURN true;
    END IF;

    -- Check 3: Hardcoded primary administrator accounts whitelist (Zero DB lookup, ZERO RECURSION!)
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
    -- (Only reached for non-whitelisted accounts with no JWT claim)
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

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 3. Dedicated Atomic Admin User Aggregator RPC
CREATE OR REPLACE FUNCTION public.admin_get_users()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Verify administrator authorization
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only Oddsbanta administrators can view user profiles.';
    END IF;

    RETURN COALESCE(
        (
            SELECT jsonb_agg(
                jsonb_build_object(
                    'id', u.id,
                    'email', u.email,
                    'display_name', u.display_name,
                    'role', u.role,
                    'is_deleted', u.is_deleted,
                    'status', u.status,
                    'disclaimer_age_accepted', u.disclaimer_age_accepted,
                    'disclaimer_financial_accepted', u.disclaimer_financial_accepted,
                    'created_at', u.created_at,
                    'updated_at', u.updated_at,
                    'subscription', (
                        SELECT jsonb_build_object(
                            'id', s.id,
                            'user_id', s.user_id,
                            'tier', s.tier,
                            'status', s.status,
                            'current_period_end', s.current_period_end,
                            'created_at', s.created_at,
                            'updated_at', s.updated_at
                        )
                        FROM public.subscriptions s
                        WHERE s.user_id = u.id
                        LIMIT 1
                    ),
                    'entitlement', (
                        SELECT jsonb_build_object(
                            'id', e.id,
                            'user_id', e.user_id,
                            'tier', e.tier,
                            'features', e.features,
                            'valid_until', e.valid_until,
                            'updated_at', e.updated_at
                        )
                        FROM public.entitlements e
                        WHERE e.user_id = u.id
                        LIMIT 1
                    )
                )
                ORDER BY u.created_at DESC
            )
            FROM public.users u
        ),
        '[]'::jsonb
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_users() TO authenticated, service_role;

-- 4. Dedicated Atomic Admin Audit Logs RPC
CREATE OR REPLACE FUNCTION public.admin_get_audit_logs(p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only Oddsbanta administrators can view audit logs.';
    END IF;

    RETURN COALESCE(
        (
            SELECT jsonb_agg(row_to_json(a)::jsonb ORDER BY a.created_at DESC)
            FROM (
                SELECT * FROM public.audit_logs
                ORDER BY created_at DESC
                LIMIT p_limit
            ) a
        ),
        '[]'::jsonb
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_audit_logs(INTEGER) TO authenticated, service_role;

-- 5. Dedicated Atomic Admin Payments RPC
CREATE OR REPLACE FUNCTION public.admin_get_payments(p_limit INTEGER DEFAULT 100)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only Oddsbanta administrators can view financial payments.';
    END IF;

    RETURN COALESCE(
        (
            SELECT jsonb_agg(row_to_json(p)::jsonb ORDER BY p.created_at DESC)
            FROM (
                SELECT * FROM public.payments
                ORDER BY created_at DESC
                LIMIT p_limit
            ) p
        ),
        '[]'::jsonb
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_payments(INTEGER) TO authenticated, service_role;

-- 6. Harden RLS policies on public.users, subscriptions, entitlements, payments, audit_logs
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
CREATE POLICY "users_select_policy" ON public.users
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select_policy" ON public.subscriptions;
CREATE POLICY "subscriptions_select_policy" ON public.subscriptions
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id);

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entitlements_select_policy" ON public.entitlements;
CREATE POLICY "entitlements_select_policy" ON public.entitlements
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_select_policy" ON public.payments;
CREATE POLICY "payments_select_policy" ON public.payments
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select" ON public.audit_logs
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin());
