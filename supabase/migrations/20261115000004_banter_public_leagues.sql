-- Banter Hub: public and private leagues.
-- Additive only (one new column, new functions, two Banter functions recreated). Nothing in the
-- Predictions Hub changes. Needs 20261115000001_banter_leagues.sql applied.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner):
--   * When creating a league the member chooses public or private. Existing leagues stay private.
--   * Public leagues are listed for every paid member to join or leave at will.
--   * Private leagues stay hidden: only members see them; others join with the invite code or link.
--   * Only the league's creator can switch it between public and private.
--   * The public list never shows the invite code of a league the caller is not in.
--   * Same caps as before: 20 leagues per member, 200 members per league.

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
alter table public.banter_leagues add column if not exists is_public boolean not null default false;

create index if not exists banter_leagues_public_idx on public.banter_leagues (created_at desc) where is_public;

-- ---------------------------------------------------------------------------
-- 2. Create league with a public / private choice.
--    The one-argument version is replaced; p_is_public defaults to false, so a call with only
--    p_name (the website before this change) keeps working and creates a private league.
-- ---------------------------------------------------------------------------
drop function if exists public.banter_create_league(text);

create or replace function public.banter_create_league(p_name text, p_is_public boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_public boolean := coalesce(p_is_public, false);
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

  insert into public.banter_leagues (name, owner_id, invite_code, is_public)
  values (v_name, v_uid, v_code, v_public)
  returning id into v_id;

  insert into public.banter_league_members (league_id, user_id) values (v_id, v_uid);

  return jsonb_build_object('league_id', v_id, 'name', v_name, 'invite_code', v_code, 'is_public', v_public);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. My leagues now include is_public (return type changes, so drop and recreate).
-- ---------------------------------------------------------------------------
drop function if exists public.banter_my_leagues();

create or replace function public.banter_my_leagues()
returns table (
  league_id uuid,
  name text,
  invite_code text,
  is_owner boolean,
  members integer,
  created_at timestamptz,
  is_public boolean
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
         l.created_at, l.is_public
    from public.banter_leagues l
    join public.banter_league_members m on m.league_id = l.id and m.user_id = v_uid
   order by l.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. New functions
-- ---------------------------------------------------------------------------

-- Creator only: make a league public or private. Errors: not_signed_in, no_access, league_not_found,
-- not_owner.
create or replace function public.banter_set_league_public(p_league_id uuid, p_is_public boolean)
returns boolean
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
  if v_owner <> v_uid then raise exception 'not_owner'; end if;

  update public.banter_leagues set is_public = coalesce(p_is_public, false) where id = p_league_id;
  return coalesce(p_is_public, false);
end;
$$;

-- Public leagues for browsing. Never returns invite codes. p_order: 'newest' (default) or 'biggest'.
create or replace function public.banter_public_leagues(
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0,
  p_order text default 'newest'
)
returns table (
  league_id uuid,
  name text,
  creator_handle text,
  members integer,
  is_member boolean,
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
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_biggest boolean := lower(coalesce(p_order, 'newest')) = 'biggest';
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;

  return query
  with pub as (
    select l.id, l.name, l.created_at,
           pp.handle as creator,
           (select count(*)::integer from public.banter_league_members m where m.league_id = l.id) as n,
           exists (select 1 from public.banter_league_members m where m.league_id = l.id and m.user_id = v_uid) as mine
      from public.banter_leagues l
      left join public.player_profiles pp on pp.user_id = l.owner_id
     where l.is_public
       and (v_search is null or l.name ilike '%' || replace(replace(v_search, '%', ''), '_', '') || '%')
  )
  select p.id, p.name, p.creator, p.n, p.mine, p.created_at
    from pub p
   order by case when v_biggest then p.n end desc nulls last, p.created_at desc
   limit v_limit offset v_offset;
end;
$$;

-- Join a public league from the list. Private leagues are refused as not found (they stay hidden).
-- Errors: not_signed_in, no_access, no_profile, league_not_found, too_many_leagues, league_full.
create or replace function public.banter_join_public_league(p_league_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_league public.banter_leagues%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.player_profiles where user_id = v_uid) then raise exception 'no_profile'; end if;

  select * into v_league from public.banter_leagues where id = p_league_id and is_public;
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

revoke execute on function public.banter_create_league(text, boolean) from public, anon;
revoke execute on function public.banter_my_leagues() from public, anon;
revoke execute on function public.banter_set_league_public(uuid, boolean) from public, anon;
revoke execute on function public.banter_public_leagues(text, integer, integer, text) from public, anon;
revoke execute on function public.banter_join_public_league(uuid) from public, anon;
grant execute on function public.banter_create_league(text, boolean) to authenticated, service_role;
grant execute on function public.banter_my_leagues() to authenticated, service_role;
grant execute on function public.banter_set_league_public(uuid, boolean) to authenticated, service_role;
grant execute on function public.banter_public_leagues(text, integer, integer, text) to authenticated, service_role;
grant execute on function public.banter_join_public_league(uuid) to authenticated, service_role;

-- Expected Security Advisor result: no new errors; three more of the accepted warning class
-- "Signed-In Users Can Execute SECURITY DEFINER" (each checks has_banter_access() first).

-- ROLLBACK:
--   drop function if exists public.banter_join_public_league(uuid);
--   drop function if exists public.banter_public_leagues(text, integer, integer, text);
--   drop function if exists public.banter_set_league_public(uuid, boolean);
--   drop function if exists public.banter_my_leagues();
--   drop function if exists public.banter_create_league(text, boolean);
--   then re-run banter_create_league(text) and banter_my_leagues() from 20261115000001_banter_leagues.sql
--   alter table public.banter_leagues drop column if exists is_public;
