-- =====================================================================
-- JamBets — Phase 8: Authentication, Users & Subscription Access
-- Authoritative Schema Extension & RLS Access Control
-- =====================================================================

-- 1. Extend public.users with disclaimer tracking and tier support
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS disclaimer_age_accepted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS disclaimer_age_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS disclaimer_financial_accepted BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS disclaimer_financial_accepted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS disclaimer_version TEXT DEFAULT 'v1.0';

-- Update check constraint on role to support standard and bigbang tiers
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('free', 'standard', 'bigbang', 'pro', 'premium', 'admin'));

-- Update check constraint on subscriptions.tier
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check;
ALTER TABLE public.subscriptions
    ADD CONSTRAINT subscriptions_tier_check
    CHECK (tier IN ('free', 'standard', 'bigbang', 'pro', 'premium'));

-- Update check constraint on entitlements.tier
ALTER TABLE public.entitlements DROP CONSTRAINT IF EXISTS entitlements_tier_check;
ALTER TABLE public.entitlements
    ADD CONSTRAINT entitlements_tier_check
    CHECK (tier IN ('free', 'standard', 'bigbang', 'pro', 'premium'));

-- 2. Server-Side Mandatory Disclaimer Enforcement Trigger on auth.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_age_accepted BOOLEAN;
    v_fin_accepted BOOLEAN;
    v_version TEXT;
    v_display_name TEXT;
BEGIN
    -- Extract disclaimer metadata passed during auth.signUp
    v_age_accepted := COALESCE((NEW.raw_user_meta_data->>'disclaimer_age_accepted')::boolean, false);
    v_fin_accepted := COALESCE((NEW.raw_user_meta_data->>'disclaimer_financial_accepted')::boolean, false);
    v_version := COALESCE(NEW.raw_user_meta_data->>'disclaimer_version', 'v1.0');
    v_display_name := COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1));

    -- Strict Server-Side Validation: BOTH disclaimers MUST be explicitly accepted
    IF NOT (v_age_accepted AND v_fin_accepted) THEN
        RAISE EXCEPTION 'Registration rejected: Both age confirmation and financial risk indemnity disclaimers must be accepted.';
    END IF;

    -- Insert into public.users with disclaimer evidence
    INSERT INTO public.users (
        id,
        email,
        display_name,
        role,
        disclaimer_age_accepted,
        disclaimer_age_accepted_at,
        disclaimer_financial_accepted,
        disclaimer_financial_accepted_at,
        disclaimer_version,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        NEW.email,
        v_display_name,
        'free',
        true,
        now(),
        true,
        now(),
        v_version,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        display_name = EXCLUDED.display_name,
        disclaimer_age_accepted = EXCLUDED.disclaimer_age_accepted,
        disclaimer_age_accepted_at = EXCLUDED.disclaimer_age_accepted_at,
        disclaimer_financial_accepted = EXCLUDED.disclaimer_financial_accepted,
        disclaimer_financial_accepted_at = EXCLUDED.disclaimer_financial_accepted_at,
        disclaimer_version = EXCLUDED.disclaimer_version,
        updated_at = now();

    -- Provision default free entitlement
    INSERT INTO public.entitlements (
        user_id,
        tier,
        features,
        valid_until,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        'free',
        '{"football_predictions": false, "simulations": false}'::jsonb,
        NULL,
        now(),
        now()
    )
    ON CONFLICT (user_id) DO NOTHING;

    -- Insert initial free subscription record
    INSERT INTO public.subscriptions (
        user_id,
        tier,
        status,
        created_at,
        updated_at
    ) VALUES (
        NEW.id,
        'free',
        'active',
        now(),
        now()
    );

    -- Record registration audit log
    INSERT INTO public.audit_logs (
        actor_type,
        actor_id,
        action,
        resource_type,
        resource_id,
        details
    ) VALUES (
        'user',
        NEW.id::text,
        'user_registered_disclaimers_accepted',
        'users',
        NEW.id::text,
        jsonb_build_object(
            'email', NEW.email,
            'disclaimer_version', v_version,
            'disclaimer_age_accepted', true,
            'disclaimer_financial_accepted', true,
            'initial_tier', 'free'
        )
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Secure Subscription Tier Switcher RPC (User Isolation)
CREATE OR REPLACE FUNCTION public.upgrade_subscription_tier(target_tier TEXT)
RETURNS jsonb AS $$
DECLARE
    v_uid UUID;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF target_tier NOT IN ('free', 'standard', 'bigbang') THEN
        RAISE EXCEPTION 'Invalid tier: %', target_tier;
    END IF;

    -- Update entitlement
    UPDATE public.entitlements
    SET tier = target_tier,
        features = CASE
            WHEN target_tier = 'bigbang' THEN '{"football_predictions": true, "simulations": true, "vip": true}'::jsonb
            WHEN target_tier = 'standard' THEN '{"football_predictions": true, "simulations": false}'::jsonb
            ELSE '{"football_predictions": false, "simulations": false}'::jsonb
        END,
        updated_at = now()
    WHERE user_id = v_uid;

    -- Update subscription
    UPDATE public.subscriptions
    SET tier = target_tier,
        status = 'active',
        updated_at = now()
    WHERE user_id = v_uid;

    -- Update role in users table (keeping admin separate)
    UPDATE public.users
    SET role = target_tier,
        updated_at = now()
    WHERE id = v_uid AND role != 'admin';

    -- Record audit log
    INSERT INTO public.audit_logs (
        actor_type, actor_id, action, resource_type, resource_id, details
    ) VALUES (
        'user', v_uid::text, 'subscription_tier_updated', 'subscriptions', v_uid::text,
        jsonb_build_object('tier', target_tier, 'note', 'Phase 8 entitlement update')
    );

    RETURN jsonb_build_object('success', true, 'tier', target_tier);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.upgrade_subscription_tier TO authenticated;

-- 4. Secure Public Teaser View for Locked Prediction Cards
CREATE OR REPLACE VIEW public.football_prediction_teasers AS
SELECT
    p.id,
    p.fixture_id,
    p.market,
    p.confidence_category,
    p.publication_status,
    p.target_kickoff_at,
    p.created_at,
    true AS is_locked
FROM public.football_predictions p
WHERE p.publication_status = 'published';

GRANT SELECT ON public.football_prediction_teasers TO anon, authenticated;

-- 5. Strict Row-Level Security: Gate Predictions by Standard / BigBang Entitlement or Admin
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read football_predictions" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_read_policy" ON public.football_predictions;
DROP POLICY IF EXISTS "predictions_entitled_read_policy" ON public.football_predictions;

CREATE POLICY "predictions_entitled_read_policy" ON public.football_predictions
FOR SELECT
TO authenticated
USING (
    publication_status = 'published'
    AND (
        -- Admins can read all predictions
        EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = auth.uid() AND u.role = 'admin'
        )
        -- Standard and BigBang subscribers can read predictions
        OR EXISTS (
            SELECT 1 FROM public.entitlements e
            WHERE e.user_id = auth.uid()
            AND e.tier IN ('standard', 'bigbang', 'pro', 'premium')
            AND (e.valid_until IS NULL OR e.valid_until > now())
        )
    )
);

-- Ensure users can read their own profile, subscriptions, and entitlements
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "users_select_own" ON public.users;
CREATE POLICY "users_select_own" ON public.users
    FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own" ON public.users
    FOR UPDATE TO authenticated USING (auth.uid() = id);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

ALTER TABLE public.entitlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "entitlements_select_own" ON public.entitlements;
CREATE POLICY "entitlements_select_own" ON public.entitlements
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

GRANT SELECT, UPDATE ON public.users TO authenticated;
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT SELECT ON public.entitlements TO authenticated;
