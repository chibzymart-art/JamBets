-- Database access matrix test (Phase 1 / Phase 5).
-- Run in the Supabase SQL editor (or psql). Everything happens inside one transaction that is rolled
-- back at the end, so it changes nothing. Read-only: it only counts rows and calls admin functions
-- whose admin check refuses non-admins before doing anything.
--
-- Roles checked:
--   anon            the public anon key (logged-out visitor)
--   unpaid          a signed-in user with no subscription, entitlement or trial
--   paid            a real active BigBang subscriber (id picked inside the script, never printed)
--   admin           a signed-in admin (claims email on the admin list)
--
-- Passes with one row: 'ACCESS MATRIX: ALL PASSED (n checks)'.
-- Fails with an error listing every broken expectation.

begin;

select set_config('t.fail', '', true), set_config('t.n', '0', true);

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  t text; n bigint; f text := ''; c int := 0;
begin
  -- Tables: row level security must hide every row (or the grant is gone).
  foreach t in array array['corner_predictions','football_simulations','system_jobs','goals_predictions',
    'tennis_predictions','basketball_predictions','users','subscriptions','entitlements','payments',
    'audit_logs','admin_tasks'] loop
    c := c + 1;
    begin
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then f := f || format(E'\n anon can read %s rows of %s', n, t); end if;
    exception when insufficient_privilege or undefined_table then null;
    end;
  end loop;

  -- Football: only settled wins (the public track record), never an open pick.
  c := c + 1;
  select count(*) into n from public.football_predictions where settlement_status = 'pending';
  if n > 0 then f := f || format(E'\n anon can read %s open football picks', n); end if;

  -- Views and retired tables: no access at all.
  foreach t in array array['goals_predictions_paywall','corner_predictions_paywall','tennis_predictions_paywall',
    'basketball_predictions_paywall','football_prediction_queue','football_prediction_teasers',
    'home_win_predictions','away_win_predictions','draw_predictions'] loop
    c := c + 1;
    begin
      execute format('select count(*) from public.%I', t) into n;
      f := f || format(E'\n anon can query %s (%s rows)', t, n);
    exception when insufficient_privilege or undefined_table then null;
    end;
  end loop;

  -- Admin and analytics functions: refused.
  foreach t in array array['admin_engine_telemetry()','get_platform_analytics()','get_system_health()',
    'admin_get_users()','admin_broadcast_picks(10)'] loop
    c := c + 1;
    begin
      execute 'select public.' || t;
      f := f || format(E'\n anon can call %s', t);
    exception when insufficient_privilege or undefined_function then null;
    end;
  end loop;

  perform set_config('t.fail', current_setting('t.fail') || f, true);
  perform set_config('t.n', (current_setting('t.n')::int + c)::text, true);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- unpaid signed-in user (an id that has no rows anywhere)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","email":"access-matrix@invalid.test"}', true);
set local role authenticated;
do $$
declare
  t text; n bigint; f text := ''; c int := 0; has_status boolean;
begin
  foreach t in array array['corner_predictions','goals_predictions','tennis_predictions','basketball_predictions',
    'football_predictions','goals_predictions_paywall','corner_predictions_paywall','tennis_predictions_paywall',
    'basketball_predictions_paywall','football_prediction_teasers'] loop
    c := c + 1;
    select exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'settlement_status')
      into has_status;
    begin
      if has_status then
        execute format('select count(*) from public.%I where settlement_status = %L', t, 'pending') into n;
      else
        -- Views without a status column (football_prediction_teasers): nothing that has not kicked off.
        execute format('select count(*) from public.%I where target_kickoff_at > now()', t) into n;
      end if;
      if n > 0 then f := f || format(E'\n unpaid user can read %s open rows of %s', n, t); end if;
    exception when insufficient_privilege or undefined_table then null;
    end;
  end loop;

  foreach t in array array['football_simulations','system_jobs','users','subscriptions','entitlements','payments','audit_logs'] loop
    c := c + 1;
    begin
      execute format('select count(*) from public.%I where true', t) into n;
      -- users/subscriptions/entitlements may expose the caller's own row only; this id has none.
      if n > 0 then f := f || format(E'\n unpaid user can read %s rows of %s', n, t); end if;
    exception when insufficient_privilege or undefined_table then null;
    end;
  end loop;

  foreach t in array array['admin_engine_telemetry()','get_platform_analytics()','get_system_health()',
    'admin_get_users()','admin_broadcast_picks(10)'] loop
    c := c + 1;
    begin
      execute 'select public.' || t;
      f := f || format(E'\n unpaid user can call %s', t);
    exception when insufficient_privilege or undefined_function or raise_exception then null;
    end;
  end loop;

  -- Old admin overloads must not be callable at all.
  foreach t in array array['admin_toggle_league(bigint,boolean)','admin_trigger_prediction_cycle(integer)',
    'admin_trigger_settlement_cycle(integer)','admin_update_user_role(uuid,text)'] loop
    c := c + 1;
    if to_regprocedure('public.' || t) is not null and has_function_privilege('authenticated', ('public.' || t)::regprocedure, 'execute') then
      f := f || format(E'\n signed-in users can still execute old overload %s', t);
    end if;
  end loop;

  perform set_config('t.fail', current_setting('t.fail') || f, true);
  perform set_config('t.n', (current_setting('t.n')::int + c)::text, true);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- paid: a real active BigBang subscriber, if one exists (id never printed)
-- ---------------------------------------------------------------------------
select set_config('t.paid_uid', coalesce((
  select s.user_id::text from public.subscriptions s
   where s.tier = 'bigbang' and s.status = 'active'
     and (s.current_period_end is null or s.current_period_end > now())
   order by s.created_at desc limit 1), ''), true);
select set_config('request.jwt.claims',
  json_build_object('sub', nullif(current_setting('t.paid_uid'), ''), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  t text; n bigint; f text := ''; c int := 0;
begin
  if current_setting('t.paid_uid') = '' then
    perform set_config('t.note', ' (no active BigBang subscriber found, paid checks skipped)', true);
    return;
  end if;
  -- A paid user must actually get the picks they pay for, wherever open picks exist.
  foreach t in array array['corner_predictions','goals_predictions','tennis_predictions','basketball_predictions','football_predictions'] loop
    c := c + 1;
    execute format('select count(*) from public.%I where settlement_status = %L', t, 'pending') into n;
    perform set_config('t.paid_' || t, n::text, true);
  end loop;
  -- Never admin.
  c := c + 1;
  begin
    perform public.admin_engine_telemetry();
    f := f || E'\n a paid user can call admin_engine_telemetry';
  exception when insufficient_privilege or raise_exception then null;
  end;
  perform set_config('t.fail', current_setting('t.fail') || f, true);
  perform set_config('t.n', (current_setting('t.n')::int + c)::text, true);
end $$;
reset role;

-- Compare paid visibility with the real number of open picks (as the table owner).
do $$
declare
  t text; total bigint; seen text; f text := '';
begin
  if current_setting('t.paid_uid') = '' then return; end if;
  foreach t in array array['corner_predictions','goals_predictions','tennis_predictions','basketball_predictions','football_predictions'] loop
    execute format('select count(*) from public.%I where settlement_status = %L', t, 'pending') into total;
    seen := current_setting('t.paid_' || t, true);
    if total > 0 and coalesce(seen, '0')::bigint = 0 then
      f := f || format(E'\n paid user sees 0 of %s open rows in %s', total, t);
    end if;
  end loop;
  perform set_config('t.fail', current_setting('t.fail') || f, true);
end $$;

-- ---------------------------------------------------------------------------
-- admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","email":"whizzchibz@gmail.com"}', true);
set local role authenticated;
do $$
declare
  n bigint; f text := ''; c int := 2; j jsonb;
begin
  select count(*) into n from public.system_jobs;
  if n = 0 then f := f || E'\n admin cannot read system_jobs'; end if;
  begin
    j := public.admin_engine_telemetry();
    if j is null then f := f || E'\n admin_engine_telemetry returned nothing for admin'; end if;
  exception when others then
    f := f || format(E'\n admin cannot call admin_engine_telemetry (%s)', sqlerrm);
  end;
  perform set_config('t.fail', current_setting('t.fail') || f, true);
  perform set_config('t.n', (current_setting('t.n')::int + c)::text, true);
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Verdict
-- ---------------------------------------------------------------------------
do $$
begin
  if current_setting('t.fail') <> '' then
    raise exception 'ACCESS MATRIX FAILED:%', current_setting('t.fail');
  end if;
end $$;

select 'ACCESS MATRIX: ALL PASSED (' || current_setting('t.n') || ' checks)' || coalesce(current_setting('t.note', true), '') as result;

rollback;
