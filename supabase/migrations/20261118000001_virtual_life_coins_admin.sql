-- Virtual Life: 1000 starting coins, unlimited coins for admins, admins can give coins.
-- Additive only: changes Virtual Life functions and one Virtual Life check constraint. Nothing in the
-- Predictions Hub or Banter Hub changes. Needs 20261117000001_virtual_life.sql applied first.
--
-- Owner request (18 Nov 2026):
--  * Every member starts with 1000 Banta Coins. New members get 1000 welcome coins; members who
--    already received the old 50 get a one-off 950 top-up, so everyone ends up with the same 1000.
--  * Admins (public.is_admin()) have unlimited coins: their spends are recorded but never refused.
--  * Admins can give coins to any member by Banter username or account email.
-- Coins still can't be bought, cashed out, or moved between members.

-- ---------------------------------------------------------------------------
-- 1. Ledger: two new reasons
-- ---------------------------------------------------------------------------
alter table public.vl_coin_ledger drop constraint if exists vl_coin_ledger_reason_check;
alter table public.vl_coin_ledger add constraint vl_coin_ledger_reason_check
  check (reason in ('pick_won', 'welcome', 'welcome_topup', 'checkin', 'admin_grant', 'shop', 'travel'));

alter table public.vl_coin_ledger drop constraint if exists vl_coin_ledger_sign_check;
alter table public.vl_coin_ledger add constraint vl_coin_ledger_sign_check check (
  (reason in ('pick_won', 'welcome', 'welcome_topup', 'checkin', 'admin_grant') and amount > 0)
  or (reason in ('shop', 'travel') and amount < 0)
);

-- ---------------------------------------------------------------------------
-- 2. Earnings: 1000 welcome (top-up for anyone who got the old 50)
-- ---------------------------------------------------------------------------
create or replace function public.vl_sync_earnings(p_uid uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  values (p_uid, 1000, 'welcome', 'welcome')
  on conflict on constraint vl_coin_ledger_once do nothing;

  -- Members who received the old 50 welcome coins: top up once to 1000.
  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  select p_uid, 1000 - l.amount, 'welcome_topup', 'welcome_1000'
    from public.vl_coin_ledger l
   where l.user_id = p_uid and l.reason = 'welcome' and l.ref = 'welcome' and l.amount < 1000
  on conflict on constraint vl_coin_ledger_once do nothing;

  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  select p_uid, 10, 'pick_won', k.id::text
    from public.football_user_picks k
   where k.user_id = p_uid and k.status = 'won'
  on conflict on constraint vl_coin_ledger_once do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Spend: admins are never refused
-- ---------------------------------------------------------------------------
create or replace function public.vl_spend(p_uid uuid, p_amount integer, p_reason text, p_ref text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_balance integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount_invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vl_coins:' || p_uid::text, 0));
  v_balance := public.vl_balance_of(p_uid);
  -- Unlimited coins for admins. p_uid is always the caller here (the member RPCs pass auth.uid()).
  if v_balance < p_amount and not (p_uid = (select auth.uid()) and coalesce(public.is_admin(), false)) then
    raise exception 'not_enough_coins';
  end if;
  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  values (p_uid, -p_amount, p_reason, p_ref);
  return v_balance - p_amount;
end;
$$;

revoke execute on function public.vl_sync_earnings(uuid) from public, anon, authenticated;
revoke execute on function public.vl_spend(uuid, integer, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. State: tell the page when the caller is an admin
-- ---------------------------------------------------------------------------
-- Wraps the existing state with is_admin (the page shows "Unlimited" and the Give coins card).
create or replace function public.vl_get_state_admin()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state jsonb := public.vl_get_state();
begin
  return v_state || jsonb_build_object('is_admin', coalesce(public.is_admin(), false));
end;
$$;

revoke execute on function public.vl_get_state_admin() from public, anon;
grant execute on function public.vl_get_state_admin() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Admin: give coins by username or email
-- ---------------------------------------------------------------------------
-- p_who: a Banter username (case-insensitive, optional leading @) or an account email.
-- p_amount: 1 to 100000. Returns who got the coins and their new balance.
-- Errors: not_signed_in, not_admin, amount_invalid, member_not_found.
create or replace function public.vl_admin_grant(p_who text, p_amount integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_who text := lower(btrim(coalesce(p_who, '')));
  v_target uuid;
  v_handle text;
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not coalesce(public.is_admin(), false) then
    raise exception 'not_admin';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000 then
    raise exception 'amount_invalid';
  end if;
  if left(v_who, 1) = '@' then
    v_who := substr(v_who, 2);
  end if;
  if v_who = '' then
    raise exception 'member_not_found';
  end if;

  if position('@' in v_who) > 0 then
    select u.id into v_target from auth.users u where lower(u.email) = v_who limit 1;
  else
    select p.user_id into v_target from public.player_profiles p where lower(p.handle) = v_who limit 1;
  end if;
  if v_target is null or not exists (select 1 from public.users x where x.id = v_target) then
    raise exception 'member_not_found';
  end if;

  select p.handle into v_handle from public.player_profiles p where p.user_id = v_target;

  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  values (v_target, p_amount, 'admin_grant', 'by:' || v_uid::text || ':' || gen_random_uuid()::text);

  return jsonb_build_object(
    'handle', v_handle,
    'amount', p_amount,
    'balance', public.vl_balance_of(v_target)
  );
end;
$$;

revoke execute on function public.vl_admin_grant(text, integer) from public, anon;
grant execute on function public.vl_admin_grant(text, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Rankings: leave admins out of "Richest fans" (their coins are unlimited)
-- ---------------------------------------------------------------------------
-- Is this user an admin? Same stored-data checks as public.is_admin(), but for any user id
-- (is_admin() only looks at the caller's own token). Internal: not callable by members.
create or replace function public.vl_is_admin_user(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.users u
            where u.id = p_uid
              and (lower(coalesce(u.role, '')) = 'admin'
                   or lower(coalesce(u.email, '')) in ('chibzymart@gmail.com', 'whizzchibz@gmail.com', 'chibuezec.amuchie@gmail.com', 'nnamdiamuchie@gmail.com'))
         )
      or exists (
           select 1 from public.entitlements e
            where e.user_id = p_uid and (e.tier = 'admin' or coalesce((e.features ->> 'admin')::boolean, false))
         )
      or exists (
           select 1 from public.subscriptions s
            where s.user_id = p_uid and s.tier = 'admin' and s.status = 'active'
         );
$$;

revoke execute on function public.vl_is_admin_user(uuid) from public, anon, authenticated;
create or replace function public.vl_leaderboard(p_kind text default 'rich', p_limit integer default 50)
returns table (
  place bigint,
  handle text,
  avatar_emoji text,
  base_emoji text,
  value integer,
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
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_kind text := case when p_kind = 'travel' then 'travel' else 'rich' end;
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;

  return query
  with scores as (
    select pp.user_id,
           pp.handle,
           pp.avatar_emoji,
           pp.created_at,
           case when v_kind = 'travel'
                then (select count(*) from public.vl_trips t where t.user_id = pp.user_id)::integer
                else (select coalesce(sum(l.amount), 0) from public.vl_coin_ledger l where l.user_id = pp.user_id)::integer
           end as v
      from public.player_profiles pp
     where not pp.leaderboard_banned
       and exists (select 1 from public.vl_coin_ledger l where l.user_id = pp.user_id)
       and (v_kind = 'travel' or not public.vl_is_admin_user(pp.user_id))
  ),
  ranked as (
    select s.*, rank() over (order by s.v desc) as rk,
           row_number() over (order by s.v desc, s.created_at, s.user_id) as rn
      from scores s
  )
  select r.rk, r.handle, r.avatar_emoji,
         (select c.emoji from public.vl_avatars a join public.vl_catalog c on c.item_key = a.base_key
           where a.user_id = r.user_id),
         r.v, r.user_id = v_uid
    from ranked r
   where r.rn <= v_limit or r.user_id = v_uid
   order by r.rn;
end;
$$;

revoke execute on function public.vl_leaderboard(text, integer) from public, anon;
grant execute on function public.vl_leaderboard(text, integer) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. Two new member RPCs (vl_get_state_admin,
-- vl_admin_grant) join the accepted "Signed-In Users Can Execute SECURITY DEFINER" warnings;
-- vl_admin_grant refuses anyone who is not public.is_admin().

-- ROLLBACK (back to 20261117000001 behaviour; coins already given stay in the ledger):
--   drop function if exists public.vl_admin_grant(text, integer);
--   drop function if exists public.vl_get_state_admin();
--   drop function if exists public.vl_is_admin_user(uuid);
--   then re-run sections for vl_sync_earnings, vl_spend and vl_leaderboard from 20261117000001.
--   The reason/sign constraints can only be narrowed again once no welcome_topup/admin_grant rows exist.
