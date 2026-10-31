-- Only confirmed users become Oddsbanta users (31 Oct 2026).
--
-- Before: on_auth_user_created ran handle_new_user() on every insert into auth.users, so an email
-- sign-up got its public.users row, free entitlement, free subscription and 'user_registered' audit
-- entry before the address was confirmed. Mistyped and never-confirmed addresses counted as users,
-- and the 3-day trial clock started at sign-up.
--
-- After:
--   * handle_new_user() still checks the disclaimers on insert (a sign-up without them is rejected),
--     but creates the rows only once auth.users.email_confirmed_at is set. Google sign-ins arrive
--     confirmed, so they are created on insert as before. Email sign-ups are created by the new
--     on_auth_user_confirmed trigger when the confirmation link is used.
--   * is_football_entitled() starts the trial at email confirmation, matching api/_lib/jwt-verifier.ts
--     and web/src/hooks/useTrialStatus.ts.
--
-- The function body below is the live definition (read from pg_get_functiondef on 31 Oct 2026) with
-- only the confirmation check and the INSERT-only disclaimer check added. Existing rows are untouched;
-- removing the profiles of never-confirmed accounts is a separate, manual script:
-- supabase/scripts/remove_unconfirmed_profiles.sql.
--
-- ROLLBACK:
--   drop trigger if exists on_auth_user_confirmed on auth.users;
--   -- then re-run the previous handle_new_user() and is_football_entitled() bodies from
--   -- supabase/baseline/live_schema.sql (lines for handle_new_user and is_football_entitled).

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

    -- Strict validation only for direct email signups, at sign-up time (never blocks a confirmation)
    IF TG_OP = 'INSERT' AND NOT (v_age AND v_fin) THEN
      RAISE EXCEPTION 'Registration rejected: Both age confirmation and financial risk indemnity disclaimers must be accepted.';
    END IF;
  END IF;

  -- Only confirmed addresses become users. Unconfirmed email sign-ups wait for on_auth_user_confirmed.
  IF NEW.email_confirmed_at IS NULL THEN
    RETURN NEW;
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

-- Trigger function only: nobody calls it through the API (same grants as before).
revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to service_role;

-- Email sign-ups become users when the confirmation link is used.
drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
  after update on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_new_user();

-- Trial: 72 hours from email confirmation (was: from sign-up). Body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.is_football_entitled()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ SELECT COALESCE(public.is_admin(), false) OR COALESCE(public.is_paid_subscriber(), false) OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND lower(coalesce(u.role, '')) IN ('standard','bigbang','vip','pro','premium','admin')) OR EXISTS (SELECT 1 FROM auth.users au WHERE au.id = auth.uid() AND COALESCE(au.email_confirmed_at, au.created_at) > (now() - INTERVAL '3 days')); $function$;

-- Verify
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass) then
    raise exception 'on_auth_user_created is missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_confirmed' and tgrelid = 'auth.users'::regclass) then
    raise exception 'on_auth_user_confirmed is missing';
  end if;
  if position('email_confirmed_at IS NULL' in pg_get_functiondef('public.handle_new_user'::regproc)) = 0 then
    raise exception 'handle_new_user() does not check email_confirmed_at';
  end if;
end $$;
