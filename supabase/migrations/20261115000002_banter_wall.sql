-- Banter Hub: the wall (public wall for all paid members, plus one wall per private league).
-- Additive only. New table and functions; nothing in the Predictions Hub changes.
-- Needs the earlier Banter migrations applied (has_banter_access, player_profiles, banter_leagues).
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules:
--   * Paid members only (has_banter_access); posting needs a Banter username (player_profiles row).
--   * league_id null = public wall (all paid members). A league_id = that league's wall, members only.
--   * Plain text, 1 to 280 characters after trimming. The website renders it as text (no HTML/links).
--   * Rate limits per member: 1 post per 10 seconds, 60 posts per day (rolling 24 hours).
--   * Members with leaderboard_banned cannot post, and their posts are hidden.
--   * Delete = soft delete (deleted_at, deleted_by), by the author or an admin (public.is_admin()).
--   * No direct table access for anyone but the service role; everything goes through the RPCs.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.banter_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  league_id uuid references public.banter_leagues(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete set null,
  constraint banter_posts_body_length check (char_length(btrim(body)) between 1 and 280)
);

create index if not exists banter_posts_public_idx
  on public.banter_posts (created_at desc) where league_id is null and deleted_at is null;
create index if not exists banter_posts_league_idx
  on public.banter_posts (league_id, created_at desc) where league_id is not null and deleted_at is null;
create index if not exists banter_posts_user_idx
  on public.banter_posts (user_id, created_at desc);

alter table public.banter_posts enable row level security;

revoke all on table public.banter_posts from anon, authenticated;
grant select, insert, update, delete on table public.banter_posts to service_role;
-- No policies: no direct access for anon or signed-in users.

-- ---------------------------------------------------------------------------
-- 2. RPCs
-- ---------------------------------------------------------------------------

-- Errors (message = code): not_signed_in, no_access, no_profile, banned, body_invalid,
-- not_member, too_fast, daily_limit, post_not_found, not_allowed.

create or replace function public.banter_post(p_body text, p_league_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_banned boolean;
  v_id uuid;
  v_created timestamptz;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;

  select pp.leaderboard_banned into v_banned from public.player_profiles pp where pp.user_id = v_uid;
  if not found then raise exception 'no_profile'; end if;
  if v_banned then raise exception 'banned'; end if;

  if char_length(v_body) < 1 or char_length(v_body) > 280 then raise exception 'body_invalid'; end if;

  if p_league_id is not null and not exists (
    select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = v_uid
  ) then
    raise exception 'not_member';
  end if;

  if exists (
    select 1 from public.banter_posts p
     where p.user_id = v_uid and p.created_at > now() - interval '10 seconds'
  ) then
    raise exception 'too_fast';
  end if;
  if (select count(*) from public.banter_posts p
       where p.user_id = v_uid and p.created_at > now() - interval '24 hours') >= 60 then
    raise exception 'daily_limit';
  end if;

  insert into public.banter_posts (user_id, league_id, body)
  values (v_uid, p_league_id, v_body)
  returning id, created_at into v_id, v_created;

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

-- Soft-delete a post: its author, or an admin. Returns true when a post was hidden.
create or replace function public.banter_delete_post(p_post_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author uuid;
  v_deleted timestamptz;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;

  select p.user_id, p.deleted_at into v_author, v_deleted from public.banter_posts p where p.id = p_post_id;
  if v_author is null then raise exception 'post_not_found'; end if;
  if v_author <> v_uid and not coalesce(public.is_admin(), false) then raise exception 'not_allowed'; end if;
  if v_deleted is not null then return false; end if;

  update public.banter_posts
     set deleted_at = now(), deleted_by = v_uid
   where id = p_post_id and deleted_at is null;
  return true;
end;
$$;

-- A wall, newest first. league_id null = public wall; otherwise that league's wall (members only).
-- Pass the created_at of the last post shown as p_before to load older posts.
create or replace function public.banter_wall(
  p_league_id uuid default null,
  p_before timestamptz default null,
  p_limit integer default 30
)
returns table (
  id uuid,
  handle text,
  avatar_emoji text,
  body text,
  created_at timestamptz,
  is_me boolean,
  can_delete boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_admin boolean;
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;
  if p_league_id is not null and not exists (
    select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = v_uid
  ) then
    return;
  end if;

  v_admin := coalesce(public.is_admin(), false);

  return query
  select p.id, pp.handle, pp.avatar_emoji, p.body, p.created_at,
         (p.user_id = v_uid),
         (p.user_id = v_uid or v_admin)
    from public.banter_posts p
    join public.player_profiles pp on pp.user_id = p.user_id
   where p.deleted_at is null
     and not pp.leaderboard_banned
     and (case when p_league_id is null then p.league_id is null else p.league_id = p_league_id end)
     and (p_before is null or p.created_at < p_before)
   order by p.created_at desc
   limit v_limit;
end;
$$;

revoke execute on function public.banter_post(text, uuid) from public, anon;
revoke execute on function public.banter_delete_post(uuid) from public, anon;
revoke execute on function public.banter_wall(uuid, timestamptz, integer) from public, anon;
grant execute on function public.banter_post(text, uuid) to authenticated, service_role;
grant execute on function public.banter_delete_post(uuid) to authenticated, service_role;
grant execute on function public.banter_wall(uuid, timestamptz, integer) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. banter_posts has RLS on with no policies
-- (informational "RLS Enabled No Policy", intended: no direct access). The three RPCs show the
-- accepted warning class "Signed-In Users Can Execute SECURITY DEFINER"; each checks
-- has_banter_access() first.

-- ROLLBACK:
--   drop function if exists public.banter_wall(uuid, timestamptz, integer);
--   drop function if exists public.banter_delete_post(uuid);
--   drop function if exists public.banter_post(text, uuid);
--   drop table if exists public.banter_posts;
