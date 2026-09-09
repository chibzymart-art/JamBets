-- =====================================================================
-- JamBets — Admin Universal Full Access & Override Migration
-- Grants administrators complete, unrestricted visibility and access to
-- EVERY prediction, simulation, fixture, audit log, and system control.
-- =====================================================================

-- 1. Bulletproof Server-Side Admin Detection Function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    -- Check 1: User table role = 'admin'
    IF EXISTS (
        SELECT 1 FROM public.users
        WHERE (id = auth.uid() OR email = (auth.jwt() ->> 'email'))
          AND role = 'admin'
    ) THEN
        RETURN true;
    END IF;

    -- Check 2: Hardcoded primary administrator accounts
    IF (auth.jwt() ->> 'email') IN ('chibzymart@gmail.com', 'whizzchibz@gmail.com') THEN
        RETURN true;
    END IF;

    -- Check 3: JWT user/app metadata role
    IF (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR
       (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
        RETURN true;
    END IF;

    -- Check 4: Service role key bypass
    IF (auth.jwt() ->> 'role') = 'service_role' THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 2. Update is_paid_subscriber() so Admins are automatically verified paid subscribers
CREATE OR REPLACE FUNCTION public.is_paid_subscriber()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_admin(), false) OR COALESCE((
    SELECT true
    FROM public.users u
    WHERE (u.id = auth.uid() OR u.email = (auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  ), (
    SELECT true
    FROM public.entitlements e
    WHERE e.user_id = auth.uid()
      AND e.tier IN ('standard', 'bigbang', 'pro', 'premium', 'admin')
      AND (e.valid_until IS NULL OR e.valid_until > now())
    LIMIT 1
  ), (
    SELECT true
    FROM public.subscriptions s
    WHERE s.user_id = auth.uid()
      AND s.status = 'active'
      AND s.tier IN ('standard', 'bigbang', 'pro', 'premium', 'admin')
    LIMIT 1
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_paid_subscriber() TO anon, authenticated, service_role;

-- 3. Rebuild football_predictions_paywall View with Full Admin Visibility
DROP VIEW IF EXISTS public.football_predictions_paywall;

CREATE OR REPLACE VIEW public.football_predictions_paywall AS
SELECT
    p.id,
    p.fixture_id,
    p.simulation_id,
    p.market,
    CASE
        WHEN public.is_admin() THEN p.prediction
        WHEN public.is_paid_subscriber() THEN p.prediction
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.prediction
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.prediction
        ELSE NULL
    END AS prediction,
    CASE
        WHEN public.is_admin() THEN p.probability
        WHEN public.is_paid_subscriber() THEN p.probability
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.probability
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.probability
        ELSE NULL
    END AS probability,
    CASE
        WHEN public.is_admin() THEN p.secondary_predictions
        WHEN public.is_paid_subscriber() THEN p.secondary_predictions
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.secondary_predictions
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.secondary_predictions
        ELSE NULL
    END AS secondary_predictions,
    CASE
        WHEN public.is_admin() THEN p.confidence_category
        WHEN public.is_paid_subscriber() THEN p.confidence_category
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN p.confidence_category
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN p.confidence_category
        ELSE 'LOCKED'
    END AS confidence_category,
    p.publication_status,
    p.tier_required,
    p.source_data_version,
    p.metadata,
    p.target_kickoff_at,
    p.settlement_status,
    p.settled_at,
    p.settlement_notes,
    p.actual_score,
    p.simulations_count,
    p.created_at,
    p.updated_at,
    CASE
        WHEN public.is_admin() THEN false
        WHEN public.is_paid_subscriber() THEN false
        WHEN p.settlement_status IN ('won', 'lost', 'void', 'refunded', 'settled') THEN false
        WHEN f.status IN ('settled', 'finished', 'ft', 'aet', 'pen') THEN false
        ELSE true
    END AS is_locked
FROM public.football_predictions p
LEFT JOIN public.football_fixtures f ON p.fixture_id = f.id
WHERE p.publication_status = 'published' OR public.is_admin();

GRANT SELECT ON public.football_predictions_paywall TO anon, authenticated, service_role;

-- 4. RLS Policy Overrides: Guarantee Full Admin Access on Base Tables
DROP POLICY IF EXISTS "predictions_admin_all_access_policy" ON public.football_predictions;
CREATE POLICY "predictions_admin_all_access_policy" ON public.football_predictions
FOR ALL
TO authenticated, service_role
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "simulations_admin_all_access_policy" ON public.football_simulations;
CREATE POLICY "simulations_admin_all_access_policy" ON public.football_simulations
FOR ALL
TO authenticated, service_role
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "fixtures_admin_all_access_policy" ON public.football_fixtures;
CREATE POLICY "fixtures_admin_all_access_policy" ON public.football_fixtures
FOR ALL
TO authenticated, service_role
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- 5. Ensure Primary Administrators Have Admin Role and Active Entitlements
UPDATE public.users
SET role = 'admin'
WHERE email IN ('chibzymart@gmail.com', 'whizzchibz@gmail.com');

-- Upsert active VIP entitlements for primary admin accounts
INSERT INTO public.entitlements (user_id, tier, features, valid_until)
SELECT id, 'bigbang', '{"football_predictions": true, "vip": true, "simulations": true, "admin": true}'::jsonb, NULL
FROM public.users
WHERE email IN ('chibzymart@gmail.com', 'whizzchibz@gmail.com')
ON CONFLICT (user_id) DO UPDATE
SET tier = 'bigbang',
    features = '{"football_predictions": true, "vip": true, "simulations": true, "admin": true}'::jsonb,
    valid_until = NULL;
