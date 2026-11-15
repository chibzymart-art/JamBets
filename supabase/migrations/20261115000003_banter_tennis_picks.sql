-- Banter Hub: members' tennis picks (match winner), and leaderboards that count football + tennis.
-- Additive only. Reads tennis_fixtures / tennis_players / tennis_tournaments / tennis_predictions;
-- never writes to them. Nothing in the Predictions Hub changes. No foreign keys to football tables.
-- Needs the earlier Banter migrations applied (has_banter_access, player_profiles, football_user_picks,
-- banter_leaderboard, banter_leagues / banter_league_members).
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Pickable matches = tennis fixtures the main system has published a prediction for
-- (tennis_predictions.publication_status = 'published') on the chosen local date. Nothing from the
-- AI prediction is exposed. One market for members: match winner (MW), selection p1 or p2.
-- Picks lock 60 seconds before the scheduled start. Marking won/lost/void is done by the Banter
-- settle job (python/src/banter/tennis_settlement.py) from results the main system already stores.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.tennis_user_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  fixture_id uuid not null references public.tennis_fixtures(id) on delete cascade,
  market text not null default 'MW',
  selection text not null,
  kickoff_at timestamptz not null,
  status text not null default 'pending',
  points numeric(4,1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint tennis_user_picks_market_check check (market = 'MW'),
  constraint tennis_user_picks_selection_check check (selection in ('p1', 'p2')),
  constraint tennis_user_picks_status_check check (status in ('pending', 'won', 'lost', 'void')),
  constraint tennis_user_picks_one_per_market unique (user_id, fixture_id, market)
);

create index if not exists tennis_user_picks_user_kickoff_idx on public.tennis_user_picks (user_id, kickoff_at desc);
create index if not exists tennis_user_picks_fixture_idx on public.tennis_user_picks (fixture_id);
create index if not exists tennis_user_picks_pending_idx on public.tennis_user_picks (kickoff_at) where status = 'pending';

alter table public.tennis_user_picks enable row level security;

revoke all on table public.tennis_user_picks from anon, authenticated;
grant select, insert, update, delete on table public.tennis_user_picks to service_role;
grant select on table public.tennis_user_picks to authenticated;

-- Same as football picks: members with access can read picks; no write policy (RPCs only).
create policy "tennis_user_picks_select_with_access" on public.tennis_user_picks
  for select to authenticated
  using ((select public.has_banter_access()));

-- ---------------------------------------------------------------------------
-- 2. RPCs
-- ---------------------------------------------------------------------------

-- Pickable tennis matches for one local date. Score and winner side only once the match is over.
create or replace function public.banter_tennis_fixtures(p_date date, p_tz text default 'Africa/Lagos')
returns table (
  fixture_id uuid,
  kickoff_at timestamptz,
  status text,
  tournament_name text,
  tour text,
  category text,
  round text,
  player1 text,
  player2 text,
  p1_sets integer,
  p2_sets integer,
  winner text
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
         t.name,
         t.tour,
         t.category,
         f.round,
         p1.display_name,
         p2.display_name,
         case when f.status in ('finished', 'retired', 'walkover') then f.score_p1_sets end,
         case when f.status in ('finished', 'retired', 'walkover') then f.score_p2_sets end,
         case
           when f.status not in ('finished', 'retired', 'walkover') then null
           when f.winner_id = f.player1_id then 'p1'
           when f.winner_id = f.player2_id then 'p2'
         end
    from public.tennis_fixtures f
    join public.tennis_tournaments t on t.id = f.tournament_id
    left join public.tennis_players p1 on p1.id = f.player1_id
    left join public.tennis_players p2 on p2.id = f.player2_id
   where f.target_kickoff_at >= v_start
     and f.target_kickoff_at < v_start + interval '1 day'
     and exists (
       select 1 from public.tennis_predictions p
        where p.fixture_id = f.id and p.publication_status = 'published'
     )
   order by f.target_kickoff_at, t.name, p1.display_name
   limit 400;
end;
$$;

-- Make or change a tennis pick. Errors: not_signed_in, no_access, no_profile, selection_invalid,
-- fixture_not_pickable, pick_locked.
create or replace function public.banter_submit_tennis_pick(p_fixture_id uuid, p_selection text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_sel text := lower(btrim(coalesce(p_selection, '')));
  v_kickoff timestamptz;
  v_status text;
  v_row public.tennis_user_picks%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.player_profiles where user_id = v_uid) then raise exception 'no_profile'; end if;
  if v_sel not in ('p1', 'p2') then raise exception 'selection_invalid'; end if;

  select f.target_kickoff_at, f.status into v_kickoff, v_status
    from public.tennis_fixtures f
   where f.id = p_fixture_id
     and exists (select 1 from public.tennis_predictions p where p.fixture_id = f.id and p.publication_status = 'published');

  if v_kickoff is null then raise exception 'fixture_not_pickable'; end if;
  if v_status <> 'scheduled' or now() >= v_kickoff - interval '60 seconds' then raise exception 'pick_locked'; end if;

  insert into public.tennis_user_picks as k (user_id, fixture_id, market, selection, kickoff_at)
  values (v_uid, p_fixture_id, 'MW', v_sel, v_kickoff)
  on conflict (user_id, fixture_id, market) do update
    set selection = excluded.selection,
        kickoff_at = excluded.kickoff_at,
        updated_at = now()
    where k.status = 'pending'
  returning * into v_row;

  if v_row.id is null then raise exception 'pick_locked'; end if;

  return jsonb_build_object('id', v_row.id, 'fixture_id', v_row.fixture_id, 'selection', v_row.selection,
                            'kickoff_at', v_row.kickoff_at, 'status', v_row.status);
end;
$$;

-- Remove a tennis pick before it locks. Returns true when removed.
create or replace function public.banter_cancel_tennis_pick(p_fixture_id uuid)
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

  select k.kickoff_at into v_kickoff from public.tennis_user_picks k
   where k.user_id = v_uid and k.fixture_id = p_fixture_id and k.market = 'MW';
  if v_kickoff is null then return false; end if;
  if now() >= v_kickoff - interval '60 seconds' then raise exception 'pick_locked'; end if;

  delete from public.tennis_user_picks k
   where k.user_id = v_uid and k.fixture_id = p_fixture_id and k.market = 'MW' and k.status = 'pending';
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- The caller's tennis picks. With a date: that local day. Without: the last 60 days (up to 2000).
create or replace function public.banter_my_tennis_picks(p_date date default null, p_tz text default 'Africa/Lagos')
returns table (
  id uuid,
  fixture_id uuid,
  selection text,
  kickoff_at timestamptz,
  status text,
  points numeric,
  settled_at timestamptz,
  fixture_status text,
  tournament_name text,
  player1 text,
  player2 text,
  p1_sets integer,
  p2_sets integer
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
  select k.id, k.fixture_id, k.selection, k.kickoff_at, k.status, k.points, k.settled_at,
         f.status, t.name, p1.display_name, p2.display_name,
         case when f.status in ('finished', 'retired', 'walkover') then f.score_p1_sets end,
         case when f.status in ('finished', 'retired', 'walkover') then f.score_p2_sets end
    from public.tennis_user_picks k
    join public.tennis_fixtures f on f.id = k.fixture_id
    left join public.tennis_tournaments t on t.id = f.tournament_id
    left join public.tennis_players p1 on p1.id = f.player1_id
    left join public.tennis_players p2 on p2.id = f.player2_id
   where k.user_id = v_uid and k.kickoff_at >= v_start and k.kickoff_at < v_end
   order by k.kickoff_at desc
   limit 2000;
end;
$$;

revoke execute on function public.banter_tennis_fixtures(date, text) from public, anon;
revoke execute on function public.banter_submit_tennis_pick(uuid, text) from public, anon;
revoke execute on function public.banter_cancel_tennis_pick(uuid) from public, anon;
revoke execute on function public.banter_my_tennis_picks(date, text) from public, anon;
grant execute on function public.banter_tennis_fixtures(date, text) to authenticated, service_role;
grant execute on function public.banter_submit_tennis_pick(uuid, text) to authenticated, service_role;
grant execute on function public.banter_cancel_tennis_pick(uuid) to authenticated, service_role;
grant execute on function public.banter_my_tennis_picks(date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Leaderboards count every sport (football + tennis). Same signatures and columns as before,
--    so CREATE OR REPLACE keeps the website working unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.banter_leaderboard(p_period text default 'week', p_limit integer default 50)
returns table (
  place integer,
  handle text,
  avatar_emoji text,
  points numeric,
  won integer,
  lost integer,
  voided integer,
  settled integer,
  hit_rate numeric,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_period text := lower(coalesce(p_period, 'week'));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_local timestamp := (now() at time zone 'Africa/Lagos');
  v_since timestamptz;
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;

  if v_period = 'week' then
    v_since := (date_trunc('week', v_local)) at time zone 'Africa/Lagos';
  elsif v_period = 'month' then
    v_since := (date_trunc('month', v_local)) at time zone 'Africa/Lagos';
  else
    v_since := '-infinity'::timestamptz;
  end if;

  return query
  with all_picks as (
    select fp.user_id, fp.status, fp.points, fp.created_at, fp.kickoff_at from public.football_user_picks fp
    union all
    select tp.user_id, tp.status, tp.points, tp.created_at, tp.kickoff_at from public.tennis_user_picks tp
  ),
  totals as (
    select k.user_id,
           sum(coalesce(k.points, 0))::numeric as pts,
           count(*) filter (where k.status = 'won')::integer as w,
           count(*) filter (where k.status = 'lost')::integer as l,
           count(*) filter (where k.status = 'void')::integer as v,
           count(*)::integer as s,
           min(k.created_at) as first_pick
      from all_picks k
     where k.status in ('won', 'lost', 'void')
       and k.kickoff_at >= v_since
     group by k.user_id
  ),
  ranked as (
    select t.*,
           pp.handle as h,
           pp.avatar_emoji as a,
           case when t.w + t.l > 0 then round(t.w::numeric * 100 / (t.w + t.l), 1) else 0 end as hr,
           row_number() over (
             order by t.pts desc,
                      case when t.w + t.l > 0 then t.w::numeric / (t.w + t.l) else 0 end desc,
                      t.s desc,
                      t.first_pick asc
           )::integer as rk
      from totals t
      join public.player_profiles pp on pp.user_id = t.user_id
     where not pp.leaderboard_banned
  )
  select r.rk, r.h, r.a, r.pts, r.w, r.l, r.v, r.s, r.hr, (r.user_id = v_uid)
    from ranked r
   where r.rk <= v_limit or r.user_id = v_uid
   order by r.rk;
end;
$$;

create or replace function public.banter_league_table(p_league_id uuid, p_period text default 'week')
returns table (
  place integer,
  handle text,
  avatar_emoji text,
  points numeric,
  won integer,
  lost integer,
  voided integer,
  settled integer,
  hit_rate numeric,
  is_me boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_period text := lower(coalesce(p_period, 'week'));
  v_local timestamp := (now() at time zone 'Africa/Lagos');
  v_since timestamptz;
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;
  if not exists (select 1 from public.banter_league_members where league_id = p_league_id and user_id = v_uid) then
    return;
  end if;

  if v_period = 'week' then
    v_since := (date_trunc('week', v_local)) at time zone 'Africa/Lagos';
  elsif v_period = 'month' then
    v_since := (date_trunc('month', v_local)) at time zone 'Africa/Lagos';
  else
    v_since := '-infinity'::timestamptz;
  end if;

  return query
  with members as (
    select m.user_id from public.banter_league_members m where m.league_id = p_league_id
  ),
  all_picks as (
    select fp.id, fp.user_id, fp.status, fp.points, fp.created_at, fp.kickoff_at from public.football_user_picks fp
    union all
    select tp.id, tp.user_id, tp.status, tp.points, tp.created_at, tp.kickoff_at from public.tennis_user_picks tp
  ),
  totals as (
    select mb.user_id,
           coalesce(sum(k.points), 0)::numeric as pts,
           count(k.id) filter (where k.status = 'won')::integer as w,
           count(k.id) filter (where k.status = 'lost')::integer as l,
           count(k.id) filter (where k.status = 'void')::integer as v,
           count(k.id)::integer as s,
           min(k.created_at) as first_pick
      from members mb
      left join all_picks k
        on k.user_id = mb.user_id
       and k.status in ('won', 'lost', 'void')
       and k.kickoff_at >= v_since
     group by mb.user_id
  ),
  ranked as (
    select t.*,
           pp.handle as h,
           pp.avatar_emoji as a,
           case when t.w + t.l > 0 then round(t.w::numeric * 100 / (t.w + t.l), 1) else 0 end as hr,
           row_number() over (
             order by t.pts desc,
                      case when t.w + t.l > 0 then t.w::numeric / (t.w + t.l) else 0 end desc,
                      t.s desc,
                      t.first_pick asc nulls last,
                      pp.handle asc
           )::integer as rk
      from totals t
      join public.player_profiles pp on pp.user_id = t.user_id
     where not pp.leaderboard_banned
  )
  select r.rk, r.h, r.a, r.pts, r.w, r.l, r.v, r.s, r.hr, (r.user_id = v_uid)
    from ranked r
   order by r.rk;
end;
$$;

-- Privileges on the replaced functions are kept by CREATE OR REPLACE; restated here for clarity.
revoke execute on function public.banter_leaderboard(text, integer) from public, anon;
revoke execute on function public.banter_league_table(uuid, text) from public, anon;
grant execute on function public.banter_leaderboard(text, integer) to authenticated, service_role;
grant execute on function public.banter_league_table(uuid, text) to authenticated, service_role;

-- Expected Security Advisor result: no new errors; four more of the accepted warning class
-- "Signed-In Users Can Execute SECURITY DEFINER" (each checks has_banter_access() first).

-- ROLLBACK:
--   1. Restore football-only leaderboards by re-running the banter_leaderboard function from
--      20261114000003_banter_leaderboard.sql and the banter_league_table function from
--      20261115000001_banter_leagues.sql.
--   2. drop function if exists public.banter_my_tennis_picks(date, text);
--      drop function if exists public.banter_cancel_tennis_pick(uuid);
--      drop function if exists public.banter_submit_tennis_pick(uuid, text);
--      drop function if exists public.banter_tennis_fixtures(date, text);
--      drop table if exists public.tennis_user_picks;
