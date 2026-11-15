-- Banter Hub: web push notifications (installed web app and browsers).
-- Additive only: new tables and functions; nothing in the Predictions Hub changes.
-- Needs the Banter migrations up to 20261115000006_banter_reply_everywhere.sql applied.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner): push for replies and tags (Discussion and leagues), new league messages and league
-- activity (a member joined). Paid members only. Never notify yourself.
--   * Members save one subscription per device (browser / installed app). Settings: replies and
--     tags, league messages, league activity: all on by default. Any league can be muted (mute
--     silences that league's messages and activity; a direct reply or tag still comes through).
--   * The sender is a Vercel function (api/banter-push.ts). After a successful post the website
--     calls it with the message id and the member's token; the function verifies the token and asks
--     banter_push_targets() (service role only) who to notify. banter_push_targets() confirms the
--     caller wrote that message in the last 10 minutes and sends each message at most once
--     (banter_push_log), so the endpoint cannot be used to spam.
--   * No direct table access for anyone but the service role.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.banter_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  constraint banter_push_endpoint_https check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  constraint banter_push_keys_length check (char_length(p256dh) between 40 and 200 and char_length(auth) between 10 and 100)
);
create index if not exists banter_push_subscriptions_user_idx on public.banter_push_subscriptions (user_id);

create table if not exists public.banter_push_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  replies boolean not null default true,
  league_messages boolean not null default true,
  league_activity boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.banter_league_mutes (
  user_id uuid not null references public.users(id) on delete cascade,
  league_id uuid not null references public.banter_leagues(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, league_id)
);

-- One push per message, ever (replay / spam guard for the sender endpoint).
create table if not exists public.banter_push_log (
  kind text not null,
  ref_id uuid not null,
  sender_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (kind, ref_id, sender_id)
);
create index if not exists banter_push_log_sender_idx on public.banter_push_log (sender_id, created_at desc);

alter table public.banter_push_subscriptions enable row level security;
alter table public.banter_push_settings enable row level security;
alter table public.banter_league_mutes enable row level security;
alter table public.banter_push_log enable row level security;

revoke all on table public.banter_push_subscriptions from anon, authenticated;
revoke all on table public.banter_push_settings from anon, authenticated;
revoke all on table public.banter_league_mutes from anon, authenticated;
revoke all on table public.banter_push_log from anon, authenticated;
grant select, insert, update, delete on table public.banter_push_subscriptions to service_role;
grant select, insert, update, delete on table public.banter_push_settings to service_role;
grant select, insert, update, delete on table public.banter_league_mutes to service_role;
grant select, insert, update, delete on table public.banter_push_log to service_role;
-- No policies: no direct access for anon or signed-in users.

-- ---------------------------------------------------------------------------
-- 2. Member RPCs (signed-in, paid)
-- ---------------------------------------------------------------------------

-- Save this device's push subscription for the caller (moves it over if the device changed hands).
create or replace function public.banter_save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if p_endpoint is null or p_endpoint not like 'https://%' or char_length(p_endpoint) > 1000 then
    raise exception 'subscription_invalid';
  end if;
  if char_length(coalesce(p_p256dh, '')) not between 40 and 200 or char_length(coalesce(p_auth, '')) not between 10 and 100 then
    raise exception 'subscription_invalid';
  end if;
  if (select count(*) from public.banter_push_subscriptions s where s.user_id = v_uid and s.endpoint <> p_endpoint) >= 10 then
    -- Keep the newest 9 devices.
    delete from public.banter_push_subscriptions
     where id in (select s.id from public.banter_push_subscriptions s
                   where s.user_id = v_uid and s.endpoint <> p_endpoint
                   order by coalesce(s.last_ok_at, s.created_at) asc
                   limit 1);
  end if;

  insert into public.banter_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now();
  return true;
end;
$$;

-- Remove this device's subscription (only the caller's own).
create or replace function public.banter_remove_push_subscription(p_endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_n integer;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  delete from public.banter_push_subscriptions s where s.endpoint = p_endpoint and s.user_id = v_uid;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

-- The caller's push settings, muted leagues and number of subscribed devices.
create or replace function public.banter_push_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_s public.banter_push_settings%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  select * into v_s from public.banter_push_settings where user_id = v_uid;
  return jsonb_build_object(
    'replies', coalesce(v_s.replies, true),
    'league_messages', coalesce(v_s.league_messages, true),
    'league_activity', coalesce(v_s.league_activity, true),
    'muted_leagues', coalesce((select jsonb_agg(m.league_id) from public.banter_league_mutes m where m.user_id = v_uid), '[]'::jsonb),
    'devices', (select count(*) from public.banter_push_subscriptions s where s.user_id = v_uid)
  );
end;
$$;

create or replace function public.banter_set_push_settings(
  p_replies boolean,
  p_league_messages boolean,
  p_league_activity boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  insert into public.banter_push_settings (user_id, replies, league_messages, league_activity, updated_at)
  values (v_uid, coalesce(p_replies, true), coalesce(p_league_messages, true), coalesce(p_league_activity, true), now())
  on conflict (user_id) do update
    set replies = excluded.replies, league_messages = excluded.league_messages,
        league_activity = excluded.league_activity, updated_at = now();
  return true;
end;
$$;

-- Mute or unmute one of your leagues.
create or replace function public.banter_set_league_mute(p_league_id uuid, p_muted boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = v_uid) then
    raise exception 'not_member';
  end if;
  if coalesce(p_muted, false) then
    insert into public.banter_league_mutes (user_id, league_id) values (v_uid, p_league_id) on conflict do nothing;
  else
    delete from public.banter_league_mutes where user_id = v_uid and league_id = p_league_id;
  end if;
  return coalesce(p_muted, false);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Service-role helpers for the sender (api/banter-push.ts)
-- ---------------------------------------------------------------------------

-- Paid access for any member (mirrors has_banter_access() for a given user id).
create or replace function public.banter_user_has_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.users u
            where u.id = p_user_id
              and lower(coalesce(u.role, '')) in ('standard', 'bigbang', 'big_bang', 'vip', 'pro', 'premium', 'admin'))
      or exists (
           select 1 from public.entitlements e
            where e.user_id = p_user_id
              and (e.tier in ('standard', 'bigbang', 'big_bang', 'vip', 'pro', 'premium', 'admin') or (e.features ->> 'admin') = 'true')
              and (e.valid_until is null or e.valid_until > now()))
      or exists (
           select 1 from public.subscriptions s
            where s.user_id = p_user_id and s.status = 'active'
              and s.tier in ('standard', 'bigbang', 'big_bang', 'vip', 'pro', 'premium', 'admin')
              and (s.current_period_end is null or s.current_period_end > now()))
      or exists (
           select 1 from auth.users au
            where au.id = p_user_id
              and lower(au.email) in ('chibzymart@gmail.com', 'whizzchibz@gmail.com', 'chibuezec.amuchie@gmail.com', 'nnamdiamuchie@gmail.com'));
$$;

-- Who to notify about one new message or event, with the text to show. Service role only.
-- p_kind: 'reply' (a Discussion reply id), 'post' (a league wall post id), 'join' (a league id the
-- sender just joined). Returns nothing if the sender did not write it, it is older than 10 minutes,
-- it was already sent, or the sender is banned / without access.
create or replace function public.banter_push_targets(p_sender uuid, p_kind text, p_id uuid)
returns table (
  user_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  url text,
  tag text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_handle text;
  v_banned boolean;
  v_n integer;
begin
  if p_sender is null or p_id is null or p_kind not in ('reply', 'post', 'join') then return; end if;

  select pp.handle, pp.leaderboard_banned into v_handle, v_banned from public.player_profiles pp where pp.user_id = p_sender;
  if v_handle is null or v_banned or not public.banter_user_has_access(p_sender) then return; end if;

  -- Sender-wide cap as a second guard: 120 pushes requested per hour.
  if (select count(*) from public.banter_push_log l where l.sender_id = p_sender and l.created_at > now() - interval '1 hour') >= 120 then
    return;
  end if;

  insert into public.banter_push_log (kind, ref_id, sender_id) values (p_kind, p_id, p_sender) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;

  if p_kind = 'reply' then
    return query
    with msg as (
      select r.id, r.topic_id, r.body, r.tagged_user_id, t.user_id as topic_author, t.title as topic_title
        from public.banter_replies r
        join public.banter_topics t on t.id = r.topic_id and t.deleted_at is null
       where r.id = p_id and r.user_id = p_sender and r.deleted_at is null
         and r.created_at > now() - interval '10 minutes'
    ), rcpt as (
      select m.tagged_user_id as uid, v_handle || ' replied to you' as title, m.* from msg m where m.tagged_user_id is not null
      union all
      select m.topic_author, v_handle || ' replied in your topic', m.* from msg m
       where m.topic_author is distinct from m.tagged_user_id
    )
    select s.user_id, s.endpoint, s.p256dh, s.auth, x.title, left(x.body, 140),
           '/play/discussion?topic=' || x.topic_id || '&reply=' || x.id,
           'banter-topic-' || x.topic_id
      from rcpt x
      join public.banter_push_subscriptions s on s.user_id = x.uid
      left join public.banter_push_settings st on st.user_id = x.uid
     where x.uid <> p_sender
       and coalesce(st.replies, true)
       and public.banter_user_has_access(x.uid);

  elsif p_kind = 'post' then
    return query
    with msg as (
      select p.id, p.league_id, p.body, p.tagged_user_id, l.name as league_name
        from public.banter_posts p
        join public.banter_leagues l on l.id = p.league_id
       where p.id = p_id and p.user_id = p_sender and p.deleted_at is null
         and p.created_at > now() - interval '10 minutes'
    ), rcpt as (
      -- The tagged member: a direct reply, delivered even if they muted the league.
      select m.tagged_user_id as uid, v_handle || ' replied to you in ' || m.league_name as title, 'replies' as setting, m.*
        from msg m
        join public.banter_league_members lm on lm.league_id = m.league_id and lm.user_id = m.tagged_user_id
       where m.tagged_user_id is not null
      union all
      -- Everyone else in the league.
      select lm.user_id, v_handle || ' in ' || m.league_name, 'league_messages', m.*
        from msg m
        join public.banter_league_members lm on lm.league_id = m.league_id
       where lm.user_id is distinct from m.tagged_user_id
         and not exists (select 1 from public.banter_league_mutes mu where mu.user_id = lm.user_id and mu.league_id = m.league_id)
    )
    select s.user_id, s.endpoint, s.p256dh, s.auth, x.title, left(x.body, 140),
           '/play/leagues?league=' || x.league_id || '&post=' || x.id,
           'banter-league-' || x.league_id
      from rcpt x
      join public.banter_push_subscriptions s on s.user_id = x.uid
      left join public.banter_push_settings st on st.user_id = x.uid
     where x.uid <> p_sender
       and (case when x.setting = 'replies' then coalesce(st.replies, true) else coalesce(st.league_messages, true) end)
       and public.banter_user_has_access(x.uid);

  else -- 'join'
    return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           v_handle || ' joined ' || l.name, 'Say hello on the league wall.'::text,
           '/play/leagues?league=' || l.id,
           'banter-league-' || l.id
      from public.banter_leagues l
      join public.banter_league_members me on me.league_id = l.id and me.user_id = p_sender
                                         and me.joined_at > now() - interval '10 minutes'
      join public.banter_league_members lm on lm.league_id = l.id and lm.user_id <> p_sender
      join public.banter_push_subscriptions s on s.user_id = lm.user_id
      left join public.banter_push_settings st on st.user_id = lm.user_id
     where l.id = p_id
       and coalesce(st.league_activity, true)
       and not exists (select 1 from public.banter_league_mutes mu where mu.user_id = lm.user_id and mu.league_id = l.id)
       and public.banter_user_has_access(lm.user_id);
  end if;
end;
$$;

-- Record delivery results: mark working subscriptions, delete ones the push service says are gone.
create or replace function public.banter_push_results(p_ok text[], p_gone text[])
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.banter_push_subscriptions set last_ok_at = now() where endpoint = any (coalesce(p_ok, '{}'));
  delete from public.banter_push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.banter_save_push_subscription(text, text, text, text) from public, anon;
revoke execute on function public.banter_remove_push_subscription(text) from public, anon;
revoke execute on function public.banter_push_settings() from public, anon;
revoke execute on function public.banter_set_push_settings(boolean, boolean, boolean) from public, anon;
revoke execute on function public.banter_set_league_mute(uuid, boolean) from public, anon;
grant execute on function public.banter_save_push_subscription(text, text, text, text) to authenticated, service_role;
grant execute on function public.banter_remove_push_subscription(text) to authenticated, service_role;
grant execute on function public.banter_push_settings() to authenticated, service_role;
grant execute on function public.banter_set_push_settings(boolean, boolean, boolean) to authenticated, service_role;
grant execute on function public.banter_set_league_mute(uuid, boolean) to authenticated, service_role;

-- Service role only.
revoke execute on function public.banter_user_has_access(uuid) from public, anon, authenticated;
revoke execute on function public.banter_push_targets(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.banter_push_results(text[], text[]) from public, anon, authenticated;
grant execute on function public.banter_user_has_access(uuid) to service_role;
grant execute on function public.banter_push_targets(uuid, text, uuid) to service_role;
grant execute on function public.banter_push_results(text[], text[]) to service_role;

-- Expected Security Advisor result: no new errors. The four tables have RLS on with no policies
-- (informational "RLS Enabled No Policy", intended). The five member RPCs show the accepted warning
-- "Signed-In Users Can Execute SECURITY DEFINER" (each checks has_banter_access() first). The three
-- service-role helpers are not executable by anon or signed-in users.

-- ROLLBACK:
--   drop function if exists public.banter_push_results(text[], text[]);
--   drop function if exists public.banter_push_targets(uuid, text, uuid);
--   drop function if exists public.banter_user_has_access(uuid);
--   drop function if exists public.banter_set_league_mute(uuid, boolean);
--   drop function if exists public.banter_set_push_settings(boolean, boolean, boolean);
--   drop function if exists public.banter_push_settings();
--   drop function if exists public.banter_remove_push_subscription(text);
--   drop function if exists public.banter_save_push_subscription(text, text, text, text);
--   drop table if exists public.banter_push_log;
--   drop table if exists public.banter_league_mutes;
--   drop table if exists public.banter_push_settings;
--   drop table if exists public.banter_push_subscriptions;
