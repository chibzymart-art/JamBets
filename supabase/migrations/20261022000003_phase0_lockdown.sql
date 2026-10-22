-- Phase 0 lockdown (22 Oct 2026). Safe to re-run. ROLLBACK at the bottom.
--
-- Closes the remaining browser read paths to paid model output and internal job data.
-- The Edge API, the engines and the bots use the service role, which bypasses row level security,
-- so none of them are affected. Visitors get prediction data only through the Edge API teasers.

-- ---------------------------------------------------------------------------
-- 1. corner_predictions: was readable by anyone (policy to PUBLIC using true).
--    Now: entitled signed-in users (same rule as goals_predictions) and admins.
-- ---------------------------------------------------------------------------
drop policy if exists "Allow public read corner predictions" on public.corner_predictions;
drop policy if exists corner_predictions_paid_read on public.corner_predictions;
create policy corner_predictions_paid_read on public.corner_predictions
  for select to authenticated
  using (public.is_football_entitled() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. football_simulations: full Monte Carlo output was readable by anon. No browser code reads it.
-- ---------------------------------------------------------------------------
drop policy if exists "Public read football_simulations" on public.football_simulations;
drop policy if exists football_simulations_paid_read on public.football_simulations;
create policy football_simulations_paid_read on public.football_simulations
  for select to authenticated
  using (public.is_football_entitled() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. system_jobs: internal job runs and errors were readable by anon. Admins only.
-- ---------------------------------------------------------------------------
drop policy if exists "Public read system_jobs" on public.system_jobs;
drop policy if exists system_jobs_admin_read on public.system_jobs;
create policy system_jobs_admin_read on public.system_jobs
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. Prediction views: no anon access. Visitors read teasers from the Edge API only.
--    Signed-in users keep SELECT; the views are security_invoker, so the base table policies decide.
-- ---------------------------------------------------------------------------
do $$
declare
  v text;
begin
  foreach v in array array[
    'goals_predictions_paywall', 'corner_predictions_paywall', 'tennis_predictions_paywall',
    'basketball_predictions_paywall', 'football_prediction_queue', 'football_prediction_teasers'
  ] loop
    if to_regclass('public.' || v) is not null then
      execute format('revoke all on table public.%I from anon', v);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Old admin_* overloads that nothing calls (the app and repo use the newer signatures).
--    They check for an admin inside, but there is no reason to keep them callable.
--    Revoked rather than dropped: their source is not in the repo.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.admin_toggle_league(bigint,boolean)',
    'public.admin_trigger_prediction_cycle(integer)',
    'public.admin_trigger_settlement_cycle(integer)',
    'public.admin_update_user_role(uuid,text)'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;
end;
$$;

-- ROLLBACK (only if something outside the app broke):
--   drop policy if exists corner_predictions_paid_read on public.corner_predictions;
--   create policy "Allow public read corner predictions" on public.corner_predictions for select to public using (true);
--   drop policy if exists football_simulations_paid_read on public.football_simulations;
--   create policy "Public read football_simulations" on public.football_simulations for select to anon, authenticated using (true);
--   drop policy if exists system_jobs_admin_read on public.system_jobs;
--   create policy "Public read system_jobs" on public.system_jobs for select to anon, authenticated using (true);
--   grant select on table public.<view> to anon;   -- for the six views
--   grant execute on function <old overload> to authenticated;
