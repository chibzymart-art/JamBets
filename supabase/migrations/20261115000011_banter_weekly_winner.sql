-- Banter Hub: weekly winner crowns, and streaks on profiles.
-- Additive only: two small tables and new functions, read-only over the Banter picks; nothing in the
-- Predictions Hub (or its workflows) changes. Needs the Banter migrations up to 20261115000010.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner):
--   * The week is Monday 00:00 to Sunday 23:59 Lagos time (the leaderboard's 'week', by kickoff).
--   * After a week ends, the top member of the overall leaderboard and the top member of each league
--     for that week win a crown, shown next to their name (leaderboard, that league's table, their
--     profile) for the following week. Winners need at least 3 settled picks that week. Same ranking
--     as the leaderboard: points, hit rate, more settled picks, earlier first pick. Banned members
--     never win.
--   * Results are frozen once, 12 hours after the week ends (so late Sunday matches are settled
--     first), by banter_compute_weekly_winners(), which the read functions call lazily. No workflow
--     or Predictions Hub job is involved.
--   * Streaks: current and best run of consecutive won picks (voids neither break nor extend a run),
--     plus weeks won.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.banter_weekly_winners (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,               -- the Monday (Lagos) the week began
  scope text not null,                    -- 'overall' | 'league'
  league_id uuid references public.banter_leagues(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  points numeric not null,
  settled integer not null,
  created_at timestamptz not null default now(),
  constraint banter_weekly_winners_scope check (
    (scope = 'overall' and league_id is null) or (scope = 'league' and league_id is not null))
);
create unique index if not exists banter_weekly_winners_one_per_scope
  on public.banter_weekly_winners (week_start, scope, coalesce(league_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists banter_weekly_winners_user_idx on public.banter_weekly_winners (user_id, week_start desc);

-- Weeks already computed (so a week with no qualifying winner is not recomputed).
create table if not exists public.banter_weeks_computed (
  week_start date primary key,
  computed_at timestamptz not null default now()
);

alter table public.banter_weekly_winners enable row level security;
alter table public.banter_weeks_computed enable row level security;
revoke all on table public.banter_weekly_winners from anon, authenticated;
revoke all on table public.banter_weeks_computed from anon, authenticated;
grant select, insert, update, delete on table public.banter_weekly_winners to service_role;
grant select, insert, update, delete on table public.banter_weeks_computed to service_role;
-- No policies: no direct access for anon or signed-in users.

-- ---------------------------------------------------------------------------
-- 2. Compute (internal; called lazily by the read functions)
-- ---------------------------------------------------------------------------
create or replace function public.banter_compute_weekly_winners()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_local timestamp := (now() at time zone 'Africa/Lagos');
  v_week date := (date_trunc('week', v_local) - interval '7 days')::date;   -- last completed week
  v_from timestamptz := (v_week::timestamp) at time zone 'Africa/Lagos';
  v_to timestamptz := ((v_week + 7)::timestamp) at time zone 'Africa/Lagos';
  v_n integer := 0;
begin
  if now() < v_to + interval '12 hours' then return 0; end if;             -- not frozen yet
  if exists (select 1 from public.banter_weeks_computed w where w.week_start = v_week) then return 0; end if;

  -- Only one caller computes a week (others return straight away).
  if not pg_try_advisory_xact_lock(hashtext('banter_weekly_winners'), (v_week - date '2000-01-01')) then return 0; end if;
  if exists (select 1 from public.banter_weeks_computed w where w.week_start = v_week) then return 0; end if;

  -- Overall winner.
  insert into public.banter_weekly_winners (week_start, scope, league_id, user_id, points, settled)
  select v_week, 'overall', null, x.user_id, x.pts, x.s
    from (
      select k.user_id,
             sum(coalesce(k.points, 0))::numeric as pts,
             count(*) filter (where k.status = 'won') as w,
             count(*) filter (where k.status = 'lost') as l,
             count(*)::integer as s,
             min(k.created_at) as first_pick
        from public.football_user_picks k
        join public.player_profiles pp on pp.user_id = k.user_id and not pp.leaderboard_banned
       where k.status in ('won', 'lost', 'void') and k.kickoff_at >= v_from and k.kickoff_at < v_to
       group by k.user_id
      having count(*) >= 3
    ) x
   order by x.pts desc,
            case when x.w + x.l > 0 then x.w::numeric / (x.w + x.l) else 0 end desc,
            x.s desc,
            x.first_pick asc
   limit 1
  on conflict do nothing;
  get diagnostics v_n = row_count;

  -- One winner per league (members' picks that week, same ranking).
  insert into public.banter_weekly_winners (week_start, scope, league_id, user_id, points, settled)
  select v_week, 'league', z.league_id, z.user_id, z.pts, z.s
    from (
      select m.league_id, k.user_id,
             sum(coalesce(k.points, 0))::numeric as pts,
             count(*)::integer as s,
             row_number() over (
               partition by m.league_id
               order by sum(coalesce(k.points, 0)) desc,
                        case when count(*) filter (where k.status in ('won', 'lost')) > 0
                             then (count(*) filter (where k.status = 'won'))::numeric
                                  / (count(*) filter (where k.status in ('won', 'lost')))
                             else 0 end desc,
                        count(*) desc,
                        min(k.created_at) asc
             ) as rk
        from public.banter_league_members m
        join public.player_profiles pp on pp.user_id = m.user_id and not pp.leaderboard_banned
        join public.football_user_picks k on k.user_id = m.user_id
       where k.status in ('won', 'lost', 'void') and k.kickoff_at >= v_from and k.kickoff_at < v_to
       group by m.league_id, k.user_id
      having count(*) >= 3
    ) z
   where z.rk = 1
  on conflict do nothing;

  insert into public.banter_weeks_computed (week_start) values (v_week) on conflict do nothing;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Read: this week's crowns (winners of the last completed week)
-- ---------------------------------------------------------------------------
-- { week_start, overall: handle | null, leagues: { "<league_id>": handle } } for the caller's leagues.
create or replace function public.banter_crowns()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_week date := (date_trunc('week', (now() at time zone 'Africa/Lagos')) - interval '7 days')::date;
begin
  if v_uid is null or not public.has_banter_access() then
    return jsonb_build_object('week_start', null, 'overall', null, 'leagues', '{}'::jsonb);
  end if;
  perform public.banter_compute_weekly_winners();

  return jsonb_build_object(
    'week_start', v_week,
    'overall', (select pp.handle from public.banter_weekly_winners w
                  join public.player_profiles pp on pp.user_id = w.user_id and not pp.leaderboard_banned
                 where w.week_start = v_week and w.scope = 'overall'),
    'leagues', coalesce((
      select jsonb_object_agg(w.league_id::text, pp.handle)
        from public.banter_weekly_winners w
        join public.player_profiles pp on pp.user_id = w.user_id and not pp.leaderboard_banned
        join public.banter_league_members me on me.league_id = w.league_id and me.user_id = v_uid
       where w.week_start = v_week and w.scope = 'league'), '{}'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Read: the caller's streaks, weeks won and current crowns (for the profile)
-- ---------------------------------------------------------------------------
create or replace function public.banter_my_streaks()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_week date := (date_trunc('week', (now() at time zone 'Africa/Lagos')) - interval '7 days')::date;
  v_current integer := 0;
  v_best integer := 0;
begin
  if v_uid is null or not public.has_banter_access() then
    return null;
  end if;
  perform public.banter_compute_weekly_winners();

  -- Runs of won picks in settle order (by kickoff); a lost pick starts a new group; voids are skipped.
  with seq as (
    select k.status,
           sum(case when k.status = 'lost' then 1 else 0 end) over (order by k.kickoff_at, k.created_at, k.id) as grp
      from public.football_user_picks k
     where k.user_id = v_uid and k.status in ('won', 'lost')
  ), runs as (
    select grp, count(*) filter (where status = 'won')::integer as wins from seq group by grp
  )
  select coalesce(max(wins), 0),
         coalesce((select r.wins from runs r order by r.grp desc limit 1), 0)
    into v_best, v_current
    from runs;

  return jsonb_build_object(
    'current_streak', v_current,
    'best_streak', v_best,
    'weeks_won', (select count(*) from public.banter_weekly_winners w where w.user_id = v_uid and w.scope = 'overall'),
    'league_weeks_won', (select count(*) from public.banter_weekly_winners w where w.user_id = v_uid and w.scope = 'league'),
    'crown_overall', exists (select 1 from public.banter_weekly_winners w
                              where w.user_id = v_uid and w.week_start = v_week and w.scope = 'overall'),
    'crown_leagues', coalesce((select jsonb_agg(l.name order by l.name)
                                 from public.banter_weekly_winners w
                                 join public.banter_leagues l on l.id = w.league_id
                                 join public.banter_league_members m on m.league_id = w.league_id and m.user_id = v_uid
                                where w.user_id = v_uid and w.week_start = v_week and w.scope = 'league'), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.banter_compute_weekly_winners() from public, anon, authenticated;
revoke execute on function public.banter_crowns() from public, anon;
revoke execute on function public.banter_my_streaks() from public, anon;
grant execute on function public.banter_compute_weekly_winners() to service_role;
grant execute on function public.banter_crowns() to authenticated, service_role;
grant execute on function public.banter_my_streaks() to authenticated, service_role;

-- Expected Security Advisor result: no new errors. The two tables have RLS on with no policies
-- (informational, intended). banter_crowns and banter_my_streaks show the accepted "Signed-In Users
-- Can Execute SECURITY DEFINER" warning (both check has_banter_access() first).
-- banter_compute_weekly_winners is not executable by anon or signed-in users.

-- ROLLBACK:
--   drop function if exists public.banter_my_streaks();
--   drop function if exists public.banter_crowns();
--   drop function if exists public.banter_compute_weekly_winners();
--   drop table if exists public.banter_weeks_computed;
--   drop table if exists public.banter_weekly_winners;
