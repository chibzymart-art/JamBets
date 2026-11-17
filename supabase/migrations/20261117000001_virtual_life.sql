-- Virtual Life: Banta Coins, avatar, daily check-in, home room, shop, travel, fan rankings.
-- Additive only. Reads player_profiles and football_user_picks; never writes to any existing table.
-- Nothing in the Predictions Hub or the Banter Hub changes.
-- Needs the Banter migrations (has_banter_access, player_profiles, football_user_picks) applied first.
--
-- Rules (owner-approved proposal, 17 Nov 2026):
--  * PAID members only, the same has_banter_access() check as Banter Hub, and a Banter username.
--  * Banta Coins are Banter-only: never bought, cashed out or transferred. There is no function that
--    moves coins between members and no price in money anywhere.
--  * Coins are earned and spent ONLY inside SECURITY DEFINER functions. Members cannot read or write
--    any Virtual Life table directly (RLS on, all table grants revoked, no policies), so a balance
--    can't be forged from the browser.
--  * The ledger is append-only: a balance is the sum of the member's rows. Updates are refused;
--    deletes are refused unless they come from the users -> cascade when an account is removed.
--  * Every spend takes a per-member advisory lock and checks the balance inside the same
--    transaction, so two quick taps can't spend the same coins twice.
--  * Earn: 10 coins per won Banter pick (credited once per pick, idempotent), 50 welcome coins once,
--    daily check-in 5 coins plus 1 per streak day, up to 11.
--  * Catalogue and cities are fixed rows below: made-up kits and items, no real player, club or
--    stadium names or marks. City names are plain place names.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------

-- Fixed shop catalogue. kind: base (avatar face), kit (shirt colours), gear (worn item), badge,
-- trophy (room shelf), room (room furniture), city (travel badge, never for sale).
create table if not exists public.vl_catalog (
  item_key text primary key,
  kind text not null,
  name text not null,
  emoji text not null,
  price integer not null default 0,
  for_sale boolean not null default true,
  colour1 text,
  colour2 text,
  sort integer not null default 0,
  constraint vl_catalog_kind_check check (kind in ('base', 'kit', 'gear', 'badge', 'trophy', 'room', 'city')),
  constraint vl_catalog_price_check check (price >= 0 and price <= 100000),
  constraint vl_catalog_key_format check (item_key ~ '^[a-z0-9_]{2,40}$'),
  constraint vl_catalog_colour_format check (
    (colour1 is null or colour1 ~ '^#[0-9a-f]{6}$') and (colour2 is null or colour2 ~ '^#[0-9a-f]{6}$')
  )
);

-- Cities a fan can fly to. Each city has its own travel badge (vl_catalog kind 'city').
create table if not exists public.vl_cities (
  city_key text primary key,
  name text not null,
  country text not null,
  flag text not null,
  price integer not null,
  sort integer not null default 0,
  constraint vl_cities_price_check check (price > 0 and price <= 100000),
  constraint vl_cities_key_format check (city_key ~ '^[a-z0-9_]{2,30}$')
);

-- Append-only coin ledger. amount > 0 earns, < 0 spends. ref makes earning idempotent.
create table if not exists public.vl_coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  amount integer not null,
  reason text not null,
  ref text not null,
  created_at timestamptz not null default now(),
  constraint vl_coin_ledger_amount_check check (amount <> 0 and amount between -100000 and 100000),
  constraint vl_coin_ledger_reason_check check (reason in ('pick_won', 'welcome', 'checkin', 'shop', 'travel')),
  constraint vl_coin_ledger_sign_check check (
    (reason in ('pick_won', 'welcome', 'checkin') and amount > 0)
    or (reason in ('shop', 'travel') and amount < 0)
  ),
  constraint vl_coin_ledger_once unique (user_id, reason, ref)
);

create index if not exists vl_coin_ledger_user_idx on public.vl_coin_ledger (user_id);

create table if not exists public.vl_inventory (
  user_id uuid not null references public.users(id) on delete cascade,
  item_key text not null references public.vl_catalog(item_key),
  acquired_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

-- What the avatar wears. Every slot must be an owned (or free) item of the right kind.
create table if not exists public.vl_avatars (
  user_id uuid primary key references public.users(id) on delete cascade,
  base_key text references public.vl_catalog(item_key),
  kit_key text references public.vl_catalog(item_key),
  gear_key text references public.vl_catalog(item_key),
  badge_key text references public.vl_catalog(item_key),
  updated_at timestamptz not null default now()
);

-- One row per member per Lagos day they checked in.
create table if not exists public.vl_checkins (
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  streak integer not null,
  bonus integer not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day),
  constraint vl_checkins_streak_check check (streak >= 1),
  constraint vl_checkins_bonus_check check (bonus > 0)
);

-- One row per city visited (each city once). The latest trip is where the fan is now.
create table if not exists public.vl_trips (
  user_id uuid not null references public.users(id) on delete cascade,
  city_key text not null references public.vl_cities(city_key),
  created_at timestamptz not null default now(),
  primary key (user_id, city_key)
);

create index if not exists vl_trips_user_time_idx on public.vl_trips (user_id, created_at desc);

-- Lock everything down: no direct table access for visitors or members. Reads and writes go only
-- through the functions below. No policies on purpose (RLS on + no policy = no rows).
do $$
declare t text;
begin
  foreach t in array array['vl_catalog', 'vl_cities', 'vl_coin_ledger', 'vl_inventory', 'vl_avatars', 'vl_checkins', 'vl_trips'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end;
$$;

-- Append-only ledger guard.
create or replace function public.vl_ledger_append_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A delete that cascades from public.users (account removal) runs inside the FK trigger,
  -- so the trigger depth is above 1. Any direct update or delete is refused.
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'vl_ledger_append_only';
end;
$$;

revoke execute on function public.vl_ledger_append_only() from public, anon, authenticated;

drop trigger if exists vl_coin_ledger_append_only on public.vl_coin_ledger;
create trigger vl_coin_ledger_append_only
  before update or delete on public.vl_coin_ledger
  for each row execute function public.vl_ledger_append_only();

-- ---------------------------------------------------------------------------
-- 2. Fixed catalogue and cities (made-up names only)
-- ---------------------------------------------------------------------------
insert into public.vl_catalog (item_key, kind, name, emoji, price, for_sale, colour1, colour2, sort) values
  -- Avatar faces (two free)
  ('base_smile',    'base', 'Happy Fan',      '🙂', 0,   true, null, null, 10),
  ('base_cool',     'base', 'Cool Fan',       '😎', 0,   true, null, null, 11),
  ('base_cowboy',   'base', 'Cowboy',         '🤠', 60,  true, null, null, 12),
  ('base_robot',    'base', 'Robo Fan',       '🤖', 90,  true, null, null, 13),
  ('base_lion',     'base', 'Lion Heart',     '🦁', 120, true, null, null, 14),
  ('base_eagle',    'base', 'Eagle Eye',      '🦅', 120, true, null, null, 15),
  ('base_goat',     'base', 'The GOAT',       '🐐', 250, true, null, null, 16),
  -- Kits: made-up colourways, no club names
  ('kit_classic',   'kit',  'Classic White',  '👕', 0,   true, '#f8fafc', '#cbd5e1', 20),
  ('kit_lagoon',    'kit',  'Lagoon Blue',    '👕', 40,  true, '#0ea5e9', '#0c4a6e', 21),
  ('kit_sunset',    'kit',  'Sunset Orange',  '👕', 40,  true, '#f97316', '#7c2d12', 22),
  ('kit_forest',    'kit',  'Forest Green',   '👕', 40,  true, '#16a34a', '#14532d', 23),
  ('kit_ruby',      'kit',  'Ruby Red',       '👕', 60,  true, '#dc2626', '#fde047', 24),
  ('kit_royal',     'kit',  'Royal Purple',   '👕', 80,  true, '#7c3aed', '#f5f3ff', 25),
  ('kit_midnight',  'kit',  'Midnight Stripes','👕', 120, true, '#0f172a', '#38bdf8', 26),
  ('kit_gold',      'kit',  'Gold Rush',      '👕', 200, true, '#eab308', '#422006', 27),
  -- Gear
  ('gear_scarf',    'gear', 'Fan Scarf',      '🧣', 30,  true, null, null, 30),
  ('gear_cap',      'gear', 'Match Cap',      '🧢', 30,  true, null, null, 31),
  ('gear_shades',   'gear', 'Sunglasses',     '🕶️', 50,  true, null, null, 32),
  ('gear_horn',     'gear', 'Stadium Horn',   '📯', 60,  true, null, null, 33),
  ('gear_drum',     'gear', 'Fan Drum',       '🥁', 80,  true, null, null, 34),
  ('gear_tophat',   'gear', 'Top Hat',        '🎩', 90,  true, null, null, 35),
  ('gear_crown',    'gear', 'Golden Crown',   '👑', 400, true, null, null, 36),
  -- Badges for sale
  ('badge_star',    'badge','Rising Star',    '⭐', 50,  true, null, null, 40),
  ('badge_fire',    'badge','Hot Streak',     '🔥', 100, true, null, null, 41),
  ('badge_target',  'badge','Sharpshooter',   '🎯', 150, true, null, null, 42),
  ('badge_diamond', 'badge','Diamond Fan',    '💎', 500, true, null, null, 43),
  -- Trophies (room shelf)
  ('trophy_ball',   'trophy','Match Ball',    '⚽', 40,  true, null, null, 50),
  ('trophy_medal',  'trophy','Fan Medal',     '🏅', 60,  true, null, null, 51),
  ('trophy_gold',   'trophy','Gold Medal',    '🥇', 150, true, null, null, 52),
  ('trophy_cup',    'trophy','Golden Cup',    '🏆', 300, true, null, null, 53),
  -- Room items
  ('room_plant',    'room', 'Pot Plant',      '🪴', 25,  true, null, null, 60),
  ('room_poster',   'room', 'Fan Poster',     '🖼️', 30,  true, null, null, 61),
  ('room_plush',    'room', 'Mascot Plush',   '🧸', 45,  true, null, null, 62),
  ('room_neon',     'room', 'Neon Light',     '💡', 60,  true, null, null, 63),
  ('room_popcorn',  'room', 'Popcorn Maker',  '🍿', 70,  true, null, null, 64),
  ('room_sofa',     'room', 'Big Sofa',       '🛋️', 80,  true, null, null, 65),
  ('room_tv',       'room', 'Big Screen TV',  '📺', 120, true, null, null, 66),
  ('room_console',  'room', 'Games Console',  '🎮', 150, true, null, null, 67)
on conflict (item_key) do update
  set kind = excluded.kind, name = excluded.name, emoji = excluded.emoji, price = excluded.price,
      for_sale = excluded.for_sale, colour1 = excluded.colour1, colour2 = excluded.colour2, sort = excluded.sort;

insert into public.vl_cities (city_key, name, country, flag, price, sort) values
  ('lagos',      'Lagos',      'Nigeria',     '🇳🇬', 20,  1),
  ('accra',      'Accra',      'Ghana',       '🇬🇭', 40,  2),
  ('cairo',      'Cairo',      'Egypt',       '🇪🇬', 60,  3),
  ('london',     'London',     'England',     '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 80,  4),
  ('manchester', 'Manchester', 'England',     '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 80,  5),
  ('liverpool',  'Liverpool',  'England',     '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 80,  6),
  ('madrid',     'Madrid',     'Spain',       '🇪🇸', 90,  7),
  ('barcelona',  'Barcelona',  'Spain',       '🇪🇸', 90,  8),
  ('paris',      'Paris',      'France',      '🇫🇷', 90,  9),
  ('milan',      'Milan',      'Italy',       '🇮🇹', 100, 10),
  ('turin',      'Turin',      'Italy',       '🇮🇹', 100, 11),
  ('munich',     'Munich',     'Germany',     '🇩🇪', 100, 12),
  ('dortmund',   'Dortmund',   'Germany',     '🇩🇪', 100, 13),
  ('amsterdam',  'Amsterdam',  'Netherlands', '🇳🇱', 100, 14),
  ('lisbon',     'Lisbon',     'Portugal',    '🇵🇹', 100, 15),
  ('istanbul',   'Istanbul',   'Turkey',      '🇹🇷', 120, 16),
  ('riyadh',     'Riyadh',     'Saudi Arabia','🇸🇦', 140, 17),
  ('rio',        'Rio de Janeiro','Brazil',   '🇧🇷', 160, 18),
  ('buenos_aires','Buenos Aires','Argentina', '🇦🇷', 160, 19)
on conflict (city_key) do update
  set name = excluded.name, country = excluded.country, flag = excluded.flag, price = excluded.price, sort = excluded.sort;

-- Each city's travel badge (never for sale; earned by flying there).
insert into public.vl_catalog (item_key, kind, name, emoji, price, for_sale, sort)
select 'city_' || c.city_key, 'city', c.name || ' Traveller', c.flag, 0, false, 100 + c.sort
  from public.vl_cities c
on conflict (item_key) do update
  set name = excluded.name, emoji = excluded.emoji, sort = excluded.sort, for_sale = false, price = 0, kind = 'city';

-- ---------------------------------------------------------------------------
-- 3. Internal helpers (not callable by members)
-- ---------------------------------------------------------------------------

-- Caller may use Virtual Life: signed in, paid (has_banter_access) and has a Banter username.
-- Returns the user id, or raises not_signed_in / no_access / no_profile.
create or replace function public.vl_require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'not_signed_in';
  end if;
  if not public.has_banter_access() then
    raise exception 'no_access';
  end if;
  if not exists (select 1 from public.player_profiles p where p.user_id = v_uid) then
    raise exception 'no_profile';
  end if;
  return v_uid;
end;
$$;

create or replace function public.vl_balance_of(p_uid uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.amount), 0)::integer from public.vl_coin_ledger l where l.user_id = p_uid;
$$;

-- Credit what the member has earned and not yet received: welcome coins once, and 10 coins per
-- won Banter pick. Idempotent (unique user/reason/ref). Reads football_user_picks only.
create or replace function public.vl_sync_earnings(p_uid uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  values (p_uid, 50, 'welcome', 'welcome')
  on conflict on constraint vl_coin_ledger_once do nothing;

  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  select p_uid, 10, 'pick_won', k.id::text
    from public.football_user_picks k
   where k.user_id = p_uid and k.status = 'won'
  on conflict on constraint vl_coin_ledger_once do nothing;
end;
$$;

-- Spend coins atomically. Takes a per-member lock, checks the balance, writes one negative row.
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
  if v_balance < p_amount then
    raise exception 'not_enough_coins';
  end if;
  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  values (p_uid, -p_amount, p_reason, p_ref);
  return v_balance - p_amount;
end;
$$;

-- Lagos calendar day (check-ins roll over at midnight Lagos time).
create or replace function public.vl_today()
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select (now() at time zone 'Africa/Lagos')::date;
$$;

revoke execute on function public.vl_require_member() from public, anon, authenticated;
revoke execute on function public.vl_balance_of(uuid) from public, anon, authenticated;
revoke execute on function public.vl_sync_earnings(uuid) from public, anon, authenticated;
revoke execute on function public.vl_spend(uuid, integer, text, text) from public, anon, authenticated;
revoke execute on function public.vl_today() from public, anon;
grant execute on function public.vl_today() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Member RPCs
-- ---------------------------------------------------------------------------

-- Everything the Virtual Life page needs, in one call. Credits new earnings first.
-- Not signed in / no access / no username: returns flags only (the page shows the right screen).
create or replace function public.vl_get_state()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_today date := public.vl_today();
  v_last public.vl_checkins%rowtype;
  v_streak integer;
  v_profile public.player_profiles%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('signed_in', false, 'access', false);
  end if;
  if not public.has_banter_access() then
    return jsonb_build_object('signed_in', true, 'access', false);
  end if;
  select * into v_profile from public.player_profiles p where p.user_id = v_uid;
  if not found then
    return jsonb_build_object('signed_in', true, 'access', true, 'needs_profile', true);
  end if;

  perform public.vl_sync_earnings(v_uid);

  select * into v_last from public.vl_checkins c where c.user_id = v_uid order by c.day desc limit 1;
  v_streak := case
    when v_last.day = v_today or v_last.day = v_today - 1 then v_last.streak
    else 0
  end;

  return jsonb_build_object(
    'signed_in', true,
    'access', true,
    'needs_profile', false,
    'handle', v_profile.handle,
    'avatar_emoji', v_profile.avatar_emoji,
    'balance', public.vl_balance_of(v_uid),
    'earned_total', (select coalesce(sum(l.amount), 0) from public.vl_coin_ledger l where l.user_id = v_uid and l.amount > 0),
    'won_picks_paid', (select count(*) from public.vl_coin_ledger l where l.user_id = v_uid and l.reason = 'pick_won'),
    'checked_in_today', coalesce(v_last.day = v_today, false),
    'streak', coalesce(v_streak, 0),
    'avatar', (
      select jsonb_build_object('base', a.base_key, 'kit', a.kit_key, 'gear', a.gear_key, 'badge', a.badge_key)
        from public.vl_avatars a where a.user_id = v_uid
    ),
    'owned', coalesce((
      select jsonb_agg(i.item_key order by i.acquired_at) from public.vl_inventory i where i.user_id = v_uid
    ), '[]'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', c.item_key, 'kind', c.kind, 'name', c.name, 'emoji', c.emoji, 'price', c.price,
               'for_sale', c.for_sale, 'colour1', c.colour1, 'colour2', c.colour2) order by c.sort, c.item_key)
        from public.vl_catalog c
    ), '[]'::jsonb),
    'cities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', c.city_key, 'name', c.name, 'country', c.country, 'flag', c.flag, 'price', c.price)
               order by c.sort, c.city_key)
        from public.vl_cities c
    ), '[]'::jsonb),
    'trips', coalesce((
      select jsonb_agg(jsonb_build_object('city', t.city_key, 'at', t.created_at) order by t.created_at desc)
        from public.vl_trips t where t.user_id = v_uid
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('amount', r.amount, 'reason', r.reason, 'at', r.created_at) order by r.id desc)
        from (select l.id, l.amount, l.reason, l.created_at from public.vl_coin_ledger l
               where l.user_id = v_uid order by l.id desc limit 10) r
    ), '[]'::jsonb)
  );
end;
$$;

-- Just the balance (Banter profile card). Credits new earnings first.
-- Returns null when the caller can't use Virtual Life.
create or replace function public.vl_my_balance()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_banter_access()
     or not exists (select 1 from public.player_profiles p where p.user_id = v_uid) then
    return null;
  end if;
  perform public.vl_sync_earnings(v_uid);
  return public.vl_balance_of(v_uid);
end;
$$;

-- Daily check-in. Once per Lagos day. Bonus = 5 + (streak - 1), capped at 11.
-- Errors: not_signed_in, no_access, no_profile, already_checked_in.
create or replace function public.vl_check_in()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.vl_require_member();
  v_today date := public.vl_today();
  v_prev public.vl_checkins%rowtype;
  v_streak integer;
  v_bonus integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vl_coins:' || v_uid::text, 0));
  if exists (select 1 from public.vl_checkins c where c.user_id = v_uid and c.day = v_today) then
    raise exception 'already_checked_in';
  end if;
  select * into v_prev from public.vl_checkins c where c.user_id = v_uid and c.day = v_today - 1;
  v_streak := coalesce(v_prev.streak, 0) + 1;
  v_bonus := least(5 + (v_streak - 1), 11);

  insert into public.vl_checkins (user_id, day, streak, bonus) values (v_uid, v_today, v_streak, v_bonus);
  insert into public.vl_coin_ledger (user_id, amount, reason, ref)
  values (v_uid, v_bonus, 'checkin', v_today::text);

  return jsonb_build_object('streak', v_streak, 'bonus', v_bonus, 'balance', public.vl_balance_of(v_uid));
end;
$$;

-- Buy one catalogue item that is for sale and not yet owned.
-- Errors: not_signed_in, no_access, no_profile, item_unknown, not_for_sale, already_owned, not_enough_coins.
create or replace function public.vl_buy(p_item_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.vl_require_member();
  v_item public.vl_catalog%rowtype;
  v_balance integer;
begin
  select * into v_item from public.vl_catalog c where c.item_key = btrim(coalesce(p_item_key, ''));
  if not found then
    raise exception 'item_unknown';
  end if;
  if not v_item.for_sale then
    raise exception 'not_for_sale';
  end if;
  perform public.vl_sync_earnings(v_uid);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vl_coins:' || v_uid::text, 0));
  if v_item.price = 0 or exists (select 1 from public.vl_inventory i where i.user_id = v_uid and i.item_key = v_item.item_key) then
    raise exception 'already_owned';
  end if;
  v_balance := public.vl_spend(v_uid, v_item.price, 'shop', v_item.item_key);
  insert into public.vl_inventory (user_id, item_key) values (v_uid, v_item.item_key);
  return jsonb_build_object('item', v_item.item_key, 'balance', v_balance);
end;
$$;

-- Choose what the avatar wears. Each slot may be null (nothing) or an item of that slot's kind the
-- member owns (free items count as owned). Badge slot takes shop badges and travel badges.
-- Errors: not_signed_in, no_access, no_profile, item_not_owned.
create or replace function public.vl_set_avatar(p_base text, p_kit text, p_gear text, p_badge text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.vl_require_member();
  v_base text := nullif(btrim(coalesce(p_base, '')), '');
  v_kit text := nullif(btrim(coalesce(p_kit, '')), '');
  v_gear text := nullif(btrim(coalesce(p_gear, '')), '');
  v_badge text := nullif(btrim(coalesce(p_badge, '')), '');
  v_key text;
  v_kinds text[];
  i integer;
begin
  for i in 1..4 loop
    v_key := (array[v_base, v_kit, v_gear, v_badge])[i];
    v_kinds := (array[array['base', 'base'], array['kit', 'kit'], array['gear', 'gear'], array['badge', 'city']])[i:i];
    continue when v_key is null;
    if not exists (
      select 1 from public.vl_catalog c
       where c.item_key = v_key
         and c.kind = any (v_kinds)
         and (
           (c.for_sale and c.price = 0)
           or exists (select 1 from public.vl_inventory inv where inv.user_id = v_uid and inv.item_key = c.item_key)
         )
    ) then
      raise exception 'item_not_owned';
    end if;
  end loop;

  insert into public.vl_avatars as a (user_id, base_key, kit_key, gear_key, badge_key)
  values (v_uid, v_base, v_kit, v_gear, v_badge)
  on conflict (user_id) do update
    set base_key = excluded.base_key, kit_key = excluded.kit_key, gear_key = excluded.gear_key,
        badge_key = excluded.badge_key, updated_at = now();

  return jsonb_build_object('base', v_base, 'kit', v_kit, 'gear', v_gear, 'badge', v_badge);
end;
$$;

-- Fly to a city: spend its fare, record the trip, unlock the city's travel badge. Each city once.
-- Errors: not_signed_in, no_access, no_profile, city_unknown, already_visited, not_enough_coins.
create or replace function public.vl_travel(p_city_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := public.vl_require_member();
  v_city public.vl_cities%rowtype;
  v_balance integer;
begin
  select * into v_city from public.vl_cities c where c.city_key = btrim(coalesce(p_city_key, ''));
  if not found then
    raise exception 'city_unknown';
  end if;
  perform public.vl_sync_earnings(v_uid);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('vl_coins:' || v_uid::text, 0));
  if exists (select 1 from public.vl_trips t where t.user_id = v_uid and t.city_key = v_city.city_key) then
    raise exception 'already_visited';
  end if;
  v_balance := public.vl_spend(v_uid, v_city.price, 'travel', v_city.city_key);
  insert into public.vl_trips (user_id, city_key) values (v_uid, v_city.city_key);
  insert into public.vl_inventory (user_id, item_key) values (v_uid, 'city_' || v_city.city_key)
  on conflict do nothing;
  return jsonb_build_object('city', v_city.city_key, 'badge', 'city_' || v_city.city_key, 'balance', v_balance);
end;
$$;

-- Fan rankings: 'rich' (current Banta Coins) or 'travel' (cities visited). Top p_limit (max 100),
-- plus the caller's own row if outside. Members with leaderboard_banned are left out.
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

revoke execute on function public.vl_get_state() from public, anon;
revoke execute on function public.vl_my_balance() from public, anon;
revoke execute on function public.vl_check_in() from public, anon;
revoke execute on function public.vl_buy(text) from public, anon;
revoke execute on function public.vl_set_avatar(text, text, text, text) from public, anon;
revoke execute on function public.vl_travel(text) from public, anon;
revoke execute on function public.vl_leaderboard(text, integer) from public, anon;
grant execute on function public.vl_get_state() to authenticated, service_role;
grant execute on function public.vl_my_balance() to authenticated, service_role;
grant execute on function public.vl_check_in() to authenticated, service_role;
grant execute on function public.vl_buy(text) to authenticated, service_role;
grant execute on function public.vl_set_avatar(text, text, text, text) to authenticated, service_role;
grant execute on function public.vl_travel(text) to authenticated, service_role;
grant execute on function public.vl_leaderboard(text, integer) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. Seven member RPCs join the already-accepted
-- warning class "Signed-In Users Can Execute SECURITY DEFINER"; each checks has_banter_access().
-- The seven tables show "RLS enabled, no policy" (info), on purpose: all access is through RPCs.

-- ROLLBACK:
--   drop function if exists public.vl_leaderboard(text, integer);
--   drop function if exists public.vl_travel(text);
--   drop function if exists public.vl_set_avatar(text, text, text, text);
--   drop function if exists public.vl_buy(text);
--   drop function if exists public.vl_check_in();
--   drop function if exists public.vl_my_balance();
--   drop function if exists public.vl_get_state();
--   drop function if exists public.vl_today();
--   drop function if exists public.vl_spend(uuid, integer, text, text);
--   drop function if exists public.vl_sync_earnings(uuid);
--   drop function if exists public.vl_balance_of(uuid);
--   drop function if exists public.vl_require_member();
--   drop table if exists public.vl_trips, public.vl_checkins, public.vl_avatars, public.vl_inventory,
--     public.vl_coin_ledger, public.vl_cities, public.vl_catalog;
--   drop function if exists public.vl_ledger_append_only();
