-- =====================================================================
-- JamBets — Migration: Admin Whitelist Expansion & Telegram/Notification Schema
-- Ensures all administrative accounts have complete bypass and access across RLS views,
-- and adds Telegram & WhatsApp notification integration fields to public.users.
-- =====================================================================

-- 1. Upgrade public.is_admin() with Dynamic Role Checking (Universal Admin Access)
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
    -- Check 1: Any user where role = 'admin' in public.users
    IF EXISTS (
        SELECT 1 FROM public.users
        WHERE (id = auth.uid() OR LOWER(email) = LOWER(auth.jwt() ->> 'email'))
          AND role = 'admin'
    ) THEN
        RETURN true;
    END IF;

    -- Check 2: Any user where entitlement tier = 'admin' or features ->> 'admin' = 'true'
    IF EXISTS (
        SELECT 1 FROM public.entitlements
        WHERE (user_id = auth.uid())
          AND (tier = 'admin' OR (features ->> 'admin')::boolean = true)
    ) THEN
        RETURN true;
    END IF;

    -- Check 3: Any user where subscription tier = 'admin'
    IF EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE (user_id = auth.uid())
          AND tier = 'admin'
          AND status = 'active'
    ) THEN
        RETURN true;
    END IF;

    -- Check 4: JWT user_metadata or app_metadata role = 'admin'
    IF (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin' OR
       (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin' THEN
        RETURN true;
    END IF;

    -- Check 5: Hardcoded primary administrator accounts fallback
    IF LOWER(auth.jwt() ->> 'email') IN (
        'chibzymart@gmail.com',
        'whizzchibz@gmail.com',
        'chibuezec.amuchie@gmail.com',
        'chibuezeamuchie@gmail.com',
        'nnamdiamuchie@gmail.com'
    ) THEN
        RETURN true;
    END IF;

    -- Check 6: Service role key bypass
    IF (auth.jwt() ->> 'role') = 'service_role' THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- 2. Ensure public.is_paid_subscriber() Automatically Includes All Admins
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
    WHERE (u.id = auth.uid() OR LOWER(u.email) = LOWER(auth.jwt() ->> 'email'))
      AND u.role = 'admin'
  ), (
    SELECT true
    FROM public.entitlements e
    WHERE e.user_id = auth.uid()
      AND (e.tier IN ('standard', 'bigbang', 'pro', 'premium', 'admin') OR (e.features ->> 'admin')::boolean = true)
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

-- 3. Add Telegram & WhatsApp Notification Fields to public.users
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_auth_token TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS telegram_auth_expires_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_users_telegram_chat_id ON public.users(telegram_chat_id);
CREATE INDEX IF NOT EXISTS idx_users_telegram_auth_token ON public.users(telegram_auth_token);

-- 4. Rebuild paywalled view to guarantee zero latency for admin evaluation
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
