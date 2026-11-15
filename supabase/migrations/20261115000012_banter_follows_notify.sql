-- Banter Hub: everyone in a thread is notified of new messages, @ suggestions start with the people
-- in the current topic, and members can follow each other.
-- Additive only: one new table, new columns, new / recreated Banter functions; nothing in the
-- Predictions Hub changes. Needs the Banter migrations up to 20261115000009 applied. It does not
-- touch anything 20261115000010 (share pick) or 20261115000011 (weekly winner) create, so those can
-- be applied before or after this one.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner):
--   1. A new message notifies everyone in the thread: in a topic, its starter and everyone who has
--      replied; in a league chat, every league member. One notification per person per message (a
--      reply to you, a tag or a mention wins over the general kind 'thread_message'), never the
--      sender, in-app and by push (push settings: "thread messages" for topics, "league messages"
--      for leagues, mutes respected).
--   2. Typing @ lists the people in the current topic (or league) straight away, then narrows.
--   3. Follow members. Followers are told (kinds 'follow_pick', 'follow_topic', 'follow_post') when
--      that member makes a pick, starts a topic or replies in Discussion. League chat posts reach
--      only league members (who already get the thread notification), so private leagues stay
--      private. Being followed is notified too (kind 'follower'). Several picks in a row from the
--      same member collapse into one unread notification ("made 3 picks").
--   Paid members only; banned members can't follow or be suggested; never yourself.

-- ---------------------------------------------------------------------------
-- 1. Follows, settings, notification columns
-- ---------------------------------------------------------------------------
create table if not exists public.banter_follows (
  follower_id uuid not null references public.users(id) on delete cascade,
  followee_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint banter_follows_not_self check (follower_id <> followee_id)
);
create index if not exists banter_follows_followee_idx on public.banter_follows (followee_id);

alter table public.banter_follows enable row level security;
revoke all on table public.banter_follows from anon, authenticated;
grant select, insert, update, delete on table public.banter_follows to service_role;
-- No policies: no direct access for anon or signed-in users.

alter table public.banter_push_settings
  add column if not exists thread_messages boolean not null default true,
  add column if not exists follows boolean not null default true;

alter table public.banter_notifications
  add column if not exists pick_id uuid references public.football_user_picks(id) on delete cascade,
  add column if not exists item_count integer not null default 1;

alter table public.banter_notifications drop constraint if exists banter_notifications_kind;
alter table public.banter_notifications
  add constraint banter_notifications_kind check (kind in (
    'reply', 'topic_reply', 'league_reply', 'reaction', 'mention',
    'thread_message', 'follow_pick', 'follow_topic', 'follow_post', 'follower'));

alter table public.banter_notifications drop constraint if exists banter_notifications_one_target;
alter table public.banter_notifications
  add constraint banter_notifications_one_target check (
    (kind in ('reply', 'topic_reply') and topic_id is not null and reply_id is not null and post_id is null and league_id is null)
    or (kind = 'league_reply' and post_id is not null and league_id is not null and topic_id is null and reply_id is null)
    or (kind = 'reaction' and reaction_id is not null and reaction is not null and (
         (topic_id is not null and post_id is null and league_id is null)
         or (post_id is not null and league_id is not null and topic_id is null and reply_id is null)))
    or (kind in ('mention', 'thread_message', 'follow_post', 'follow_topic') and (
         (topic_id is not null and post_id is null and league_id is null)
         or (post_id is not null and league_id is not null and topic_id is null and reply_id is null)))
    or (kind = 'follow_pick' and pick_id is not null and topic_id is null and reply_id is null and post_id is null and league_id is null)
    or (kind = 'follower' and pick_id is null and topic_id is null and reply_id is null and post_id is null and league_id is null)
  );

create index if not exists banter_notifications_reply_idx on public.banter_notifications (reply_id) where reply_id is not null;
create index if not exists banter_notifications_post_idx on public.banter_notifications (post_id) where post_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Fan-out helpers (internal): followers and thread members of one new message
-- ---------------------------------------------------------------------------

-- Discussion reply: followers of the writer, then everyone else in the topic. Skips anyone this
-- reply already notified (reply / topic_reply / mention), the writer, banned members, no access.
create or replace function public.banter_fanout_reply(p_reply_id uuid, p_topic_id uuid, p_author uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.banter_notifications (user_id, kind, topic_id, reply_id, from_user_id)
  select f.follower_id, 'follow_post', p_topic_id, p_reply_id, p_author
    from public.banter_follows f
    join public.player_profiles pp on pp.user_id = f.follower_id and not pp.leaderboard_banned
   where f.followee_id = p_author
     and not exists (select 1 from public.banter_notifications n where n.reply_id = p_reply_id and n.user_id = f.follower_id)
     and public.banter_user_has_access(f.follower_id);

  insert into public.banter_notifications (user_id, kind, topic_id, reply_id, from_user_id)
  select u.uid, 'thread_message', p_topic_id, p_reply_id, p_author
    from (
      select t.user_id as uid from public.banter_topics t where t.id = p_topic_id
      union
      select r.user_id from public.banter_replies r where r.topic_id = p_topic_id and r.deleted_at is null
    ) u
    join public.player_profiles pp on pp.user_id = u.uid and not pp.leaderboard_banned
   where u.uid <> p_author
     and not exists (select 1 from public.banter_notifications n where n.reply_id = p_reply_id and n.user_id = u.uid)
     and public.banter_user_has_access(u.uid);
end;
$$;

-- League chat post: every other league member not already notified by it.
create or replace function public.banter_fanout_post(p_post_id uuid, p_league_id uuid, p_author uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.banter_notifications (user_id, kind, post_id, league_id, from_user_id)
  select m.user_id, 'thread_message', p_post_id, p_league_id, p_author
    from public.banter_league_members m
    join public.player_profiles pp on pp.user_id = m.user_id and not pp.leaderboard_banned
   where m.league_id = p_league_id
     and m.user_id <> p_author
     and not exists (select 1 from public.banter_notifications n where n.post_id = p_post_id and n.user_id = m.user_id)
     and public.banter_user_has_access(m.user_id);
end;
$$;

-- New topic: followers of the writer not already notified (a mention wins).
create or replace function public.banter_fanout_topic(p_topic_id uuid, p_author uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  insert into public.banter_notifications (user_id, kind, topic_id, from_user_id)
  select f.follower_id, 'follow_topic', p_topic_id, p_author
    from public.banter_follows f
    join public.player_profiles pp on pp.user_id = f.follower_id and not pp.leaderboard_banned
   where f.followee_id = p_author
     and not exists (select 1 from public.banter_notifications n
                      where n.topic_id = p_topic_id and n.reply_id is null and n.user_id = f.follower_id)
     and public.banter_user_has_access(f.follower_id);
end;
$$;

-- New pick (trigger on the member's own Banter picks): followers get one unread 'follow_pick' that
-- collapses further picks from the same member within 6 hours ("made 3 picks").
create or replace function public.banter_fanout_pick()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Notifications must never stop a pick from saving: any error here is logged and ignored.
  begin
    if exists (select 1 from public.player_profiles pp where pp.user_id = new.user_id and pp.leaderboard_banned) then
      return new;
    end if;

    update public.banter_notifications n
       set pick_id = new.id, item_count = n.item_count + 1, created_at = now()
     where n.kind = 'follow_pick' and n.from_user_id = new.user_id and n.read_at is null
       and n.created_at > now() - interval '6 hours'
       and n.user_id in (select f.follower_id from public.banter_follows f where f.followee_id = new.user_id);

    insert into public.banter_notifications (user_id, kind, pick_id, from_user_id)
    select f.follower_id, 'follow_pick', new.id, new.user_id
      from public.banter_follows f
      join public.player_profiles pp on pp.user_id = f.follower_id and not pp.leaderboard_banned
     where f.followee_id = new.user_id
       and not exists (select 1 from public.banter_notifications n
                        where n.kind = 'follow_pick' and n.from_user_id = new.user_id and n.user_id = f.follower_id
                          and n.read_at is null and n.created_at > now() - interval '6 hours')
       and public.banter_user_has_access(f.follower_id);
  exception when others then
    raise warning 'banter_fanout_pick skipped for pick %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists banter_fanout_pick on public.football_user_picks;
create trigger banter_fanout_pick
  after insert on public.football_user_picks
  for each row execute function public.banter_fanout_pick();

-- ---------------------------------------------------------------------------
-- 3. Post functions add the fan-out (0009 bodies plus one call each; same signatures)
-- ---------------------------------------------------------------------------
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

  perform public.banter_apply_mentions('topic', v_id, v_body, v_uid, v_id, null, '{}');
  perform public.banter_fanout_topic(v_id, v_uid);

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

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

  if v_target is not null and v_target <> v_uid then
    insert into public.banter_notifications (user_id, kind, topic_id, reply_id, from_user_id)
    values (v_target, 'reply', p_topic_id, v_id, v_uid);
  end if;
  if v_topic_author <> v_uid and v_topic_author is distinct from v_target then
    insert into public.banter_notifications (user_id, kind, topic_id, reply_id, from_user_id)
    values (v_topic_author, 'topic_reply', p_topic_id, v_id, v_uid);
  end if;

  perform public.banter_apply_mentions('reply', v_id, v_body, v_uid, p_topic_id, null,
                                       array_remove(array[v_target, v_topic_author], null));
  -- Followers, then everyone else in the thread (each only once per message).
  perform public.banter_fanout_reply(v_id, p_topic_id, v_uid);

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

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

  if v_tag is not null and p_league_id is not null and exists (
    select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = v_tag
  ) then
    insert into public.banter_notifications (user_id, kind, league_id, post_id, from_user_id)
    values (v_tag, 'league_reply', p_league_id, v_id, v_uid);
  end if;

  if p_league_id is not null then
    perform public.banter_apply_mentions('post', v_id, v_body, v_uid, null, p_league_id,
                                         array_remove(array[v_tag], null));
    -- Every other member of the league (only once per message).
    perform public.banter_fanout_post(v_id, p_league_id, v_uid);
  end if;

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. @ suggestions: the people in this topic (or league) first, before any letter is typed.
--    Signature changes (adds p_topic_id), so drop and recreate.
-- ---------------------------------------------------------------------------
drop function if exists public.banter_search_handles(text, uuid);

create or replace function public.banter_search_handles(p_prefix text, p_league_id uuid default null, p_topic_id uuid default null)
returns table (handle text, avatar_emoji text, in_thread boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_prefix text := lower(regexp_replace(coalesce(p_prefix, ''), '[^A-Za-z0-9_]', '', 'g'));
begin
  if v_uid is null or not public.has_banter_access() then return; end if;
  if char_length(v_prefix) > 20 then return; end if;
  if p_league_id is not null and not exists (
    select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = v_uid
  ) then
    return;
  end if;

  return query
  with thread as (
    select t.user_id as uid from public.banter_topics t where p_topic_id is not null and t.id = p_topic_id and t.deleted_at is null
    union
    select r.user_id from public.banter_replies r where p_topic_id is not null and r.topic_id = p_topic_id and r.deleted_at is null
  )
  select pp.handle, pp.avatar_emoji, (p_league_id is not null or exists (select 1 from thread th where th.uid = pp.user_id))
    from public.player_profiles pp
   where not pp.leaderboard_banned
     and pp.user_id <> v_uid
     and lower(pp.handle) like v_prefix || '%'
     and (p_league_id is null or exists (
           select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = pp.user_id))
     -- Nothing typed yet: only the people in this topic / league.
     and (v_prefix <> '' or p_league_id is not null or exists (select 1 from thread th where th.uid = pp.user_id))
   order by exists (select 1 from thread th where th.uid = pp.user_id) desc, char_length(pp.handle), lower(pp.handle)
   limit 8;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Follow RPCs
-- ---------------------------------------------------------------------------
-- Follow or unfollow a member by username. Errors: not_signed_in, no_access, no_profile, banned,
-- member_not_found, too_fast (60 changes an hour), too_many_follows (500).
create or replace function public.banter_follow(p_handle text, p_follow boolean)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_banned boolean;
  v_target uuid;
  v_n integer;
  v_note uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  select pp.leaderboard_banned into v_banned from public.player_profiles pp where pp.user_id = v_uid;
  if not found then raise exception 'no_profile'; end if;
  if v_banned then raise exception 'banned'; end if;

  select pp.user_id into v_target from public.player_profiles pp
   where lower(pp.handle) = lower(btrim(coalesce(p_handle, ''))) and not pp.leaderboard_banned;
  if v_target is null or v_target = v_uid then raise exception 'member_not_found'; end if;

  if coalesce(p_follow, false) then
    if (select count(*) from public.banter_follows f where f.follower_id = v_uid) >= 500 then
      raise exception 'too_many_follows';
    end if;
    if (select count(*) from public.banter_follows f where f.follower_id = v_uid and f.created_at > now() - interval '1 hour') >= 60 then
      raise exception 'too_fast';
    end if;
    insert into public.banter_follows (follower_id, followee_id) values (v_uid, v_target) on conflict do nothing;
    get diagnostics v_n = row_count;
    -- Tell them (once a day per follower, so follow / unfollow loops don't spam).
    if v_n > 0 and not exists (
      select 1 from public.banter_notifications n
       where n.kind = 'follower' and n.user_id = v_target and n.from_user_id = v_uid and n.created_at > now() - interval '1 day'
    ) then
      insert into public.banter_notifications (user_id, kind, from_user_id) values (v_target, 'follower', v_uid)
      returning id into v_note;
    end if;
  else
    delete from public.banter_follows where follower_id = v_uid and followee_id = v_target;
  end if;

  return jsonb_build_object(
    'following', exists (select 1 from public.banter_follows f where f.follower_id = v_uid and f.followee_id = v_target),
    'followers', (select count(*) from public.banter_follows f where f.followee_id = v_target),
    -- For the push sender (api/banter-push.ts, kind 'follow'); null when nobody was notified.
    'notification_id', v_note
  );
end;
$$;

-- A member's card: username, avatar, follower counts, whether you follow them, all-time record.
create or replace function public.banter_member(p_handle text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pp public.player_profiles%rowtype;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  select * into v_pp from public.player_profiles pp
   where lower(pp.handle) = lower(btrim(coalesce(p_handle, ''))) and not pp.leaderboard_banned;
  if v_pp.user_id is null then raise exception 'member_not_found'; end if;

  return jsonb_build_object(
    'handle', v_pp.handle,
    'avatar_emoji', v_pp.avatar_emoji,
    'is_me', v_pp.user_id = v_uid,
    'is_following', exists (select 1 from public.banter_follows f where f.follower_id = v_uid and f.followee_id = v_pp.user_id),
    'follows_you', exists (select 1 from public.banter_follows f where f.follower_id = v_pp.user_id and f.followee_id = v_uid),
    'followers', (select count(*) from public.banter_follows f where f.followee_id = v_pp.user_id),
    'following', (select count(*) from public.banter_follows f where f.follower_id = v_pp.user_id),
    'record', (select jsonb_build_object(
                 'settled', count(*),
                 'won', count(*) filter (where k.status = 'won'),
                 'lost', count(*) filter (where k.status = 'lost'),
                 'points', coalesce(sum(k.points), 0))
                 from public.football_user_picks k
                where k.user_id = v_pp.user_id and k.status in ('won', 'lost', 'void'))
  );
end;
$$;

-- The caller's followers / following counts and lists (latest 100 each).
create or replace function public.banter_my_follows()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  return jsonb_build_object(
    'followers', (select count(*) from public.banter_follows f
                    join public.player_profiles pp on pp.user_id = f.follower_id and not pp.leaderboard_banned
                   where f.followee_id = v_uid),
    'following', (select count(*) from public.banter_follows f
                    join public.player_profiles pp on pp.user_id = f.followee_id and not pp.leaderboard_banned
                   where f.follower_id = v_uid),
    'followers_list', coalesce((select jsonb_agg(jsonb_build_object('handle', x.handle, 'avatar_emoji', x.avatar_emoji) order by x.created_at desc)
                                  from (select pp.handle, pp.avatar_emoji, f.created_at
                                          from public.banter_follows f
                                          join public.player_profiles pp on pp.user_id = f.follower_id and not pp.leaderboard_banned
                                         where f.followee_id = v_uid
                                         order by f.created_at desc limit 100) x), '[]'::jsonb),
    'following_list', coalesce((select jsonb_agg(jsonb_build_object('handle', x.handle, 'avatar_emoji', x.avatar_emoji) order by x.created_at desc)
                                  from (select pp.handle, pp.avatar_emoji, f.created_at
                                          from public.banter_follows f
                                          join public.player_profiles pp on pp.user_id = f.followee_id and not pp.leaderboard_banned
                                         where f.follower_id = v_uid
                                         order by f.created_at desc limit 100) x), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Push settings gain "thread messages" and "follows" (set: signature changes)
-- ---------------------------------------------------------------------------
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
    'thread_messages', coalesce(v_s.thread_messages, true),
    'follows', coalesce(v_s.follows, true),
    'muted_leagues', coalesce((select jsonb_agg(m.league_id) from public.banter_league_mutes m where m.user_id = v_uid), '[]'::jsonb),
    'devices', (select count(*) from public.banter_push_subscriptions s where s.user_id = v_uid)
  );
end;
$$;

drop function if exists public.banter_set_push_settings(boolean, boolean, boolean);

-- Null keeps the current value, so the older three-setting website call keeps working.
create or replace function public.banter_set_push_settings(
  p_replies boolean default null,
  p_league_messages boolean default null,
  p_league_activity boolean default null,
  p_thread_messages boolean default null,
  p_follows boolean default null
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
  insert into public.banter_push_settings (user_id, replies, league_messages, league_activity, thread_messages, follows, updated_at)
  values (v_uid, coalesce(p_replies, true), coalesce(p_league_messages, true), coalesce(p_league_activity, true),
          coalesce(p_thread_messages, true), coalesce(p_follows, true), now())
  on conflict (user_id) do update
    set replies = coalesce(p_replies, public.banter_push_settings.replies),
        league_messages = coalesce(p_league_messages, public.banter_push_settings.league_messages),
        league_activity = coalesce(p_league_activity, public.banter_push_settings.league_activity),
        thread_messages = coalesce(p_thread_messages, public.banter_push_settings.thread_messages),
        follows = coalesce(p_follows, public.banter_push_settings.follows),
        updated_at = now();
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. "Replies to you" and the badge include the new kinds (0009 versions; reaction-style branch
--    for every kind that names its sender in from_user_id). Return type changes (adds pick and
--    item_count), so drop and recreate the list.
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
  is_read boolean,
  reaction text,
  item_count integer
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
           left(r.body, 120), fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null), null::text, 1
      from public.banter_notifications n
      join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      join public.player_profiles fp on fp.user_id = r.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.kind in ('reply', 'topic_reply')
    union all
    select n.id, n.kind, null::uuid, null::text, null::uuid, n.league_id, l.name, n.post_id,
           left(p.body, 120), fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null), null::text, 1
      from public.banter_notifications n
      join public.banter_leagues l on l.id = n.league_id
      join public.banter_league_members m on m.league_id = n.league_id and m.user_id = v_uid
      join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
      join public.player_profiles fp on fp.user_id = p.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.kind = 'league_reply'
    union all
    select n.id, n.kind, n.topic_id, t.title, n.reply_id, n.league_id, l.name, n.post_id,
           left(coalesce(r.body, p.body, t.body), 120), fp.handle, fp.avatar_emoji, n.created_at,
           (n.read_at is not null), n.reaction, 1
      from public.banter_notifications n
      join public.player_profiles fp on fp.user_id = n.from_user_id and not fp.leaderboard_banned
      left join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      left join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      left join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
      left join public.banter_leagues l on l.id = n.league_id
     where n.user_id = v_uid and n.kind in ('reaction', 'mention', 'thread_message', 'follow_post', 'follow_topic')
       and (
         (n.topic_id is not null and t.id is not null and (n.reply_id is null or r.id is not null))
         or (n.post_id is not null and p.id is not null and exists (
               select 1 from public.banter_league_members m where m.league_id = n.league_id and m.user_id = v_uid))
       )
    union all
    -- A followed member's picks: "Arsenal v Chelsea" with the market / selection in the preview.
    select n.id, n.kind, null::uuid, null::text, null::uuid, null::uuid, null::text, null::uuid,
           left(coalesce(ht.name, 'Home') || ' v ' || coalesce(awt.name, 'Away') || ' · ' || k.market || ' ' || k.selection, 120),
           fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null), null::text, n.item_count
      from public.banter_notifications n
      join public.player_profiles fp on fp.user_id = n.from_user_id and not fp.leaderboard_banned
      join public.football_user_picks k on k.id = n.pick_id
      join public.football_fixtures f on f.id = k.fixture_id
      left join public.football_teams ht on ht.id = f.home_team_id
      left join public.football_teams awt on awt.id = f.away_team_id
     where n.user_id = v_uid and n.kind = 'follow_pick'
    union all
    select n.id, n.kind, null::uuid, null::text, null::uuid, null::uuid, null::text, null::uuid,
           null::text, fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null), null::text, 1
      from public.banter_notifications n
      join public.player_profiles fp on fp.user_id = n.from_user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.kind = 'follower'
  ) x
  order by x.created_at desc
  limit v_limit;
end;
$$;

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
  ) + (
    select count(*)::integer
      from public.banter_notifications n
      join public.player_profiles fp on fp.user_id = n.from_user_id and not fp.leaderboard_banned
      left join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      left join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      left join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
     where n.user_id = v_uid and n.read_at is null
       and n.kind in ('reaction', 'mention', 'thread_message', 'follow_post', 'follow_topic')
       and (
         (n.topic_id is not null and t.id is not null and (n.reply_id is null or r.id is not null))
         or (n.post_id is not null and p.id is not null and exists (
               select 1 from public.banter_league_members m where m.league_id = n.league_id and m.user_id = v_uid))
       )
  ) + (
    select count(*)::integer
      from public.banter_notifications n
      join public.player_profiles fp on fp.user_id = n.from_user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.read_at is null and n.kind in ('follow_pick', 'follower')
       and (n.kind = 'follower' or exists (select 1 from public.football_user_picks k where k.id = n.pick_id))
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Push follows the notifications: for a reply / post / topic, everyone this message notified
--    gets a push (setting by kind, league mutes for general league messages). New kinds: 'pick'
--    (followers; only the first pick in a run) and 'follow' (p_id = the 'follower' notification id
--    that banter_follow returned). 'join' and 'reaction' are as in 0009.
-- ---------------------------------------------------------------------------
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
  if p_sender is null or p_id is null
     or p_kind not in ('reply', 'post', 'join', 'reaction', 'topic', 'pick', 'follow') then return; end if;

  select pp.handle, pp.leaderboard_banned into v_handle, v_banned from public.player_profiles pp where pp.user_id = p_sender;
  if v_handle is null or v_banned or not public.banter_user_has_access(p_sender) then return; end if;

  if (select count(*) from public.banter_push_log l where l.sender_id = p_sender and l.created_at > now() - interval '1 hour') >= 120 then
    return;
  end if;

  insert into public.banter_push_log (kind, ref_id, sender_id) values (p_kind, p_id, p_sender) on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then return; end if;

  if p_kind = 'reply' then
    return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           case n.kind
             when 'reply' then v_handle || ' replied to you'
             when 'topic_reply' then v_handle || ' replied in your topic'
             when 'mention' then v_handle || ' mentioned you'
             when 'follow_post' then v_handle || ' posted in ' || t.title
             else v_handle || ' in ' || t.title
           end,
           left(r.body, 140),
           '/play/discussion?topic=' || r.topic_id || '&reply=' || r.id,
           'banter-topic-' || r.topic_id
      from public.banter_replies r
      join public.banter_topics t on t.id = r.topic_id and t.deleted_at is null
      join public.banter_notifications n on n.reply_id = r.id and n.from_user_id = p_sender
      join public.banter_push_subscriptions s on s.user_id = n.user_id
      left join public.banter_push_settings st on st.user_id = n.user_id
     where r.id = p_id and r.user_id = p_sender and r.deleted_at is null
       and r.created_at > now() - interval '10 minutes'
       and n.user_id <> p_sender
       and n.kind in ('reply', 'topic_reply', 'mention', 'follow_post', 'thread_message')
       and (case n.kind
              when 'thread_message' then coalesce(st.thread_messages, true)
              when 'follow_post' then coalesce(st.follows, true)
              else coalesce(st.replies, true) end)
       and public.banter_user_has_access(n.user_id);

  elsif p_kind = 'topic' then
    return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           case n.kind when 'mention' then v_handle || ' mentioned you' else v_handle || ' started a topic' end,
           left(t.title || ': ' || t.body, 140),
           '/play/discussion?topic=' || t.id,
           'banter-topic-' || t.id
      from public.banter_topics t
      join public.banter_notifications n on n.topic_id = t.id and n.reply_id is null and n.from_user_id = p_sender
                                         and n.kind in ('mention', 'follow_topic')
      join public.banter_push_subscriptions s on s.user_id = n.user_id
      left join public.banter_push_settings st on st.user_id = n.user_id
     where t.id = p_id and t.user_id = p_sender and t.deleted_at is null
       and t.created_at > now() - interval '10 minutes'
       and n.user_id <> p_sender
       and (case n.kind when 'mention' then coalesce(st.replies, true) else coalesce(st.follows, true) end)
       and public.banter_user_has_access(n.user_id);

  elsif p_kind = 'post' then
    return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           case n.kind
             when 'league_reply' then v_handle || ' replied to you in ' || l.name
             when 'mention' then v_handle || ' mentioned you in ' || l.name
             else v_handle || ' in ' || l.name
           end,
           left(p.body, 140),
           '/play/leagues?league=' || p.league_id || '&post=' || p.id,
           'banter-league-' || p.league_id
      from public.banter_posts p
      join public.banter_leagues l on l.id = p.league_id
      join public.banter_notifications n on n.post_id = p.id and n.from_user_id = p_sender
                                         and n.kind in ('league_reply', 'mention', 'thread_message')
      join public.banter_push_subscriptions s on s.user_id = n.user_id
      left join public.banter_push_settings st on st.user_id = n.user_id
     where p.id = p_id and p.user_id = p_sender and p.deleted_at is null
       and p.created_at > now() - interval '10 minutes'
       and n.user_id <> p_sender
       and (case when n.kind = 'thread_message'
                 then coalesce(st.league_messages, true)
                      and not exists (select 1 from public.banter_league_mutes mu where mu.user_id = n.user_id and mu.league_id = p.league_id)
                 else coalesce(st.replies, true) end)
       and public.banter_user_has_access(n.user_id);

  elsif p_kind = 'pick' then
    -- Only the first pick of a run reaches the phone (item_count = 1); later ones update the list.
    return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           v_handle || ' made a pick',
           left(coalesce(ht.name, 'Home') || ' v ' || coalesce(awt.name, 'Away'), 140),
           '/play/picks'::text,
           'banter-follow-' || p_sender
      from public.football_user_picks k
      join public.football_fixtures f on f.id = k.fixture_id
      left join public.football_teams ht on ht.id = f.home_team_id
      left join public.football_teams awt on awt.id = f.away_team_id
      join public.banter_notifications n on n.kind = 'follow_pick' and n.pick_id = k.id and n.from_user_id = p_sender and n.item_count = 1
      join public.banter_push_subscriptions s on s.user_id = n.user_id
      left join public.banter_push_settings st on st.user_id = n.user_id
     where k.id = p_id and k.user_id = p_sender and k.created_at > now() - interval '10 minutes'
       and coalesce(st.follows, true)
       and public.banter_user_has_access(n.user_id);

  elsif p_kind = 'follow' then
    return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           v_handle || ' started following you', 'Tap to see their profile.'::text,
           '/play/profile'::text,
           'banter-follower-' || p_sender
      from public.banter_notifications n
      join public.banter_follows fo on fo.follower_id = p_sender and fo.followee_id = n.user_id
      join public.banter_push_subscriptions s on s.user_id = fo.followee_id
      left join public.banter_push_settings st on st.user_id = fo.followee_id
     where n.id = p_id and n.kind = 'follower' and n.from_user_id = p_sender
       and n.created_at > now() - interval '10 minutes'
       and coalesce(st.follows, true)
       and public.banter_user_has_access(fo.followee_id);

  elsif p_kind = 'join' then
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

  else -- 'reaction'
    return query
    with rx as (
      select n.user_id as uid, n.topic_id, n.reply_id, n.post_id, n.league_id, n.reaction,
             left(coalesce(rp.body, po.body, t.body), 140) as preview
        from public.banter_reactions x
        join public.banter_notifications n on n.reaction_id = x.id and n.kind = 'reaction'
        left join public.banter_topics t on t.id = n.topic_id
        left join public.banter_replies rp on rp.id = n.reply_id
        left join public.banter_posts po on po.id = n.post_id
       where x.id = p_id and x.user_id = p_sender and x.updated_at > now() - interval '10 minutes'
    )
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           v_handle || ' reacted ' ||
             case x.reaction when 'up' then '👍' when 'down' then '👎' when 'angry' then '😡' when 'laugh' then '😂' else '😢' end
             || ' to your message',
           x.preview,
           case when x.post_id is not null then '/play/leagues?league=' || x.league_id || '&post=' || x.post_id
                else '/play/discussion?topic=' || x.topic_id || coalesce('&reply=' || x.reply_id, '') end,
           'banter-reaction-' || coalesce(x.reply_id, x.post_id, x.topic_id)
      from rx x
      join public.banter_push_subscriptions s on s.user_id = x.uid
      left join public.banter_push_settings st on st.user_id = x.uid
     where x.uid <> p_sender
       and coalesce(st.replies, true)
       and (x.league_id is null or not exists (select 1 from public.banter_league_mutes mu where mu.user_id = x.uid and mu.league_id = x.league_id))
       and public.banter_user_has_access(x.uid);
  end if;
end;
$$;

-- Grants. The fan-out helpers and the trigger function are internal.
revoke execute on function public.banter_fanout_reply(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.banter_fanout_post(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.banter_fanout_topic(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.banter_fanout_pick() from public, anon, authenticated;
revoke execute on function public.banter_create_topic(text, text) from public, anon;
revoke execute on function public.banter_post_reply(uuid, text, uuid, boolean) from public, anon;
revoke execute on function public.banter_post(text, uuid, uuid) from public, anon;
revoke execute on function public.banter_search_handles(text, uuid, uuid) from public, anon;
revoke execute on function public.banter_follow(text, boolean) from public, anon;
revoke execute on function public.banter_member(text) from public, anon;
revoke execute on function public.banter_my_follows() from public, anon;
revoke execute on function public.banter_push_settings() from public, anon;
revoke execute on function public.banter_set_push_settings(boolean, boolean, boolean, boolean, boolean) from public, anon;
revoke execute on function public.banter_my_notifications(integer) from public, anon;
revoke execute on function public.banter_unread_count() from public, anon;
revoke execute on function public.banter_push_targets(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.banter_create_topic(text, text) to authenticated, service_role;
grant execute on function public.banter_post_reply(uuid, text, uuid, boolean) to authenticated, service_role;
grant execute on function public.banter_post(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.banter_search_handles(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.banter_follow(text, boolean) to authenticated, service_role;
grant execute on function public.banter_member(text) to authenticated, service_role;
grant execute on function public.banter_my_follows() to authenticated, service_role;
grant execute on function public.banter_push_settings() to authenticated, service_role;
grant execute on function public.banter_set_push_settings(boolean, boolean, boolean, boolean, boolean) to authenticated, service_role;
grant execute on function public.banter_my_notifications(integer) to authenticated, service_role;
grant execute on function public.banter_unread_count() to authenticated, service_role;
grant execute on function public.banter_push_targets(uuid, text, uuid) to service_role;

-- Expected Security Advisor result: no new errors. banter_follows has RLS on with no policies
-- (informational, intended). banter_follow, banter_member and banter_my_follows show the accepted
-- "Signed-In Users Can Execute SECURITY DEFINER" warning (each checks has_banter_access() first).
-- The fan-out helpers, the trigger function and banter_push_targets are not executable by anon or
-- signed-in users.

-- ROLLBACK:
--   drop trigger if exists banter_fanout_pick on public.football_user_picks;
--   drop function if exists public.banter_follow(text, boolean);
--   drop function if exists public.banter_member(text);
--   drop function if exists public.banter_my_follows();
--   drop function if exists public.banter_search_handles(text, uuid, uuid);  then re-run it from 0009;
--   drop function if exists public.banter_set_push_settings(boolean, boolean, boolean, boolean, boolean);
--   re-run banter_push_settings / banter_set_push_settings from 0007; banter_create_topic,
--   banter_post_reply, banter_post, banter_unread_count, banter_push_targets and (after dropping it)
--   banter_my_notifications from 0009, each with its grants;
--   drop function if exists public.banter_fanout_pick(), public.banter_fanout_topic(uuid, uuid),
--     public.banter_fanout_post(uuid, uuid, uuid), public.banter_fanout_reply(uuid, uuid, uuid);
--   delete from public.banter_notifications where kind in ('thread_message', 'follow_pick', 'follow_topic', 'follow_post', 'follower');
--   restore banter_notifications_kind / banter_notifications_one_target from 20261115000009;
--   alter table public.banter_notifications drop column if exists pick_id, drop column if exists item_count;
--   alter table public.banter_push_settings drop column if exists thread_messages, drop column if exists follows;
--   drop table if exists public.banter_follows;
