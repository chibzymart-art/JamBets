-- Banter Hub: reactions on every message (Discussion opening posts and replies, league walls).
-- Additive only: one new table, new / recreated Banter functions; nothing in the Predictions Hub changes.
-- Needs the Banter migrations up to 20261115000007_banter_push.sql applied.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner):
--   * Exactly five reactions: up (👍), down (👎), angry (😡), laugh (😂), cry (😢).
--   * One reaction per member per message. Tapping another changes it; tapping the same removes it.
--     A reaction stays until its member changes or removes it.
--   * Counts per reaction are shown, and the member's own reaction is highlighted.
--   * The message's writer is notified (kind 'reaction', in "Replies to you"), never for their own
--     reaction. Changing a reaction updates that notification (and shows it as new again); removing
--     it deletes the notification.
--   * Paid members only; a banned member cannot react and their reactions are not counted.
--   * League wall reactions: league members only.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
create table if not exists public.banter_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  target_kind text not null,
  target_id uuid not null,
  reaction text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint banter_reactions_kind check (target_kind in ('topic', 'reply', 'post')),
  constraint banter_reactions_reaction check (reaction in ('up', 'down', 'angry', 'laugh', 'cry')),
  constraint banter_reactions_one_per_member unique (user_id, target_kind, target_id)
);
create index if not exists banter_reactions_target_idx on public.banter_reactions (target_kind, target_id);
create index if not exists banter_reactions_user_idx on public.banter_reactions (user_id, updated_at desc);

alter table public.banter_reactions enable row level security;
revoke all on table public.banter_reactions from anon, authenticated;
grant select, insert, update, delete on table public.banter_reactions to service_role;
-- No policies: no direct access for anon or signed-in users.

-- ---------------------------------------------------------------------------
-- 2. Notifications: a 'reaction' kind
-- ---------------------------------------------------------------------------
alter table public.banter_notifications
  add column if not exists reaction text,
  add column if not exists reaction_id uuid references public.banter_reactions(id) on delete cascade;

alter table public.banter_notifications drop constraint if exists banter_notifications_kind;
alter table public.banter_notifications
  add constraint banter_notifications_kind check (kind in ('reply', 'topic_reply', 'league_reply', 'reaction'));

alter table public.banter_notifications drop constraint if exists banter_notifications_one_target;
alter table public.banter_notifications
  add constraint banter_notifications_one_target check (
    (kind in ('reply', 'topic_reply') and topic_id is not null and reply_id is not null and post_id is null and league_id is null)
    or (kind = 'league_reply' and post_id is not null and league_id is not null and topic_id is null and reply_id is null)
    -- A reaction points at a topic's opening post (reply_id null), a reply, or a league wall post.
    or (kind = 'reaction' and reaction_id is not null and reaction is not null and (
         (topic_id is not null and post_id is null and league_id is null)
         or (post_id is not null and league_id is not null and topic_id is null and reply_id is null)))
  );

-- One notification per reaction (changing it updates the row).
create unique index if not exists banter_notifications_reaction_uidx
  on public.banter_notifications (reaction_id) where kind = 'reaction';

-- ---------------------------------------------------------------------------
-- 3. React
-- ---------------------------------------------------------------------------

-- Counts per reaction for one message (banned members not counted), and the caller's own reaction.
create or replace function public.banter_reaction_summary(p_kind text, p_id uuid, p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'counts', coalesce((
      select jsonb_object_agg(x.reaction, x.n)
        from (select r.reaction, count(*)::integer as n
                from public.banter_reactions r
                join public.player_profiles pp on pp.user_id = r.user_id and not pp.leaderboard_banned
               where r.target_kind = p_kind and r.target_id = p_id
               group by r.reaction) x), '{}'::jsonb),
    'mine', (select r.reaction from public.banter_reactions r
              where r.target_kind = p_kind and r.target_id = p_id and r.user_id = p_uid)
  );
$$;

-- Set, change or remove the caller's reaction. Errors: not_signed_in, no_access, no_profile, banned,
-- reaction_invalid, message_not_found, not_member, too_fast.
create or replace function public.banter_react(p_kind text, p_id uuid, p_reaction text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_banned boolean;
  v_author uuid;
  v_topic uuid;
  v_reply uuid;
  v_post uuid;
  v_league uuid;
  v_existing public.banter_reactions%rowtype;
  v_rid uuid;
  v_state text;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  select pp.leaderboard_banned into v_banned from public.player_profiles pp where pp.user_id = v_uid;
  if not found then raise exception 'no_profile'; end if;
  if v_banned then raise exception 'banned'; end if;
  if p_kind not in ('topic', 'reply', 'post') then raise exception 'message_not_found'; end if;
  if p_reaction not in ('up', 'down', 'angry', 'laugh', 'cry') then raise exception 'reaction_invalid'; end if;

  -- The message must be live and visible to the caller.
  if p_kind = 'topic' then
    select t.user_id, t.id into v_author, v_topic
      from public.banter_topics t join public.player_profiles pp on pp.user_id = t.user_id
     where t.id = p_id and t.deleted_at is null and not pp.leaderboard_banned;
  elsif p_kind = 'reply' then
    select r.user_id, r.topic_id, r.id into v_author, v_topic, v_reply
      from public.banter_replies r
      join public.banter_topics t on t.id = r.topic_id and t.deleted_at is null
      join public.player_profiles pp on pp.user_id = r.user_id
     where r.id = p_id and r.deleted_at is null and not pp.leaderboard_banned;
  else
    select p.user_id, p.id, p.league_id into v_author, v_post, v_league
      from public.banter_posts p join public.player_profiles pp on pp.user_id = p.user_id
     where p.id = p_id and p.deleted_at is null and not pp.leaderboard_banned;
    if v_author is not null and v_league is not null and not exists (
      select 1 from public.banter_league_members m where m.league_id = v_league and m.user_id = v_uid
    ) then
      raise exception 'not_member';
    end if;
  end if;
  if v_author is null then raise exception 'message_not_found'; end if;

  if (select count(*) from public.banter_reactions r where r.user_id = v_uid and r.updated_at > now() - interval '1 minute') >= 40 then
    raise exception 'too_fast';
  end if;

  select * into v_existing from public.banter_reactions r
   where r.user_id = v_uid and r.target_kind = p_kind and r.target_id = p_id;

  if v_existing.id is not null and v_existing.reaction = p_reaction then
    -- Same reaction again: remove it (its notification goes with it: on delete cascade).
    delete from public.banter_reactions where id = v_existing.id;
    v_state := 'removed';
  elsif v_existing.id is not null then
    update public.banter_reactions set reaction = p_reaction, updated_at = now() where id = v_existing.id;
    v_rid := v_existing.id;
    v_state := 'changed';
  else
    insert into public.banter_reactions (user_id, target_kind, target_id, reaction)
    values (v_uid, p_kind, p_id, p_reaction)
    returning id into v_rid;
    v_state := 'added';
  end if;

  -- Notify the writer (never yourself, never for a league they have left). One row per reaction.
  if v_rid is not null and v_author <> v_uid and (
       v_league is null
       or exists (select 1 from public.banter_league_members m where m.league_id = v_league and m.user_id = v_author)) then
    insert into public.banter_notifications (user_id, kind, topic_id, reply_id, post_id, league_id, from_user_id, reaction, reaction_id)
    values (v_author, 'reaction', v_topic, v_reply, v_post, v_league, v_uid, p_reaction, v_rid)
    on conflict (reaction_id) where kind = 'reaction'
    do update set reaction = excluded.reaction, created_at = now(), read_at = null;
  end if;

  return jsonb_build_object('state', v_state, 'reaction_id', v_rid)
         || public.banter_reaction_summary(p_kind, p_id, v_uid);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reads now carry reactions (wall: return type changes, so drop and recreate).
-- ---------------------------------------------------------------------------
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
  reply_to jsonb,
  reactions jsonb,
  my_reaction text
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
         end,
         rs.s -> 'counts',
         rs.s ->> 'mine'
    from public.banter_posts p
    join public.player_profiles pp on pp.user_id = p.user_id
    left join public.player_profiles tp on tp.user_id = p.tagged_user_id
    left join public.banter_posts q on q.id = p.reply_to_post_id
    left join public.player_profiles qp on qp.user_id = q.user_id
    cross join lateral (select public.banter_reaction_summary('post', p.id, v_uid) as s) rs
   where p.deleted_at is null
     and not pp.leaderboard_banned
     and (case when p_league_id is null then p.league_id is null else p.league_id = p_league_id end)
     and (p_before is null or p.created_at < p_before)
   order by p.created_at desc
   limit v_limit;
end;
$$;

-- Same signature (jsonb result): topic and each reply gain 'reactions' and 'my_reaction'.
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
  v_rs jsonb;
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

  v_rs := public.banter_reaction_summary('topic', p_topic_id, v_uid);
  v_topic := v_topic || jsonb_build_object('reactions', v_rs -> 'counts', 'my_reaction', v_rs ->> 'mine');

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
               end,
               'reactions', rs.s -> 'counts',
               'my_reaction', rs.s ->> 'mine'
             ) as j
        from public.banter_replies r
        join public.player_profiles rp on rp.user_id = r.user_id
        left join public.player_profiles tp on tp.user_id = r.tagged_user_id
        left join public.banter_replies q on q.id = r.reply_to_reply_id
        left join public.player_profiles qp on qp.user_id = q.user_id
        cross join lateral (select public.banter_reaction_summary('reply', r.id, v_uid) as s) rs
       where r.topic_id = p_topic_id and r.deleted_at is null and not rp.leaderboard_banned
       order by r.created_at desc
       limit 300
    ) x;

  return jsonb_build_object('topic', v_topic, 'replies', v_replies);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. "Replies to you" includes reactions (return type changes, so drop and recreate).
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
  reaction text
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
           left(r.body, 120), fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null), null::text
      from public.banter_notifications n
      join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      join public.player_profiles fp on fp.user_id = r.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.kind in ('reply', 'topic_reply')
    union all
    select n.id, n.kind, null::uuid, null::text, null::uuid, n.league_id, l.name, n.post_id,
           left(p.body, 120), fp.handle, fp.avatar_emoji, n.created_at, (n.read_at is not null), null::text
      from public.banter_notifications n
      join public.banter_leagues l on l.id = n.league_id
      join public.banter_league_members m on m.league_id = n.league_id and m.user_id = v_uid
      join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
      join public.player_profiles fp on fp.user_id = p.user_id and not fp.leaderboard_banned
     where n.user_id = v_uid and n.kind = 'league_reply'
    union all
    -- Reactions: the preview is the caller's own message that was reacted to.
    select n.id, n.kind, n.topic_id, t.title, n.reply_id, n.league_id, l.name, n.post_id,
           left(coalesce(r.body, p.body, t.body), 120), fp.handle, fp.avatar_emoji, n.created_at,
           (n.read_at is not null), n.reaction
      from public.banter_notifications n
      join public.player_profiles fp on fp.user_id = n.from_user_id and not fp.leaderboard_banned
      left join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      left join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      left join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
      left join public.banter_leagues l on l.id = n.league_id
     where n.user_id = v_uid and n.kind = 'reaction'
       and (
         (n.topic_id is not null and t.id is not null and (n.reply_id is null or r.id is not null))
         or (n.post_id is not null and p.id is not null and exists (
               select 1 from public.banter_league_members m where m.league_id = n.league_id and m.user_id = v_uid))
       )
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
     where n.user_id = v_uid and n.read_at is null and n.kind = 'reaction'
       and (
         (n.topic_id is not null and t.id is not null and (n.reply_id is null or r.id is not null))
         or (n.post_id is not null and p.id is not null and exists (
               select 1 from public.banter_league_members m where m.league_id = n.league_id and m.user_id = v_uid))
       )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Push: the writer gets a push for a new reaction (settings: replies and tags). Same function as
--    20261115000007 plus the 'reaction' kind (p_id = the reaction id; once per reaction).
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
  if p_sender is null or p_id is null or p_kind not in ('reply', 'post', 'join', 'reaction') then return; end if;

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
      select m.tagged_user_id as uid, v_handle || ' replied to you in ' || m.league_name as title, 'replies' as setting, m.*
        from msg m
        join public.banter_league_members lm on lm.league_id = m.league_id and lm.user_id = m.tagged_user_id
       where m.tagged_user_id is not null
      union all
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

  else -- 'reaction': p_id is the reaction id; the writer of the message is notified.
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

-- Grants. banter_reaction_summary is internal (called by the functions above).
revoke execute on function public.banter_reaction_summary(text, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.banter_react(text, uuid, text) from public, anon;
revoke execute on function public.banter_wall(uuid, timestamptz, integer) from public, anon;
revoke execute on function public.banter_topic(uuid) from public, anon;
revoke execute on function public.banter_my_notifications(integer) from public, anon;
revoke execute on function public.banter_unread_count() from public, anon;
revoke execute on function public.banter_push_targets(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.banter_react(text, uuid, text) to authenticated, service_role;
grant execute on function public.banter_wall(uuid, timestamptz, integer) to authenticated, service_role;
grant execute on function public.banter_topic(uuid) to authenticated, service_role;
grant execute on function public.banter_my_notifications(integer) to authenticated, service_role;
grant execute on function public.banter_unread_count() to authenticated, service_role;
grant execute on function public.banter_push_targets(uuid, text, uuid) to service_role;

-- Expected Security Advisor result: no new errors. banter_reactions has RLS on with no policies
-- (informational, intended). banter_react shows the accepted "Signed-In Users Can Execute SECURITY
-- DEFINER" warning (it checks has_banter_access() first). banter_reaction_summary and
-- banter_push_targets are not executable by anon or signed-in users.

-- ROLLBACK:
--   drop function if exists public.banter_react(text, uuid, text);
--   then re-run banter_wall, banter_topic, banter_my_notifications, banter_unread_count (with grants)
--   from 20261115000006_banter_reply_everywhere.sql and banter_push_targets from 20261115000007_banter_push.sql;
--   drop function if exists public.banter_reaction_summary(text, uuid, uuid);
--   delete from public.banter_notifications where kind = 'reaction';
--   drop index if exists public.banter_notifications_reaction_uidx;
--   restore banter_notifications_kind / banter_notifications_one_target from 20261115000006;
--   alter table public.banter_notifications drop column if exists reaction_id, drop column if exists reaction;
--   drop table if exists public.banter_reactions;
