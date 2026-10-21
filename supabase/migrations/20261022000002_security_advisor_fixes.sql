-- Security Advisor fixes (22 Oct 2026). Safe to re-run. ROLLBACK notes at the bottom.
--
-- Advisor before: 6 errors, 60 warnings.
-- What stays flagged on purpose is listed at the bottom with the reason.

-- ---------------------------------------------------------------------------
-- 1. CRITICAL: admin_record_manual_payment had no admin check and anyone could run it.
--    It sets users.role and the subscription for any user id, so any signed-up user could make
--    themselves VIP or 'admin'. Same signature and behaviour, now admin-only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_record_manual_payment(
  p_target_user_id uuid,
  p_tier text,
  p_amount numeric,
  p_reference text,
  p_valid_until timestamp with time zone
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  update public.users
     set role = p_tier, status = 'active', is_deleted = false, updated_at = now()
   where id = p_target_user_id;

  insert into public.subscriptions (user_id, tier, status, current_period_end, updated_at)
  values (p_target_user_id, p_tier, 'active', p_valid_until, now())
  on conflict (user_id) do update
    set tier = excluded.tier,
        status = 'active',
        current_period_end = excluded.current_period_end,
        updated_at = now();

  insert into public.admin_tasks (task_name, status, metadata)
  values ('MANUAL_PAYMENT_RECORDED', 'COMPLETED', jsonb_build_object(
    'target_user_id', p_target_user_id, 'tier', p_tier, 'amount', p_amount,
    'reference', p_reference, 'valid_until', p_valid_until, 'recorded_by', auth.uid()));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Analytics and health had no admin check. Keep the names the app calls, put the check in front.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.get_platform_analytics_unchecked()') is null then
    alter function public.get_platform_analytics() rename to get_platform_analytics_unchecked;
  end if;
  if to_regprocedure('public.get_system_health_unchecked()') is null then
    alter function public.get_system_health() rename to get_system_health_unchecked;
  end if;
end;
$$;

alter function public.get_platform_analytics_unchecked() set search_path = public;
alter function public.get_system_health_unchecked() set search_path = public;
revoke all on function public.get_platform_analytics_unchecked() from public, anon, authenticated;
revoke all on function public.get_system_health_unchecked() from public, anon, authenticated;

create or replace function public.get_platform_analytics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return public.get_platform_analytics_unchecked();
end;
$$;

create or replace function public.get_system_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return public.get_system_health_unchecked();
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Nobody without a sign-in may run admin or analytics functions (PUBLIC has EXECUTE by default).
--    Signed-in users keep EXECUTE: every one of these checks for an admin inside.
-- ---------------------------------------------------------------------------
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'admin\_%' or p.proname in ('get_platform_analytics', 'get_system_health', 'upgrade_subscription_tier'))
  loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
end;
$$;

-- Trigger and event-trigger functions are never called through the API. Firing a trigger does not
-- need EXECUTE, so this changes nothing for the database itself.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('handle_new_user', 'protect_user_roles_and_status', 'rls_auto_enable')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Fixed search_path on functions that had none (stops a caller swapping in their own objects).
--    'public' keeps unqualified table names in these bodies working.
-- ---------------------------------------------------------------------------
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proconfig is null
       and p.proname in (
         'admin_get_users', 'admin_get_audit_logs', 'admin_get_payments', 'upgrade_subscription_tier',
         'enforce_home_win_immutability', 'enforce_away_win_immutability', 'enforce_draw_immutability',
         'enforce_corner_immutability', 'update_updated_at_column')
  loop
    execute format('alter function %s set search_path = public', fn);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Audit log: any signed-in user could insert entries (WITH CHECK true). Admins only now.
--    The service role bypasses RLS and is unaffected.
-- ---------------------------------------------------------------------------
alter policy "Service role insert audit_logs" on public.audit_logs
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 6. Views run with the caller's permissions, so they obey row level security.
--    The Edge API and engines use the service role and are unaffected. In the browser only entitled
--    users read these, and the base tables already let them (tennis/basketball/football policies).
--    goals_predictions had no read policy for signed-in users: add the entitled one.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'goals_predictions' and policyname = 'goals_predictions_paid_read') then
    create policy goals_predictions_paid_read on public.goals_predictions
      for select to authenticated
      using (public.is_football_entitled());
  end if;
end;
$$;

alter view public.goals_predictions_paywall set (security_invoker = true);
alter view public.corner_predictions_paywall set (security_invoker = true);
alter view public.tennis_predictions_paywall set (security_invoker = true);
alter view public.basketball_predictions_paywall set (security_invoker = true);
alter view public.football_prediction_queue set (security_invoker = true);
alter view public.football_prediction_teasers set (security_invoker = true);

-- ---------------------------------------------------------------------------
-- Still flagged after this, on purpose:
--  * "Signed-In Users Can Execute SECURITY DEFINER Function" for admin_* / analytics / health:
--    the Admin panel calls them as a signed-in admin and each checks is_admin() (or users.role)
--    first. Clearing it means moving them behind the Edge API (Phase 2, admin table AZT-09).
--  * is_admin, is_football_entitled, is_multisport_entitled, is_paid_subscriber stay executable
--    by anon and authenticated: row level security policies call them, and a revoke would make
--    those tables error for every caller.
--  * Leaked password protection: needs the Supabase Pro plan.
--  * corner_predictions keeps its "public read" policy until Phase 0 (not an Advisor finding, but
--    it is the biggest remaining leak).
--
-- ROLLBACK (reverse order):
--   alter view public.<view> set (security_invoker = false);   -- for the six views
--   drop policy if exists goals_predictions_paid_read on public.goals_predictions;
--   alter policy "Service role insert audit_logs" on public.audit_logs with check (true);
--   drop function public.get_platform_analytics(); alter function public.get_platform_analytics_unchecked() rename to get_platform_analytics;
--   drop function public.get_system_health(); alter function public.get_system_health_unchecked() rename to get_system_health;
--   grant execute on function <fn> to public;   -- only if something outside the app broke
