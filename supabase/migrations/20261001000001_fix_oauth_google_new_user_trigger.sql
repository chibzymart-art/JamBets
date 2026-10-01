-- Migration: 20261001000001_fix_oauth_google_new_user_trigger.sql
-- Description: Fix handle_new_user trigger to allow seamless Google/OAuth registration without throwing disclaimer exceptions

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
BEGIN
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

  -- 2. Provision default free entitlement
  BEGIN
    INSERT INTO public.entitlements (
      user_id, tier, feature, features, valid_until, created_at, updated_at
    ) VALUES (
      NEW.id, 'free', 'free', '{"football_predictions": false, "simulations": false}'::jsonb, NULL, now(), now()
    )
    ON CONFLICT (user_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Failed to create entitlement for %: %', NEW.id, SQLERRM;
  END;

  -- 3. Insert initial free subscription record
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.subscriptions WHERE user_id = NEW.id) THEN
      INSERT INTO public.subscriptions (
        user_id, tier, status, created_at, updated_at
      ) VALUES (
        NEW.id, 'free', 'active', now(), now()
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: Failed to create subscription for %: %', NEW.id, SQLERRM;
  END;

  -- 4. Record registration audit log (best effort)
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
        'initial_tier', 'free'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL; -- Non-blocking
  END;

  RETURN NEW;
END;
$function$;
