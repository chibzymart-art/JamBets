-- Phase 1 follow-up
-- 1. Admin panel reads prediction data through admin-only functions instead of querying tables and
--    paywall views from the browser. Phase 0 can then remove browser read access to those tables
--    without breaking the Admin panel.
-- 2. The retired 1X2 specialist markets (home_win, away_win, draw) are closed to the Data API.
--    Nothing on the site reads them any more. Their data is kept: dropping it is a separate,
--    deliberate step (supabase/scripts/drop_retired_1x2_markets.sql).
--
-- Safe to re-run. ROLLBACK at the bottom.

-- ---------------------------------------------------------------------------
-- 1. Admin-only reads
-- ---------------------------------------------------------------------------

-- Per-engine prediction counts for the Admin panel's engine cards.
create or replace function public.admin_engine_telemetry()
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

  return jsonb_build_object(
    'core', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where settlement_status = 'pending'),
        'won', count(*) filter (where settlement_status = 'won'),
        'lost', count(*) filter (where settlement_status = 'lost'))
      from public.football_predictions),
    'goals', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where settlement_status = 'pending'),
        'won', count(*) filter (where settlement_status = 'won'),
        'lost', count(*) filter (where settlement_status = 'lost'))
      from public.goals_predictions),
    'corners', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where settlement_status = 'pending'),
        'won', count(*) filter (where settlement_status = 'won'),
        'lost', count(*) filter (where settlement_status = 'lost'))
      from public.corner_predictions),
    'tennis', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where settlement_status = 'pending'),
        'won', count(*) filter (where settlement_status = 'won'),
        'lost', count(*) filter (where settlement_status = 'lost'))
      from public.tennis_predictions),
    'basketball', (
      select jsonb_build_object(
        'total', count(*),
        'pending', count(*) filter (where settlement_status = 'pending'),
        'won', count(*) filter (where settlement_status = 'won'),
        'lost', count(*) filter (where settlement_status = 'lost'))
      from public.basketball_predictions)
  );
end;
$$;

-- Next published football picks for the Admin panel's broadcast text generator.
create or replace function public.admin_broadcast_picks(p_limit integer default 10)
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

  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.target_kickoff_at)
    from (
      select
        p.id,
        p.prediction,
        p.market,
        p.probability,
        p.confidence_category,
        p.target_kickoff_at,
        ht.name as home_team,
        awt.name as away_team,
        l.code as league_code,
        l.name as league_name
      from public.football_predictions p
      join public.football_fixtures f on f.id = p.fixture_id
      join public.football_leagues l on l.id = f.league_id
      left join public.football_teams ht on ht.id = f.home_team_id
      left join public.football_teams awt on awt.id = f.away_team_id
      where p.publication_status = 'published'
        and p.settlement_status = 'pending'
      order by p.target_kickoff_at asc
      limit least(greatest(coalesce(p_limit, 10), 1), 50)
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Functions are executable by PUBLIC by default: take that away, then grant signed-in users
-- (the admin check inside does the rest) and the service role.
revoke all on function public.admin_engine_telemetry() from public, anon;
revoke all on function public.admin_broadcast_picks(integer) from public, anon;
grant execute on function public.admin_engine_telemetry() to authenticated, service_role;
grant execute on function public.admin_broadcast_picks(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Retired 1X2 markets: no Data API access for browsers
-- ---------------------------------------------------------------------------
do $$
declare
  obj text;
begin
  foreach obj in array array[
    'home_win_predictions', 'away_win_predictions', 'draw_predictions',
    'home_win_predictions_paywall', 'away_win_predictions_paywall', 'draw_predictions_paywall',
    'home_win_settlements', 'away_win_settlements', 'draw_settlements'
  ] loop
    if to_regclass('public.' || obj) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', obj);
    end if;
  end loop;
end;
$$;

-- ROLLBACK:
--   drop function if exists public.admin_engine_telemetry();
--   drop function if exists public.admin_broadcast_picks(integer);
--   -- retired tables: grant select on table public.<name> to anon, authenticated;  (only if ever needed)
