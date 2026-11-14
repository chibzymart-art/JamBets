-- Banter Hub foundations: who may use it, and each member's username.
-- Additive only. Nothing in the Predictions Hub (tables, views, paywall functions, policies) changes.
--
-- NOT APPLIED. The owner reviews and applies this by hand (there is no migration history table).
-- Before applying, compare with the live catalog as AGENTS.md section 6 rule 3 says, and rerun the
-- Supabase Security Advisor afterwards (Errors must stay 0).
--
-- Access rule (owner): admins, paid members, and free members inside their trial. Visitors and
-- expired trials get nothing from any Banter table or function.
-- has_banter_access() reuses public.is_football_entitled(), the same check the football paywall
-- uses (is_admin() OR is_paid_subscriber() OR a paid users.role OR auth.users.created_at within
-- the 3-day trial), so there is one trial clock, not two.

-- ---------------------------------------------------------------------------
-- 1. Access check
-- ---------------------------------------------------------------------------
create or replace function public.has_banter_access()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and coalesce(public.is_football_entitled(), false);
$$;

revoke execute on function public.has_banter_access() from public, anon;
grant execute on function public.has_banter_access() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Member profiles (username, avatar, ticked leagues)
-- ---------------------------------------------------------------------------
create table if not exists public.player_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  handle text not null,
  avatar_emoji text not null default '⚽',
  followed_leagues text[],
  leaderboard_banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_profiles_handle_format check (handle ~ '^[A-Za-z0-9_]{3,20}$'),
  constraint player_profiles_avatar_length check (char_length(avatar_emoji) between 1 and 8),
  constraint player_profiles_leagues_count check (followed_leagues is null or cardinality(followed_leagues) <= 60)
);

create unique index if not exists player_profiles_handle_lower_key
  on public.player_profiles (lower(handle));

alter table public.player_profiles enable row level security;

-- Grants: start from nothing. Members with access may read the public columns only;
-- followed_leagues and leaderboard_banned are read through get_banter_state() for oneself.
revoke all on table public.player_profiles from anon, authenticated;
grant select, insert, update, delete on table public.player_profiles to service_role;
grant select (user_id, handle, avatar_emoji, created_at) on table public.player_profiles to authenticated;

create policy "player_profiles_select_with_access" on public.player_profiles
  for select to authenticated
  using ((select public.has_banter_access()));

-- No INSERT / UPDATE / DELETE policy for authenticated: writes go only through the RPCs below.

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- The caller's Banter state. The website decides which screen to show from this, failing closed.
create or replace function public.get_banter_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.player_profiles%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('signed_in', false, 'access', false);
  end if;

  if not public.has_banter_access() then
    return jsonb_build_object('signed_in', true, 'access', false);
  end if;

  select * into v_profile from public.player_profiles where user_id = v_uid;

  return jsonb_build_object(
    'signed_in', true,
    'access', true,
    'handle', v_profile.handle,
    'avatar_emoji', v_profile.avatar_emoji,
    'followed_leagues', to_jsonb(v_profile.followed_leagues)
  );
end;
$$;

-- Create or change the caller's username and avatar.
-- Errors (SQLSTATE P0001, message is the code): not_signed_in, no_access, handle_invalid,
-- handle_reserved, handle_taken, avatar_invalid, no_user_row.
create or replace function public.set_banter_profile(p_handle text, p_avatar_emoji text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_handle text := btrim(coalesce(p_handle, ''));
  v_avatar text := nullif(btrim(coalesce(p_avatar_emoji, '')), '');
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not public.has_banter_access() then
    raise exception 'no_access';
  end if;
  if v_handle !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'handle_invalid';
  end if;
  if lower(v_handle) in ('admin', 'administrator', 'oddsbanta', 'support', 'moderator', 'mod', 'staff', 'system', 'root', 'null', 'undefined') then
    raise exception 'handle_reserved';
  end if;
  if v_avatar is not null and char_length(v_avatar) > 8 then
    raise exception 'avatar_invalid';
  end if;
  if not exists (select 1 from public.users u where u.id = v_uid) then
    raise exception 'no_user_row';
  end if;
  if exists (
    select 1 from public.player_profiles p
    where lower(p.handle) = lower(v_handle) and p.user_id <> v_uid
  ) then
    raise exception 'handle_taken';
  end if;

  insert into public.player_profiles as p (user_id, handle, avatar_emoji)
  values (v_uid, v_handle, coalesce(v_avatar, '⚽'))
  on conflict (user_id) do update
    set handle = excluded.handle,
        avatar_emoji = coalesce(v_avatar, p.avatar_emoji),
        updated_at = now();

  return public.get_banter_state();
exception
  when unique_violation then
    raise exception 'handle_taken';
end;
$$;

-- Save the caller's ticked leagues (the league filter on the picks screen). Needs a profile first.
-- Errors: not_signed_in, no_access, no_profile, leagues_invalid.
create or replace function public.set_banter_leagues(p_leagues text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_clean text[];
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not public.has_banter_access() then
    raise exception 'no_access';
  end if;
  if not exists (select 1 from public.player_profiles where user_id = v_uid) then
    raise exception 'no_profile';
  end if;

  select array_agg(distinct btrim(x)) into v_clean
  from unnest(coalesce(p_leagues, '{}'::text[])) as x
  where btrim(x) <> '';

  if v_clean is not null and (
    cardinality(v_clean) > 60
    or exists (select 1 from unnest(v_clean) as y where char_length(y) > 80)
  ) then
    raise exception 'leagues_invalid';
  end if;

  update public.player_profiles
     set followed_leagues = v_clean, updated_at = now()
   where user_id = v_uid;

  return public.get_banter_state();
end;
$$;

revoke execute on function public.get_banter_state() from public, anon;
revoke execute on function public.set_banter_profile(text, text) from public, anon;
revoke execute on function public.set_banter_leagues(text[]) from public, anon;
grant execute on function public.get_banter_state() to authenticated, service_role;
grant execute on function public.set_banter_profile(text, text) to authenticated, service_role;
grant execute on function public.set_banter_leagues(text[]) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. The three RPCs will show the already-accepted
-- warning class "Signed-In Users Can Execute SECURITY DEFINER"; each checks has_banter_access()
-- first. has_banter_access() is SECURITY INVOKER.

-- ROLLBACK:
--   drop function if exists public.set_banter_leagues(text[]);
--   drop function if exists public.set_banter_profile(text, text);
--   drop function if exists public.get_banter_state();
--   drop table if exists public.player_profiles;
--   drop function if exists public.has_banter_access();
