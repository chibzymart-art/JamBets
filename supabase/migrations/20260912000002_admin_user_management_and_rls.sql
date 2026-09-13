-- =====================================================================
-- JamBets — Admin User Management, Tier Allocation & Payments RLS
-- Unlocks full user visibility, tier management, account controls, and
-- payment transaction audits for administrators.
-- =====================================================================

-- 1. Extend payments table with flexible provider and metadata tracking
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe',
    ADD COLUMN IF NOT EXISTS reference TEXT,
    ADD COLUMN IF NOT EXISTS customer_email TEXT,
    ADD COLUMN IF NOT EXISTS plan_name TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

-- 2. Grant Full Admin Access on public.users
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select_own" ON public.users;
DROP POLICY IF EXISTS "users_update_own" ON public.users;
DROP POLICY IF EXISTS "users_admin_select_all" ON public.users;
DROP POLICY IF EXISTS "users_admin_update_all" ON public.users;
DROP POLICY IF EXISTS "users_admin_delete_all" ON public.users;
DROP POLICY IF EXISTS "users_select_policy" ON public.users;
DROP POLICY IF EXISTS "users_update_policy" ON public.users;
DROP POLICY IF EXISTS "users_delete_policy" ON public.users;

CREATE POLICY "users_select_policy" ON public.users
    FOR SELECT TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = id);

CREATE POLICY "users_update_policy" ON public.users
    FOR UPDATE TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = id)
    WITH CHECK (public.is_admin() OR auth.uid() = id);

CREATE POLICY "users_delete_policy" ON public.users
    FOR DELETE TO authenticated, service_role
    USING (public.is_admin());

-- 3. Grant Full Admin Access on public.subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_all" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_all_policy" ON public.subscriptions;

CREATE POLICY "subscriptions_all_policy" ON public.subscriptions
    FOR ALL TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id)
    WITH CHECK (public.is_admin() OR auth.uid() = user_id);

-- 4. Grant Full Admin Access on public.entitlements
ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entitlements_select_own" ON public.entitlements;
DROP POLICY IF EXISTS "entitlements_admin_all" ON public.entitlements;
DROP POLICY IF EXISTS "entitlements_all_policy" ON public.entitlements;

CREATE POLICY "entitlements_all_policy" ON public.entitlements
    FOR ALL TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id)
    WITH CHECK (public.is_admin() OR auth.uid() = user_id);

-- 5. Grant Full Admin Access on public.payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_all" ON public.payments;
DROP POLICY IF EXISTS "payments_all_policy" ON public.payments;

CREATE POLICY "payments_all_policy" ON public.payments
    FOR ALL TO authenticated, service_role
    USING (public.is_admin() OR auth.uid() = user_id)
    WITH CHECK (public.is_admin() OR auth.uid() = user_id);

-- 6. Atomic Stored Procedure: admin_manage_user_tier
-- Atomically updates user role, entitlement features, subscription status & valid_until
CREATE OR REPLACE FUNCTION public.admin_manage_user_tier(
    p_target_user_id UUID,
    p_new_tier TEXT,
    p_status TEXT DEFAULT 'active',
    p_valid_until TIMESTAMPTZ DEFAULT NULL,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_email TEXT;
    v_admin_email TEXT;
    v_features JSONB;
BEGIN
    -- Verify caller is an administrator
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only administrators can allocate user tiers and subscription status.';
    END IF;

    -- Validate target tier
    IF p_new_tier NOT IN ('free', 'standard', 'bigbang', 'admin') THEN
        RAISE EXCEPTION 'Invalid tier: %. Must be free, standard, bigbang, or admin.', p_new_tier;
    END IF;

    -- Fetch target user email
    SELECT email INTO v_target_email FROM public.users WHERE id = p_target_user_id;
    IF v_target_email IS NULL THEN
        RAISE EXCEPTION 'Target user does not exist.';
    END IF;

    v_admin_email := auth.jwt() ->> 'email';

    -- Determine features based on tier
    v_features := CASE
        WHEN p_new_tier = 'bigbang' THEN '{"football_predictions": true, "simulations": true, "vip": true}'::jsonb
        WHEN p_new_tier = 'standard' THEN '{"football_predictions": true, "simulations": false}'::jsonb
        WHEN p_new_tier = 'admin' THEN '{"football_predictions": true, "simulations": true, "vip": true, "admin": true}'::jsonb
        ELSE '{"football_predictions": false, "simulations": false}'::jsonb
    END;

    -- 1. Update public.users
    UPDATE public.users
    SET role = p_new_tier,
        status = p_status,
        is_deleted = (p_status = 'disabled'),
        updated_at = now()
    WHERE id = p_target_user_id;

    -- 2. Upsert public.entitlements
    INSERT INTO public.entitlements (user_id, tier, features, valid_until, updated_at)
    VALUES (p_target_user_id, p_new_tier, v_features, p_valid_until, now())
    ON CONFLICT (user_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        features = EXCLUDED.features,
        valid_until = EXCLUDED.valid_until,
        updated_at = now();

    -- 3. Upsert public.subscriptions
    INSERT INTO public.subscriptions (user_id, tier, status, current_period_end, updated_at)
    VALUES (p_target_user_id, p_new_tier, p_status, p_valid_until, now())
    ON CONFLICT (user_id) DO UPDATE
    SET tier = EXCLUDED.tier,
        status = EXCLUDED.status,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = now();

    -- 4. Record in audit_logs
    INSERT INTO public.audit_logs (
        actor_type,
        actor_id,
        actor_email,
        actor_role,
        action,
        resource_type,
        resource_id,
        details
    ) VALUES (
        'admin',
        auth.uid()::text,
        v_admin_email,
        'admin',
        'admin_user_tier_allocated',
        'users',
        p_target_user_id::text,
        jsonb_build_object(
            'target_email', v_target_email,
            'allocated_tier', p_new_tier,
            'status', p_status,
            'valid_until', p_valid_until,
            'reason', COALESCE(p_reason, 'Admin dashboard allocation')
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_target_user_id,
        'email', v_target_email,
        'tier', p_new_tier,
        'status', p_status,
        'valid_until', p_valid_until
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_manage_user_tier TO authenticated, service_role;

-- 7. Stored Procedure: admin_record_manual_payment
-- Allows admins to log offline, bank transfer, Paystack or Flutterwave payments
CREATE OR REPLACE FUNCTION public.admin_record_manual_payment(
    p_target_user_id UUID,
    p_amount_cents INTEGER,
    p_currency TEXT DEFAULT 'ngn',
    p_plan_name TEXT DEFAULT 'Standard VIP Monthly (₦5,000)',
    p_provider TEXT DEFAULT 'manual_bank_transfer',
    p_reference TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_payment_id UUID;
    v_target_email TEXT;
BEGIN
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access Denied: Only administrators can record manual payments.';
    END IF;

    SELECT email INTO v_target_email FROM public.users WHERE id = p_target_user_id;
    IF v_target_email IS NULL THEN
        RAISE EXCEPTION 'Target user not found.';
    END IF;

    INSERT INTO public.payments (
        user_id,
        amount_cents,
        currency,
        status,
        provider,
        reference,
        customer_email,
        plan_name,
        metadata
    ) VALUES (
        p_target_user_id,
        p_amount_cents,
        LOWER(p_currency),
        'succeeded',
        p_provider,
        COALESCE(p_reference, 'MANUAL-' || upper(substr(gen_random_uuid()::text, 1, 8))),
        v_target_email,
        p_plan_name,
        jsonb_build_object('recorded_by', auth.jwt() ->> 'email', 'notes', p_notes)
    ) RETURNING id INTO v_payment_id;

    -- Record in audit_logs
    INSERT INTO public.audit_logs (
        actor_type, actor_id, actor_email, actor_role, action, resource_type, resource_id, details
    ) VALUES (
        'admin', auth.uid()::text, auth.jwt() ->> 'email', 'admin', 'admin_recorded_payment', 'payments', v_payment_id::text,
        jsonb_build_object('user_id', p_target_user_id, 'amount', p_amount_cents, 'currency', p_currency, 'plan', p_plan_name)
    );

    RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_record_manual_payment TO authenticated, service_role;
