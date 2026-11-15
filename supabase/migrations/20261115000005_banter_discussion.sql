-- Banter Hub: Discussion (topics with threaded replies, reply-to tagging, in-app notifications).
-- Replaces the public wall in the website. League walls stay on banter_posts, unchanged.
-- Additive only: new tables and functions; nothing in the Predictions Hub changes.
-- Needs the earlier Banter migrations applied (has_banter_access, player_profiles, banter_posts).
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner):
--   * Every discussion is a topic (title + opening post). All topics are public to paid members.
--   * Members reply inside a topic. "Reply" to a specific message tags its author in the thread
--     and notifies them in-app (a "Replies to you" list and an unread badge). Nobody is notified
--     about their own messages. The topic's author is notified of new replies too.
--   * Paid members only (has_banter_access); posting needs a Banter username (player_profiles).
--   * Plain text. Title 3 to 120 characters, opening post 1 to 1000, reply 1 to 500 (after trimming).
--   * Rate limits per member across topics and replies: 1 per 10 seconds, 60 per rolling 24 hours.
--   * Members with leaderboard_banned cannot post; their topics and replies are hidden.
--   * Delete = soft delete (deleted_at, deleted_by), by the author or an admin (public.is_admin()).
--   * No direct table access for anyone but the service role; everything goes through the RPCs.
--   * Existing public wall posts (league_id null, not deleted) are copied in as topics:
--     title = first 60 characters, same author and time. The copy is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.banter_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  reply_count integer not null default 0,
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete set null,
  migrated_from_post_id uuid unique references public.banter_posts(id) on delete set null,
  constraint banter_topics_title_length check (char_length(btrim(title)) between 3 and 120),
  constraint banter_topics_body_length check (char_length(btrim(body)) between 1 and 1000)
);

create index if not exists banter_topics_activity_idx
  on public.banter_topics (last_activity_at desc) where deleted_at is null;
create index if not exists banter_topics_user_idx
  on public.banter_topics (user_id, created_at desc);

create table if not exists public.banter_replies (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.banter_topics(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  body text not null,
  reply_to_reply_id uuid references public.banter_replies(id) on delete set null,
  tagged_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references public.users(id) on delete set null,
  constraint banter_replies_body_length check (char_length(btrim(body)) between 1 and 500)
);

create index if not exists banter_replies_topic_idx
  on public.banter_replies (topic_id, created_at);
create index if not exists banter_replies_user_idx
  on public.banter_replies (user_id, created_at desc);

create table if not exists public.banter_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null,
  topic_id uuid not null references public.banter_topics(id) on delete cascade,
  reply_id uuid references public.banter_replies(id) on delete cascade,
  from_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint banter_notifications_kind check (kind in ('reply', 'topic_reply')),
  constraint banter_notifications_not_self check (from_user_id is null or from_user_id <> user_id)
);

create index if not exists banter_notifications_user_idx
  on public.banter_notifications (user_id, created_at desc);
create index if not exists banter_notifications_unread_idx
  on public.banter_notifications (user_id) where read_at is null;

alter table public.banter_topics enable row level security;
alter table public.banter_replies enable row level security;
alter table public.banter_notifications enable row level security;

revoke all on table public.banter_topics from anon, authenticated;
revoke all on table public.banter_replies from anon, authenticated;
revoke all on table public.banter_notifications from anon, authenticated;
grant select, insert, update, delete on table public.banter_topics to service_role;
grant select, insert, update, delete on table public.banter_replies to service_role;
grant select, insert, update, delete on table public.banter_notifications to service_role;
-- No policies: no direct access for anon or signed-in users.

-- ---------------------------------------------------------------------------
-- 2. Copy the public wall into topics (idempotent: one topic per wall post).
-- ---------------------------------------------------------------------------
insert into public.banter_topics (user_id, title, body, created_at, last_activity_at, migrated_from_post_id)
select p.user_id,
       case
         when char_length(t.flat) < 3 then 'Banter: ' || t.flat
         when char_length(t.flat) > 60 then left(t.flat, 60) || '…'
         else t.flat
       end,
       btrim(p.body),
       p.created_at,
       p.created_at,
       p.id
  from public.banter_posts p
  cross join lateral (select btrim(regexp_replace(p.body, '\s+', ' ', 'g')) as flat) t
 where p.league_id is null
   and p.deleted_at is null
on conflict (migrated_from_post_id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. RPCs
-- ---------------------------------------------------------------------------

-- Errors (message = code): not_signed_in, no_access, no_profile, banned, title_invalid,
-- body_invalid, too_fast, daily_limit, topic_not_found, reply_not_found, not_allowed.

-- Shared posting check: signed in, paid, has a username, not banned, within the rate limits.
-- Internal helper (not callable by signed-in users directly).
create or replace function public.banter_discussion_guard()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_banned boolean;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;

  select pp.leaderboard_banned into v_banned from public.player_profiles pp where pp.user_id = v_uid;
  if not found then raise exception 'no_profile'; end if;
  if v_banned then raise exception 'banned'; end if;

  if exists (select 1 from public.banter_topics t where t.user_id = v_uid and t.created_at > now() - interval '10 seconds')
     or exists (select 1 from public.banter_replies r where r.user_id = v_uid and r.created_at > now() - interval '10 seconds') then
    raise exception 'too_fast';
  end if;
  if (select count(*) from public.banter_topics t where t.user_id = v_uid and t.created_at > now() - interval '24 hours')
     + (select count(*) from public.banter_replies r where r.user_id = v_uid and r.created_at > now() - interval '24 hours') >= 60 then
    raise exception 'daily_limit';
  end if;

  return v_uid;
end;
$$;

-- Start a topic.
create or replace function public.banter_create_topic(p_title text, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_title text := btrim(regexp_replace(coalesce(p_title, ''), '\s+', ' ', 'g'));
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_created timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if char_length(v_title) < 3 or char_length(v_title) > 120 then raise exception 'title_invalid'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 1000 then raise exception 'body_invalid'; end if;
  v_uid := public.banter_discussion_guard();

  insert into public.banter_topics (user_id, title, body)
  values (v_uid, v_title, v_body)
  returning id, created_at into v_id, v_created;

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

-- Topic list, most recent activity first. Search matches title or opening post.
create or replace function public.banter_topics(
  p_search text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  title text,
  preview text,
  handle text,
  avatar_emoji text,
  created_at timestamptz,
  last_activity_at timestamptz,
  replies integer,
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
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(replace(replace(btrim(coalesce(p_search, '')), '%', ''), '_', ''), '');
  v_admin boolean;
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;
  v_admin := coalesce(public.is_admin(), false);

  return query
  select t.id, t.title, left(t.body, 160), pp.handle, pp.avatar_emoji, t.created_at, t.last_activity_at,
         (select count(*)::integer
            from public.banter_replies r
            join public.player_profiles rp on rp.user_id = r.user_id
           where r.topic_id = t.id and r.deleted_at is null and not rp.leaderboard_banned),
         (t.user_id = v_uid),
         (t.user_id = v_uid or v_admin)
    from public.banter_topics t
    join public.player_profiles pp on pp.user_id = t.user_id
   where t.deleted_at is null
     and not pp.leaderboard_banned
     and (v_search is null or t.title ilike '%' || v_search || '%' or t.body ilike '%' || v_search || '%')
   order by t.last_activity_at desc, t.id
   limit v_limit offset v_offset;
end;
$$;

-- One topic with its replies (oldest first, up to 300). Hidden replies are left out; a reply to a
-- hidden message shows the quote as removed.
create or replace function public.banter_topic(p_topic_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_admin boolean;
  v_topic jsonb;
  v_replies jsonb;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  v_admin := coalesce(public.is_admin(), false);

  select jsonb_build_object(
           'id', t.id, 'title', t.title, 'body', t.body, 'handle', pp.handle, 'avatar_emoji', pp.avatar_emoji,
           'created_at', t.created_at, 'last_activity_at', t.last_activity_at,
           'is_me', t.user_id = v_uid, 'can_delete', t.user_id = v_uid or v_admin)
    into v_topic
    from public.banter_topics t
    join public.player_profiles pp on pp.user_id = t.user_id
   where t.id = p_topic_id and t.deleted_at is null and not pp.leaderboard_banned;
  if v_topic is null then raise exception 'topic_not_found'; end if;

  select coalesce(jsonb_agg(x.j order by x.created_at), '[]'::jsonb)
    into v_replies
    from (
      select r.created_at,
             jsonb_build_object(
               'id', r.id, 'body', r.body, 'handle', rp.handle, 'avatar_emoji', rp.avatar_emoji,
               'created_at', r.created_at, 'is_me', r.user_id = v_uid, 'can_delete', r.user_id = v_uid or v_admin,
               'tagged_handle', tp.handle, 'tagged_is_me', r.tagged_user_id is not null and r.tagged_user_id = v_uid,
               'reply_to', case
                 when r.reply_to_reply_id is null then null
                 when q.id is null or q.deleted_at is not null or qp.leaderboard_banned then jsonb_build_object('id', r.reply_to_reply_id, 'removed', true)
                 else jsonb_build_object('id', q.id, 'handle', qp.handle, 'preview', left(q.body, 120), 'removed', false)
               end
             ) as j
        from public.banter_replies r
        join public.player_profiles rp on rp.user_id = r.user_id
        left join public.player_profiles tp on tp.user_id = r.tagged_user_id
        left join public.banter_replies q on q.id = r.reply_to_reply_id
        left join public.player_profiles qp on qp.user_id = q.user_id
       where r.topic_id = p_topic_id and r.deleted_at is null and not rp.leaderboard_banned
       order by r.created_at desc
       limit 300
    ) x;

  return jsonb_build_object('topic', v_topic, 'replies', v_replies);
end;
$$;

-- Reply in a topic, optionally to one message (tags and notifies its author).
create or replace function public.banter_post_reply(p_topic_id uuid, p_body text, p_reply_to uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_body text := btrim(coalesce(p_body, ''));
  v_topic_author uuid;
  v_target uuid;
  v_id uuid;
  v_created timestamptz;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'body_invalid'; end if;

  select t.user_id into v_topic_author
    from public.banter_topics t
    join public.player_profiles pp on pp.user_id = t.user_id
   where t.id = p_topic_id and t.deleted_at is null and not pp.leaderboard_banned;
  if v_topic_author is null then raise exception 'topic_not_found'; end if;

  if p_reply_to is not null then
    select r.user_id into v_target
      from public.banter_replies r
     where r.id = p_reply_to and r.topic_id = p_topic_id and r.deleted_at is null;
    if v_target is null then raise exception 'reply_not_found'; end if;
  end if;

  v_uid := public.banter_discussion_guard();

  insert into public.banter_replies (topic_id, user_id, body, reply_to_reply_id, tagged_user_id)
  values (p_topic_id, v_uid, v_body, p_reply_to, case when v_target is not null and v_target <> v_uid then v_target end)
  returning id, created_at into v_id, v_created;

  update public.banter_topics
     set last_activity_at = v_created, reply_count = reply_count + 1
   where id = p_topic_id;

  -- Notifications: the tagged member, then the topic's author (once each, never yourself).
  if v_target is not null and v_target <> v_uid then
    insert into public.banter_notifications (user_id, kind, topic_id, reply_id, from_user_id)
    values (v_target, 'reply', p_topic_id, v_id, v_uid);
  end if;
  if v_topic_author <> v_uid and v_topic_author is distinct from v_target then
    insert into public.banter_notifications (user_id, kind, topic_id, reply_id, from_user_id)
    values (v_topic_author, 'topic_reply', p_topic_id, v_id, v_uid);
  end if;

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

-- Soft-delete a topic: its author, or an admin. Returns true when it was hidden.
create or replace function public.banter_delete_topic(p_topic_id uuid)
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

  select t.user_id, t.deleted_at into v_author, v_deleted from public.banter_topics t where t.id = p_topic_id;
  if v_author is null then raise exception 'topic_not_found'; end if;
  if v_author <> v_uid and not coalesce(public.is_admin(), false) then raise exception 'not_allowed'; end if;
  if v_deleted is not null then return false; end if;

  update public.banter_topics set deleted_at = now(), deleted_by = v_uid where id = p_topic_id and deleted_at is null;
  return true;
end;
$$;

-- Soft-delete a reply: its author, or an admin. Returns true when it was hidden.
create or replace function public.banter_delete_reply(p_reply_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_author uuid;
  v_topic uuid;
  v_deleted timestamptz;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;

  select r.user_id, r.topic_id, r.deleted_at into v_author, v_topic, v_deleted
    from public.banter_replies r where r.id = p_reply_id;
  if v_author is null then raise exception 'reply_not_found'; end if;
  if v_author <> v_uid and not coalesce(public.is_admin(), false) then raise exception 'not_allowed'; end if;
  if v_deleted is not null then return false; end if;

  update public.banter_replies set deleted_at = now(), deleted_by = v_uid where id = p_reply_id and deleted_at is null;
  update public.banter_topics set reply_count = greatest(reply_count - 1, 0) where id = v_topic;
  return true;
end;
$$;

-- The caller's own notifications, newest first (hidden topics and replies are left out).
create or replace function public.banter_my_notifications(p_limit integer default 30)
returns table (
  id uuid,
  kind text,
  topic_id uuid,
  topic_title text,
  reply_id uuid,
  preview text,
  from_handle text,
  from_avatar text,
  created_at timestamptz,
  is_read boolean
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
begin
  if v_uid is null or not public.has_banter_access() then
    return;
  end if;

  return query
  select n.id, n.kind, n.topic_id, t.title, n.reply_id, left(r.body, 120), fp.handle, fp.avatar_emoji,
         n.created_at, (n.read_at is not null)
    from public.banter_notifications n
    join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
    join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
    join public.player_profiles fp on fp.user_id = r.user_id and not fp.leaderboard_banned
   where n.user_id = v_uid
   order by n.created_at desc
   limit v_limit;
end;
$$;

-- Unread notifications for the Discussion tab badge (0 for anyone without access).
create or replace function public.banter_unread_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not public.has_banter_access() then
    return 0;
  end if;

  return (
    select count(*)::integer
      from public.banter_notifications n
      join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      join public.player_profiles fp on fp.user_id = r.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.read_at is null
  );
end;
$$;

-- Mark the caller's notifications read: the given ids, or all of them when p_ids is null.
create or replace function public.banter_mark_notifications_read(p_ids uuid[] default null)
returns integer
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

  update public.banter_notifications n
     set read_at = now()
   where n.user_id = v_uid
     and n.read_at is null
     and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The guard is internal: only the other functions (running as owner) call it.
revoke execute on function public.banter_discussion_guard() from public, anon, authenticated;

revoke execute on function public.banter_create_topic(text, text) from public, anon;
revoke execute on function public.banter_topics(text, integer, integer) from public, anon;
revoke execute on function public.banter_topic(uuid) from public, anon;
revoke execute on function public.banter_post_reply(uuid, text, uuid) from public, anon;
revoke execute on function public.banter_delete_topic(uuid) from public, anon;
revoke execute on function public.banter_delete_reply(uuid) from public, anon;
revoke execute on function public.banter_my_notifications(integer) from public, anon;
revoke execute on function public.banter_unread_count() from public, anon;
revoke execute on function public.banter_mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.banter_create_topic(text, text) to authenticated, service_role;
grant execute on function public.banter_topics(text, integer, integer) to authenticated, service_role;
grant execute on function public.banter_topic(uuid) to authenticated, service_role;
grant execute on function public.banter_post_reply(uuid, text, uuid) to authenticated, service_role;
grant execute on function public.banter_delete_topic(uuid) to authenticated, service_role;
grant execute on function public.banter_delete_reply(uuid) to authenticated, service_role;
grant execute on function public.banter_my_notifications(integer) to authenticated, service_role;
grant execute on function public.banter_unread_count() to authenticated, service_role;
grant execute on function public.banter_mark_notifications_read(uuid[]) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. The three tables have RLS on with no policies
-- (informational "RLS Enabled No Policy", intended: no direct access). The nine callable RPCs show
-- the accepted warning class "Signed-In Users Can Execute SECURITY DEFINER"; each checks
-- has_banter_access() first. banter_discussion_guard is not executable by anon or signed-in users.

-- ROLLBACK:
--   drop function if exists public.banter_mark_notifications_read(uuid[]);
--   drop function if exists public.banter_unread_count();
--   drop function if exists public.banter_my_notifications(integer);
--   drop function if exists public.banter_delete_reply(uuid);
--   drop function if exists public.banter_delete_topic(uuid);
--   drop function if exists public.banter_post_reply(uuid, text, uuid);
--   drop function if exists public.banter_topic(uuid);
--   drop function if exists public.banter_topics(text, integer, integer);
--   drop function if exists public.banter_create_topic(text, text);
--   drop function if exists public.banter_discussion_guard();
--   drop table if exists public.banter_notifications;
--   drop table if exists public.banter_replies;
--   drop table if exists public.banter_topics;
--   (banter_posts, including the original public wall posts, is untouched.)
