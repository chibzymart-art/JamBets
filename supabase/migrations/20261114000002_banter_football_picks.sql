-- Banter Hub step 2: members' football picks.
-- Additive only. Reads football_fixtures / football_leagues / football_teams / football_predictions;
-- never writes to them. Nothing in the Predictions Hub changes.
-- Needs 20261114000001_banter_foundations.sql (has_banter_access, player_profiles) applied first.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Pickable fixtures = fixtures the main system has already published a prediction for
-- (football_predictions.publication_status in ('published','settled')) on the chosen local date.
-- Nothing from the AI prediction (pick, probability, tier, reasoning) is exposed.
--
-- Markets: 1X2 (home/draw/away), OU25 (over/under 2.5 goals), BTTS (yes/no). All three are graded
-- from the full-time score already stored on football_fixtures (home_score, away_score), the same
-- verified result the existing settlement uses, so a later settle step needs no new data.
-- Picks lock 60 seconds before kickoff. Settlement (status/points) is a later, separate change.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.football_user_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  fixture_id uuid not null references public.football_fixtures(id) on delete cascade,
  market text not null,
  selection text not null,
  kickoff_at timestamptz not null,
  status text not null default 'pending',
  points numeric(4,1),
  copied_from uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint football_user_picks_market_check check (market in ('1X2', 'OU25', 'BTTS')),
  constraint football_user_picks_selection_check check (
    (market = '1X2' and selection in ('home', 'draw', 'away'))
    or (market = 'OU25' and selection in ('over', 'under'))
    or (market = 'BTTS' and selection in ('yes', 'no'))
  ),
  constraint football_user_picks_status_check check (status in ('pending', 'won', 'lost', 'void')),
  constraint football_user_picks_one_per_market unique (user_id, fixture_id, market)
);

create index if not exists football_user_picks_user_kickoff_idx
  on public.football_user_picks (user_id, kickoff_at desc);
create index if not exists football_user_picks_fixture_idx
  on public.football_user_picks (fixture_id);
create index if not exists football_user_picks_pending_idx
  on public.football_user_picks (kickoff_at) where status = 'pending';

alter table public.football_user_picks enable row level security;

revoke all on table public.football_user_picks from anon, authenticated;
grant select, insert, update, delete on table public.football_user_picks to service_role;
grant select on table public.football_user_picks to authenticated;

-- Members with access can read picks (their own and other members'). Visitors and expired trials
-- get zero rows. No write policy: writes go only through the RPCs below.
create policy "football_user_picks_select_with_access" on public.football_user_picks
  for select to authenticated
  using ((select public.has_banter_access()));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------

-- A valid IANA zone name, else Africa/Lagos (the site default).
create or replace function public.banter_safe_tz(p_tz text)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select n.name from pg_catalog.pg_timezone_names n where n.name = p_tz limit 1),
    'Africa/Lagos'
  );
$$;

revoke execute on function public.banter_safe_tz(text) from public, anon;
grant execute on function public.banter_safe_tz(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- Pickable fixtures for one local date, optionally limited to league codes.
-- Returns teams, league, kickoff, status, and the score only once the match is finished.
create or replace function public.banter_football_fixtures(
  p_date date,
  p_tz text default 'Africa/Lagos',
  p_leagues text[] default null
)
returns table (
  fixture_id uuid,
  kickoff_at timestamptz,
  status text,
  league_code text,
  league_name text,
  league_country text,
  home_team text,
  away_team text,
  home_score integer,
  away_score integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tz text := public.banter_safe_tz(p_tz);
  v_start timestamptz;
begin
  if (select auth.uid()) is null or not public.has_banter_access() then
    return;
  end if;
  if p_date is null then
    return;
  end if;

  v_start := (p_date::timestamp) at time zone v_tz;

  return query
  select f.id,
         f.target_kickoff_at,
         f.status,
         l.code,
         l.name,
         l.country,
         hmt.name,
         awt.name,
         case when f.status = 'finished' then f.home_score end,
         case when f.status = 'finished' then f.away_score end
    from public.football_fixtures f
    join public.football_leagues l on l.id = f.league_id
    left join public.football_teams hmt on hmt.id = f.home_team_id
    left join public.football_teams awt on awt.id = f.away_team_id
   where f.target_kickoff_at >= v_start
     and f.target_kickoff_at < v_start + interval '1 day'
     and exists (
       select 1 from public.football_predictions p
        where p.fixture_id = f.id
          and p.publication_status in ('published', 'settled')
     )
     and (p_leagues is null or cardinality(p_leagues) = 0 or l.code = any (p_leagues))
   order by f.target_kickoff_at, l.name, hmt.name
   limit 400;
end;
$$;

-- Leagues that have pickable fixtures on a local date (for the tick-box dropdown).
create or replace function public.banter_football_leagues(p_date date, p_tz text default 'Africa/Lagos')
returns table (league_code text, league_name text, league_country text, fixtures integer)
language sql
stable
security definer
set search_path = ''
as $$
  select x.league_code, x.league_name, x.league_country, count(*)::integer
    from public.banter_football_fixtures(p_date, p_tz, null) x
   group by x.league_code, x.league_name, x.league_country
   order by x.league_country, x.league_name;
$$;

-- Make or change a pick. Errors (message = code): not_signed_in, no_access, no_profile,
-- market_invalid, selection_invalid, fixture_not_pickable, pick_locked.
create or replace function public.banter_submit_football_pick(
  p_fixture_id uuid,
  p_market text,
  p_selection text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_market text := upper(btrim(coalesce(p_market, '')));
  v_sel text := lower(btrim(coalesce(p_selection, '')));
  v_kickoff timestamptz;
  v_status text;
  v_row public.football_user_picks%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.player_profiles where user_id = v_uid) then
    raise exception 'no_profile';
  end if;
  if v_market not in ('1X2', 'OU25', 'BTTS') then raise exception 'market_invalid'; end if;
  if not (
    (v_market = '1X2' and v_sel in ('home', 'draw', 'away'))
    or (v_market = 'OU25' and v_sel in ('over', 'under'))
    or (v_market = 'BTTS' and v_sel in ('yes', 'no'))
  ) then
    raise exception 'selection_invalid';
  end if;

  select f.target_kickoff_at, f.status into v_kickoff, v_status
    from public.football_fixtures f
   where f.id = p_fixture_id
     and exists (
       select 1 from public.football_predictions p
        where p.fixture_id = f.id
          and p.publication_status in ('published', 'settled')
     );

  if v_kickoff is null then raise exception 'fixture_not_pickable'; end if;
  if v_status <> 'scheduled' or now() >= v_kickoff - interval '60 seconds' then
    raise exception 'pick_locked';
  end if;

  insert into public.football_user_picks as k (user_id, fixture_id, market, selection, kickoff_at)
  values (v_uid, p_fixture_id, v_market, v_sel, v_kickoff)
  on conflict (user_id, fixture_id, market) do update
    set selection = excluded.selection,
        kickoff_at = excluded.kickoff_at,
        updated_at = now()
    where k.status = 'pending'
  returning * into v_row;

  if v_row.id is null then raise exception 'pick_locked'; end if;

  return jsonb_build_object(
    'id', v_row.id, 'fixture_id', v_row.fixture_id, 'market', v_row.market,
    'selection', v_row.selection, 'kickoff_at', v_row.kickoff_at, 'status', v_row.status
  );
end;
$$;

-- Remove one of the caller's picks before it locks. Errors: not_signed_in, no_access, pick_locked.
-- Returns true when a pick was removed, false when there was none.
create or replace function public.banter_cancel_football_pick(p_fixture_id uuid, p_market text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_kickoff timestamptz;
  v_n integer;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;

  select k.kickoff_at into v_kickoff
    from public.football_user_picks k
   where k.user_id = v_uid and k.fixture_id = p_fixture_id and k.market = upper(btrim(coalesce(p_market, '')));

  if v_kickoff is null then return false; end if;
  if now() >= v_kickoff - interval '60 seconds' then raise exception 'pick_locked'; end if;

  delete from public.football_user_picks k
   where k.user_id = v_uid and k.fixture_id = p_fixture_id
     and k.market = upper(btrim(coalesce(p_market, ''))) and k.status = 'pending';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- The caller's picks with match details. With a date: that local day. Without: the last 60 days.
-- There is no limit on how many picks a member makes (owner); the list returns up to 2000 rows.
create or replace function public.banter_my_football_picks(p_date date default null, p_tz text default 'Africa/Lagos')
returns table (
  id uuid,
  fixture_id uuid,
  market text,
  selection text,
  kickoff_at timestamptz,
  status text,
  points numeric,
  settled_at timestamptz,
  fixture_status text,
  league_name text,
  league_country text,
  home_team text,
  away_team text,
  home_score integer,
  away_score integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_tz text := public.banter_safe_tz(p_tz);
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;

  if p_date is not null then
    v_start := (p_date::timestamp) at time zone v_tz;
    v_end := v_start + interval '1 day';
  else
    v_start := now() - interval '60 days';
    v_end := now() + interval '7 days';
  end if;

  return query
  select k.id, k.fixture_id, k.market, k.selection, k.kickoff_at, k.status, k.points, k.settled_at,
         f.status, l.name, l.country, hmt.name, awt.name,
         case when f.status = 'finished' then f.home_score end,
         case when f.status = 'finished' then f.away_score end
    from public.football_user_picks k
    join public.football_fixtures f on f.id = k.fixture_id
    left join public.football_leagues l on l.id = f.league_id
    left join public.football_teams hmt on hmt.id = f.home_team_id
    left join public.football_teams awt on awt.id = f.away_team_id
   where k.user_id = v_uid
     and k.kickoff_at >= v_start and k.kickoff_at < v_end
   order by k.kickoff_at desc, k.market
   limit 2000;
end;
$$;

revoke execute on function public.banter_football_fixtures(date, text, text[]) from public, anon;
revoke execute on function public.banter_football_leagues(date, text) from public, anon;
revoke execute on function public.banter_submit_football_pick(uuid, text, text) from public, anon;
revoke execute on function public.banter_cancel_football_pick(uuid, text) from public, anon;
revoke execute on function public.banter_my_football_picks(date, text) from public, anon;
grant execute on function public.banter_football_fixtures(date, text, text[]) to authenticated, service_role;
grant execute on function public.banter_football_leagues(date, text) to authenticated, service_role;
grant execute on function public.banter_submit_football_pick(uuid, text, text) to authenticated, service_role;
grant execute on function public.banter_cancel_football_pick(uuid, text) to authenticated, service_role;
grant execute on function public.banter_my_football_picks(date, text) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. The SECURITY DEFINER RPCs show the warning class
-- "Signed-In Users Can Execute SECURITY DEFINER"; each checks has_banter_access() before returning
-- or writing anything.

-- ROLLBACK:
--   drop function if exists public.banter_my_football_picks(date, text);
--   drop function if exists public.banter_cancel_football_pick(uuid, text);
--   drop function if exists public.banter_submit_football_pick(uuid, text, text);
--   drop function if exists public.banter_football_leagues(date, text);
--   drop function if exists public.banter_football_fixtures(date, text, text[]);
--   drop function if exists public.banter_safe_tz(text);
--   drop table if exists public.football_user_picks;
