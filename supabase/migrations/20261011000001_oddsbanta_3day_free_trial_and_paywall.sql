-- Migration: 20261011000001_oddsbanta_3day_free_trial_and_paywall.sql
-- Description: Oddsbanta 3-Day Free Trial Architecture on Main Football Predictions
-- 1. Automatic 3-day full access trial on main football predictions upon user registration
-- 2. Scrapers and unauthenticated visitors cannot see any active predictions (only sanitized won proof)
-- 3. Expired trial users are completely blinded from settlements and pending games
-- 4. Specialist engines (goals, corners, bangers sub-markets), tennis, and basketball remain VIP only

-- 1. Create or Replace public.is_football_entitled()
-- Strictly verifies whether caller is an admin, active paid subscriber, or within their 3-day free trial window for main football
CREATE OR REPLACE FUNCTION public.is_football_entitled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_admin(), false) OR COALESCE((
    -- 1. Admins via users table
    SELECT true
    FROM public.users u
    WHERE (u.id = auth.uid() OR LOWER(u.email) = LOWER(auth.jwt() ->> 'email'))
      AND u.role = 'admin'
    LIMIT 1
  ), (
    -- 2. Active Paid Subscribers via subscriptions table
    SELECT true
    FROM public.subscriptions s
    WHERE s.user_id = auth.uid()
      AND s.status = 'active'
      AND s.tier IN ('standard', 'bigbang', 'vip', 'pro', 'admin')
    LIMIT 1
  ), (
    -- 3. Active 3-Day Trial or Entitled Users
    SELECT true
    FROM public.entitlements e
    WHERE e.user_id = auth.uid()
      AND (
        e.tier IN ('trial', 'standard', 'bigbang', 'vip', 'pro', 'admin')
        OR (e.features ->> 'trial')::boolean = true
        OR (e.features ->> 'football_predictions')::boolean = true
        OR (e.features ->> 'admin')::boolean = true
      )
      AND (e.valid_until IS NULL OR e.valid_until > now())
    LIMIT 1
  ), false);
$$;

GRANT EXECUTE ON FUNCTION public.is_football_entitled() TO anon, authenticated, service_role;


-- 2. Update football_predictions & football_settlements RLS
-- Unauthenticated visitors and scrapers can ONLY see 'won' games (SEO proof of work)
-- Authenticated users within their 3-day trial or with VIP get 100% full access
-- Expired users cannot see settlements or active games
ALTER TABLE public.football_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "predictions_paywall_read_policy" ON public.football_predictions;

CREATE POLICY "predictions_paywall_read_policy" ON public.football_predictions
FOR SELECT
TO authenticated, anon
USING (
    publication_status = 'published'
    AND (
        settlement_status = 'won'
        OR public.is_football_entitled()
    )
);

ALTER TABLE public.football_settlements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "football_settlements_paywall_read_policy" ON public.football_settlements;

CREATE POLICY "football_settlements_paywall_read_policy" ON public.football_settlements
FOR SELECT
TO authenticated, anon
USING (
    status = 'won'
    OR public.is_football_entitled()
);


-- 3. Update handle_new_user() trigger function
-- Automatically provisions 3-day free trial on Oddsbanta main football predictions for all new signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_age BOOLEAN;
  v_fin BOOLEAN;
  v_provider TEXT;
  v_display_name TEXT;
  v_version TEXT;
  v_trial_until TIMESTAMPTZ;
BEGIN
  -- 3-day trial expires exactly 72 hours from account creation
  v_trial_until := now() + INTERVAL '3 days';

  -- Determine auth provider ('google', 'email', etc.)
  v_provider := COALESCE(
    NEW.raw_app_meta_data->>'provider',
    CASE 
      WHEN NEW.raw_user_meta_data->>'iss' ILIKE '%google%' THEN 'google'
      ELSE 'email'
    END
  );

  -- For Google / OAuth users, disclaimers are acknowledged via Google consent screen & UI disclaimer
  IF v_provider = 'google' 
     OR v_provider <> 'email' 
     OR (NEW.raw_user_meta_data->>'iss') ILIKE '%google%'
     OR (NEW.raw_app_meta_data->>'providers') ILIKE '%google%' THEN
    v_age := true;
    v_fin := true;
    v_version := COALESCE(NEW.raw_user_meta_data->>'disclaimer_version', 'v1.0-oauth');
  ELSE
    -- Email signup path
    v_age := COALESCE((NEW.raw_user_meta_data->>'disclaimer_age_accepted')::boolean, false);
    v_fin := COALESCE((NEW.raw_user_meta_data->>'disclaimer_financial_accepted')::boolean, false);
    v_version := COALESCE(NEW.raw_user_meta_data->>'disclaimer_version', 'v1.0');
    
    -- Strict validation only for direct email signups
    IF NOT (v_age AND v_fin) THEN
      RAISE EXCEPTION 'Registration rejected: Both age confirmation and financial risk indemnity disclaimers must be accepted.';
    END IF;
  END IF;

  -- Extract best display name (Google full_name/name/display_name or email prefix)
  v_display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    NEW.raw_user_meta_data->>'display_name',
    split_part(NEW.email, '@', 1)
  );

  -- 1. Insert or update public.users
  BEGIN
    INSERT INTO public.users (
      id, email, display_name, role,
      disclaimer_age_accepted, disclaimer_age_accepted_at,
      disclaimer_financial_accepted, disclaimer_financial_accepted_at,
      disclaimer_version, created_at, updated_at
    ) VALUES (
      NEW.id, NEW.email,
      v_display_name,
      'free', true, now(), true, now(), v_version, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = COALESCE(public.users.display_name, EXCLUDED.display_name),
      disclaimer_age_accepted = true,
      disclaimer_financial_accepted = true,
      updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Failed to insert/update public.users for %: %', NEW.id, SQLERRM;
  END;

  -- 2. Provision automatic 3-day free trial on Oddsbanta main football predictions
  BEGIN
    INSERT INTO public.entitlements (
      user_id, tier, feature, features, valid_until, created_at, updated_at
    ) VALUES (
      NEW.id,
      'trial',
      'football_trial',
      jsonb_build_object(
        'trial', true,
        'trial_days', 3,
        'trial_started_at', now(),
        'football_predictions', true,
        'simulations', true,
        'all_sports', false,
        'goals_specialist', false,
        'corners_specialist', false,
        'tennis', false,
        'basketball', false
      ),
      v_trial_until,
      now(),
      now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      tier = CASE WHEN public.entitlements.tier = 'free' THEN 'trial' ELSE public.entitlements.tier END,
      valid_until = CASE WHEN public.entitlements.tier = 'free' THEN v_trial_until ELSE public.entitlements.valid_until END,
      features = CASE WHEN public.entitlements.tier = 'free' THEN EXCLUDED.features ELSE public.entitlements.features END,
      updated_at = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Failed to create trial entitlement for %: %', NEW.id, SQLERRM;
  END;

  -- 3. Insert initial trial subscription record
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = NEW.id) THEN
      INSERT INTO public.subscriptions (
        user_id, tier, status, created_at, updated_at
      ) VALUES (
        NEW.id, 'trial', 'trialing', now(), now()
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Failed to create subscription for %: %', NEW.id, SQLERRM;
  END;

  -- 4. Record registration audit log
  BEGIN
    INSERT INTO public.audit_logs (
      actor_type, actor_id, action, resource_type, resource_id, details
    ) VALUES (
      'user',
      NEW.id::text,
      'user_registered',
      'users',
      NEW.id::text,
      jsonb_build_object(
        'email', NEW.email,
        'provider', v_provider,
        'disclaimer_version', v_version,
        'initial_tier', 'trial',
        'trial_days', 3,
        'trial_expires_at', v_trial_until
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Non-blocking
  END;

  RETURN NEW;
END;
$function$;


-- 4. Create User Trial Status RPC
-- Fast atomic check for frontend and edge APIs
CREATE OR REPLACE FUNCTION public.get_user_trial_status(p_user_id UUID DEFAULT auth.uid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id UUID;
  v_is_admin BOOLEAN := false;
  v_is_paid BOOLEAN := false;
  v_ent RECORD;
  v_is_trial_active BOOLEAN := false;
  v_is_trial_expired BOOLEAN := false;
  v_valid_until TIMESTAMPTZ := NULL;
  v_rem_sec BIGINT := 0;
BEGIN
  v_target_id := COALESCE(p_user_id, auth.uid());
  IF v_target_id IS NULL THEN
    RETURN jsonb_build_object(
      'auth_status', 'visitor',
      'is_trial_active', false,
      'is_trial_expired', false,
      'is_paid_subscriber', false,
      'is_admin', false
    );
  END IF;

  -- Admin check
  SELECT COALESCE(u.role = 'admin', false) INTO v_is_admin
  FROM public.users u
  WHERE u.id = v_target_id;

  -- Paid subscription check
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = v_target_id
      AND s.status = 'active'
      AND s.tier IN ('standard', 'bigbang', 'vip', 'pro', 'admin')
  ) INTO v_is_paid;

  -- Entitlement check
  SELECT e.tier, e.valid_until, e.features INTO v_ent
  FROM public.entitlements e
  WHERE e.user_id = v_target_id
  ORDER BY e.created_at DESC
  LIMIT 1;

  IF v_ent.valid_until IS NOT NULL THEN
    v_valid_until := v_ent.valid_until;
    IF v_valid_until > now() THEN
      v_is_trial_active := true;
      v_rem_sec := EXTRACT(EPOCH FROM (v_valid_until - now()))::bigint;
    ELSE
      v_is_trial_expired := true;
    END IF;
  ELSE
    -- If free user with no trial timestamp, check user created_at
    SELECT CASE WHEN u.created_at > (now() - INTERVAL '3 days') THEN true ELSE false END INTO v_is_trial_active
    FROM public.users u WHERE u.id = v_target_id;
    IF NOT v_is_trial_active THEN
      v_is_trial_expired := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_target_id,
    'auth_status', CASE
      WHEN v_is_admin OR v_is_paid OR v_is_trial_active THEN 'paid_or_trial'
      WHEN v_is_trial_expired THEN 'expired'
      ELSE 'visitor'
    END,
    'is_trial_active', v_is_trial_active,
    'is_trial_expired', v_is_trial_expired,
    'is_paid_subscriber', v_is_paid,
    'is_admin', v_is_admin,
    'valid_until', v_valid_until,
    'remaining_seconds', v_rem_sec
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_trial_status(UUID) TO authenticated, anon, service_role;


-- 5. Backfill Existing Users
-- Users registered in last 3 days get remaining trial time
UPDATE public.entitlements e
SET
  tier = 'trial',
  feature = 'football_trial',
  features = jsonb_build_object(
    'trial', true,
    'trial_days', 3,
    'trial_started_at', u.created_at,
    'football_predictions', true,
    'simulations', true,
    'all_sports', false,
    'goals_specialist', false,
    'corners_specialist', false,
    'tennis', false,
    'basketball', false
  ),
  valid_until = u.created_at + INTERVAL '3 days',
  updated_at = now()
FROM public.users u
WHERE e.user_id = u.id
  AND e.tier = 'free'
  AND u.created_at >= (now() - INTERVAL '3 days');

-- Users registered over 3 days ago are marked expired (valid_until in past)
UPDATE public.entitlements e
SET
  tier = 'trial',
  feature = 'football_trial',
  features = jsonb_build_object(
    'trial', true,
    'trial_days', 3,
    'trial_expired', true,
    'trial_started_at', u.created_at,
    'football_predictions', false,
    'simulations', false,
    'all_sports', false,
    'goals_specialist', false,
    'corners_specialist', false,
    'tennis', false,
    'basketball', false
  ),
  valid_until = u.created_at + INTERVAL '3 days',
  updated_at = now()
FROM public.users u
WHERE e.user_id = u.id
  AND e.tier = 'free'
  AND u.created_at < (now() - INTERVAL '3 days');
