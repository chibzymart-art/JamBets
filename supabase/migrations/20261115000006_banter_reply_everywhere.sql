-- Banter Hub: reply to any message, everywhere (Discussion topics and league walls), and the
-- message's sender is tagged and notified in-app.
-- Additive only: new columns, recreated Banter functions; nothing in the Predictions Hub changes.
-- Needs 20261115000002_banter_wall.sql and 20261115000005_banter_discussion.sql applied.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner): every message can be replied to and its sender is notified, in Discussion and in
-- league walls. Never notify yourself. Paid members only; banned members' messages stay hidden.
--   * Discussion: Reply on the topic's opening post tags the topic author (kind 'reply').
--   * League walls: a reply must point at a live post in the same league; its author is tagged and
--     notified (kind 'league_reply') while they are still in that league.
--   * League reply notifications show in the same "Replies to you" list, with the league name.
-- Old website calls keep working: every new parameter has a default.

-- ---------------------------------------------------------------------------
-- 1. Columns and constraints
-- ---------------------------------------------------------------------------
alter table public.banter_posts
  add column if not exists reply_to_post_id uuid references public.banter_posts(id) on delete set null,
  add column if not exists tagged_user_id uuid references public.users(id) on delete set null;

alter table public.banter_replies
  add column if not exists reply_to_topic boolean not null default false;

alter table public.banter_notifications alter column topic_id drop not null;
alter table public.banter_notifications
  add column if not exists post_id uuid references public.banter_posts(id) on delete cascade,
  add column if not exists league_id uuid references public.banter_leagues(id) on delete cascade;

alter table public.banter_notifications drop constraint if exists banter_notifications_kind;
alter table public.banter_notifications
  add constraint banter_notifications_kind check (kind in ('reply', 'topic_reply', 'league_reply'));

-- Exactly one target: a Discussion reply (topic + reply) or a league wall post (league + post).
alter table public.banter_notifications drop constraint if exists banter_notifications_one_target;
alter table public.banter_notifications
  add constraint banter_notifications_one_target check (
    (kind in ('reply', 'topic_reply') and topic_id is not null and reply_id is not null and post_id is null and league_id is null)
    or (kind = 'league_reply' and post_id is not null and league_id is not null and topic_id is null and reply_id is null)
  );

-- ---------------------------------------------------------------------------
-- 2. League walls: post (optionally as a reply) and read with reply / tag details.
--    Signatures change, so drop and recreate.
-- ---------------------------------------------------------------------------
drop function if exists public.banter_post(text, uuid);

create or replace function public.banter_post(p_body text, p_league_id uuid default null, p_reply_to uuid default null)
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
  v_target uuid;
  v_tag uuid;
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

  if p_reply_to is not null then
    select p.user_id into v_target
      from public.banter_posts p
     where p.id = p_reply_to
       and p.deleted_at is null
       and p.league_id is not distinct from p_league_id;
    if v_target is null then raise exception 'post_not_found'; end if;
    if v_target <> v_uid then v_tag := v_target; end if;
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

  insert into public.banter_posts (user_id, league_id, body, reply_to_post_id, tagged_user_id)
  values (v_uid, p_league_id, v_body, p_reply_to, v_tag)
  returning id, created_at into v_id, v_created;

  -- Notify the tagged member (league walls only, never yourself, only while they are in the league).
  if v_tag is not null and p_league_id is not null and exists (
    select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = v_tag
  ) then
    insert into public.banter_notifications (user_id, kind, league_id, post_id, from_user_id)
    values (v_tag, 'league_reply', p_league_id, v_id, v_uid);
  end if;

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

drop function if exists public.banter_wall(uuid, timestamptz, integer);

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
  can_delete boolean,
  tagged_handle text,
  tagged_is_me boolean,
  reply_to jsonb
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
         (p.user_id = v_uid or v_admin),
         tp.handle,
         (p.tagged_user_id is not null and p.tagged_user_id = v_uid),
         case
           when p.reply_to_post_id is null then null
           when q.id is null or q.deleted_at is not null or qp.leaderboard_banned
             then jsonb_build_object('id', p.reply_to_post_id, 'removed', true)
           else jsonb_build_object('id', q.id, 'handle', qp.handle, 'preview', left(q.body, 120), 'removed', false)
         end
    from public.banter_posts p
    join public.player_profiles pp on pp.user_id = p.user_id
    left join public.player_profiles tp on tp.user_id = p.tagged_user_id
    left join public.banter_posts q on q.id = p.reply_to_post_id
    left join public.player_profiles qp on qp.user_id = q.user_id
   where p.deleted_at is null
     and not pp.leaderboard_banned
     and (case when p_league_id is null then p.league_id is null else p.league_id = p_league_id end)
     and (p_before is null or p.created_at < p_before)
   order by p.created_at desc
   limit v_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Discussion: reply to the opening post explicitly (tags the topic author).
-- ---------------------------------------------------------------------------
drop function if exists public.banter_post_reply(uuid, text, uuid);

create or replace function public.banter_post_reply(
  p_topic_id uuid,
  p_body text,
  p_reply_to uuid default null,
  p_reply_to_topic boolean default false
)
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
  v_to_topic boolean := coalesce(p_reply_to_topic, false) and p_reply_to is null;
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
  elsif v_to_topic then
    v_target := v_topic_author;
  end if;

  v_uid := public.banter_discussion_guard();

  insert into public.banter_replies (topic_id, user_id, body, reply_to_reply_id, reply_to_topic, tagged_user_id)
  values (p_topic_id, v_uid, v_body, p_reply_to, v_to_topic,
          case when v_target is not null and v_target <> v_uid then v_target end)
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

-- Same signature as before (jsonb result), so create or replace. Replies to the opening post carry
-- reply_to = { topic: true, handle, preview }.
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
                 when r.reply_to_topic then jsonb_build_object(
                   'id', p_topic_id, 'topic', true, 'handle', v_topic->>'handle',
                   'preview', left(v_topic->>'body', 120), 'removed', false)
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

-- ---------------------------------------------------------------------------
-- 4. Notifications: both kinds in one list (return type changes, so drop and recreate).
-- ---------------------------------------------------------------------------
drop function if exists public.banter_my_notifications(integer);

create or replace function public.banter_my_notifications(p_limit integer default 30)
returns table (
  id uuid,
  kind text,
  topic_id uuid,
  topic_title text,
  reply_id uuid,
  league_id uuid,
  league_name text,
  post_id uuid,
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
  select * from (
    select n.id, n.kind, n.topic_id, t.title, n.reply_id, null::uuid, null::text, null::uuid,
           left(r.body, 120), fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null)
      from public.banter_notifications n
      join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      join public.player_profiles fp on fp.user_id = r.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.kind in ('reply', 'topic_reply')
    union all
    select n.id, n.kind, null::uuid, null::text, null::uuid, n.league_id, l.name, n.post_id,
           left(p.body, 120), fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null)
      from public.banter_notifications n
      join public.banter_leagues l on l.id = n.league_id
      join public.banter_league_members m on m.league_id = n.league_id and m.user_id = v_uid
      join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
      join public.player_profiles fp on fp.user_id = p.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.kind = 'league_reply'
  ) x
  order by x.created_at desc
  limit v_limit;
end;
$$;

-- Unread notifications of both kinds (0 for anyone without access).
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
     where n.user_id = v_uid and n.read_at is null and n.kind in ('reply', 'topic_reply')
  ) + (
    select count(*)::integer
      from public.banter_notifications n
      join public.banter_league_members m on m.league_id = n.league_id and m.user_id = v_uid
      join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
      join public.player_profiles fp on fp.user_id = p.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.read_at is null and n.kind = 'league_reply'
  );
end;
$$;

-- banter_mark_notifications_read(uuid[]) is unchanged: it already marks only the caller's own rows,
-- whatever their kind.

revoke execute on function public.banter_post(text, uuid, uuid) from public, anon;
revoke execute on function public.banter_wall(uuid, timestamptz, integer) from public, anon;
revoke execute on function public.banter_post_reply(uuid, text, uuid, boolean) from public, anon;
revoke execute on function public.banter_topic(uuid) from public, anon;
revoke execute on function public.banter_my_notifications(integer) from public, anon;
revoke execute on function public.banter_unread_count() from public, anon;
grant execute on function public.banter_post(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.banter_wall(uuid, timestamptz, integer) to authenticated, service_role;
grant execute on function public.banter_post_reply(uuid, text, uuid, boolean) to authenticated, service_role;
grant execute on function public.banter_topic(uuid) to authenticated, service_role;
grant execute on function public.banter_my_notifications(integer) to authenticated, service_role;
grant execute on function public.banter_unread_count() to authenticated, service_role;

-- Expected Security Advisor result: no new errors and no new warning classes; the same functions
-- keep the accepted "Signed-In Users Can Execute SECURITY DEFINER" warning (each checks
-- has_banter_access() first).

-- ROLLBACK:
--   drop function if exists public.banter_post(text, uuid, uuid);
--   drop function if exists public.banter_wall(uuid, timestamptz, integer);
--   drop function if exists public.banter_post_reply(uuid, text, uuid, boolean);
--   drop function if exists public.banter_my_notifications(integer);
--   then re-run banter_post / banter_wall from 20261115000002_banter_wall.sql and banter_post_reply,
--   banter_topic, banter_my_notifications, banter_unread_count (with their grants) from
--   20261115000005_banter_discussion.sql;
--   delete from public.banter_notifications where kind = 'league_reply';
--   alter table public.banter_notifications drop constraint if exists banter_notifications_one_target;
--   alter table public.banter_notifications drop constraint if exists banter_notifications_kind;
--   alter table public.banter_notifications add constraint banter_notifications_kind check (kind in ('reply', 'topic_reply'));
--   alter table public.banter_notifications drop column if exists post_id, drop column if exists league_id;
--   alter table public.banter_notifications alter column topic_id set not null;
--   alter table public.banter_replies drop column if exists reply_to_topic;
--   alter table public.banter_posts drop column if exists reply_to_post_id, drop column if exists tagged_user_id;
