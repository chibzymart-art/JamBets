-- Banter Hub step 5: private leagues (create, invite code, join, leave, league table).
-- Additive only. New Banter tables and functions; reads football_user_picks / player_profiles.
-- Nothing in the Predictions Hub changes. Needs the three earlier Banter migrations applied first.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules:
--   * Paid members only (has_banter_access) with a Banter username (player_profiles row).
--   * No direct table access for anyone but the service role; everything goes through the RPCs below.
--   * Caps: a member can be in at most 20 leagues; a league holds at most 200 members.
--   * The owner leaving deletes the league (simplest; members' picks and points are untouched,
--     because league tables are computed from football_user_picks on the fly).
--   * A league table uses the same columns and ranking as banter_leaderboard, limited to the league's
--     members, and lists every member (members with no settled picks show 0). Members only.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.banter_leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.users(id) on delete cascade,
  invite_code text not null,
  created_at timestamptz not null default now(),
  constraint banter_leagues_name_length check (char_length(btrim(name)) between 3 and 40),
  constraint banter_leagues_invite_code_format check (invite_code ~ '^[A-Z0-9]{8}$'),
  constraint banter_leagues_invite_code_key unique (invite_code)
);

create table if not exists public.banter_league_members (
  league_id uuid not null references public.banter_leagues(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create index if not exists banter_league_members_user_idx on public.banter_league_members (user_id);
create index if not exists banter_leagues_owner_idx on public.banter_leagues (owner_id);

alter table public.banter_leagues enable row level security;
alter table public.banter_league_members enable row level security;

revoke all on table public.banter_leagues from anon, authenticated;
revoke all on table public.banter_league_members from anon, authenticated;
grant select, insert, update, delete on table public.banter_leagues to service_role;
grant select, insert, update, delete on table public.banter_league_members to service_role;
-- No policies: with RLS on and no grants, anon and signed-in users cannot touch these tables directly.

-- ---------------------------------------------------------------------------
-- 2. RPCs
-- ---------------------------------------------------------------------------

-- Errors (message = code): not_signed_in, no_access, no_profile, name_invalid, too_many_leagues,
-- league_not_found, league_full, not_member.

create or replace function public.banter_create_league(p_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_code text;
  v_id uuid;
  v_try integer := 0;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.player_profiles where user_id = v_uid) then raise exception 'no_profile'; end if;
  if char_length(v_name) < 3 or char_length(v_name) > 40 then raise exception 'name_invalid'; end if;
  if (select count(*) from public.banter_league_members where user_id = v_uid) >= 20 then
    raise exception 'too_many_leagues';
  end if;

  loop
    v_try := v_try + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    exit when not exists (select 1 from public.banter_leagues where invite_code = v_code);
    if v_try > 10 then raise exception 'code_generation_failed'; end if;
  end loop;

  insert into public.banter_leagues (name, owner_id, invite_code)
  values (v_name, v_uid, v_code)
  returning id into v_id;

  insert into public.banter_league_members (league_id, user_id) values (v_id, v_uid);

  return jsonb_build_object('league_id', v_id, 'name', v_name, 'invite_code', v_code);
end;
$$;

create or replace function public.banter_join_league(p_invite_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_invite_code, '')));
  v_league public.banter_leagues%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.player_profiles where user_id = v_uid) then raise exception 'no_profile'; end if;

  select * into v_league from public.banter_leagues where invite_code = v_code;
  if v_league.id is null then raise exception 'league_not_found'; end if;

  if exists (select 1 from public.banter_league_members where league_id = v_league.id and user_id = v_uid) then
    return jsonb_build_object('league_id', v_league.id, 'name', v_league.name, 'already_member', true);
  end if;
  if (select count(*) from public.banter_league_members where user_id = v_uid) >= 20 then
    raise exception 'too_many_leagues';
  end if;
  if (select count(*) from public.banter_league_members where league_id = v_league.id) >= 200 then
    raise exception 'league_full';
  end if;

  insert into public.banter_league_members (league_id, user_id) values (v_league.id, v_uid)
  on conflict do nothing;

  return jsonb_build_object('league_id', v_league.id, 'name', v_league.name, 'already_member', false);
end;
$$;

-- Leave a league. The owner leaving deletes the league for everyone. Returns 'left' or 'deleted'.
create or replace function public.banter_leave_league(p_league_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;

  select owner_id into v_owner from public.banter_leagues where id = p_league_id;
  if v_owner is null then raise exception 'league_not_found'; end if;
  if not exists (select 1 from public.banter_league_members where league_id = p_league_id and user_id = v_uid) then
    raise exception 'not_member';
  end if;

  if v_owner = v_uid then
    delete from public.banter_leagues where id = p_league_id;
    return 'deleted';
  end if;

  delete from public.banter_league_members where league_id = p_league_id and user_id = v_uid;
  return 'left';
end;
$$;

create or replace function public.banter_my_leagues()
returns table (
  league_id uuid,
  name text,
  invite_code text,
  is_owner boolean,
  members integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;

  return query
  select l.id, l.name, l.invite_code, (l.owner_id = v_uid),
         (select count(*)::integer from public.banter_league_members m2 where m2.league_id = l.id),
         l.created_at
    from public.banter_leagues l
    join public.banter_league_members m on m.league_id = l.id and m.user_id = v_uid
   order by l.created_at desc;
end;
$$;

-- A league's table for a period ('week' | 'month' | 'all', Lagos time). Members only.
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
  totals as (
    select mb.user_id,
           coalesce(sum(k.points), 0)::numeric as pts,
           count(k.id) filter (where k.status = 'won')::integer as w,
           count(k.id) filter (where k.status = 'lost')::integer as l,
           count(k.id) filter (where k.status = 'void')::integer as v,
           count(k.id)::integer as s,
           min(k.created_at) as first_pick
      from members mb
      left join public.football_user_picks k
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

revoke execute on function public.banter_create_league(text) from public, anon;
revoke execute on function public.banter_join_league(text) from public, anon;
revoke execute on function public.banter_leave_league(uuid) from public, anon;
revoke execute on function public.banter_my_leagues() from public, anon;
revoke execute on function public.banter_league_table(uuid, text) from public, anon;
grant execute on function public.banter_create_league(text) to authenticated, service_role;
grant execute on function public.banter_join_league(text) to authenticated, service_role;
grant execute on function public.banter_leave_league(uuid) to authenticated, service_role;
grant execute on function public.banter_my_leagues() to authenticated, service_role;
grant execute on function public.banter_league_table(uuid, text) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. The two tables have RLS on with no policies
-- ("RLS Enabled No Policy" is informational and intended: no direct access). The five RPCs show the
-- accepted warning class "Signed-In Users Can Execute SECURITY DEFINER"; each checks
-- has_banter_access() first.

-- ROLLBACK:
--   drop function if exists public.banter_league_table(uuid, text);
--   drop function if exists public.banter_my_leagues();
--   drop function if exists public.banter_leave_league(uuid);
--   drop function if exists public.banter_join_league(text);
--   drop function if exists public.banter_create_league(text);
--   drop table if exists public.banter_league_members;
--   drop table if exists public.banter_leagues;
