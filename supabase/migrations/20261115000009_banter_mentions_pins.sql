-- Banter Hub: @mentions in any message, and pinned Discussion topics (admins).
-- Additive only: one new table, two new columns, new / recreated Banter functions; nothing in the
-- Predictions Hub changes. Needs the Banter migrations up to 20261115000008_banter_reactions.sql.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner):
--   (a) Typing @ in a Banter message box suggests usernames (prefix search, paid members, at most 8;
--       on a league wall only that league's members). When a message is saved, @username mentions
--       are resolved by the database: at most 5 per message, existing members with access, never
--       banned, never yourself, and on a league wall only league members. Each is stored in
--       banter_mentions and notified (kind 'mention'), except someone already notified by the same
--       message (the member being replied to, or the topic's author).
--   (b) Admins (public.is_admin()) can pin and unpin topics; pinned topics stay at the top of the
--       Discussion list with a pin badge. At most 5 pinned at once.

-- ---------------------------------------------------------------------------
-- 1. Tables and columns
-- ---------------------------------------------------------------------------
create table if not exists public.banter_mentions (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null,
  source_id uuid not null,
  mentioned_user_id uuid not null references public.users(id) on delete cascade,
  author_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint banter_mentions_kind check (source_kind in ('topic', 'reply', 'post')),
  constraint banter_mentions_once unique (source_kind, source_id, mentioned_user_id)
);
create index if not exists banter_mentions_user_idx on public.banter_mentions (mentioned_user_id, created_at desc);

alter table public.banter_mentions enable row level security;
revoke all on table public.banter_mentions from anon, authenticated;
grant select, insert, update, delete on table public.banter_mentions to service_role;
-- No policies: no direct access for anon or signed-in users.

alter table public.banter_topics
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid references public.users(id) on delete set null;
create index if not exists banter_topics_pinned_idx on public.banter_topics (pinned_at desc) where pinned_at is not null and deleted_at is null;

-- Notifications: a 'mention' kind, pointing at the message that mentions you (a topic's opening
-- post with reply_id null, a reply, or a league wall post).
alter table public.banter_notifications drop constraint if exists banter_notifications_kind;
alter table public.banter_notifications
  add constraint banter_notifications_kind check (kind in ('reply', 'topic_reply', 'league_reply', 'reaction', 'mention'));

alter table public.banter_notifications drop constraint if exists banter_notifications_one_target;
alter table public.banter_notifications
  add constraint banter_notifications_one_target check (
    (kind in ('reply', 'topic_reply') and topic_id is not null and reply_id is not null and post_id is null and league_id is null)
    or (kind = 'league_reply' and post_id is not null and league_id is not null and topic_id is null and reply_id is null)
    or (kind = 'reaction' and reaction_id is not null and reaction is not null and (
         (topic_id is not null and post_id is null and league_id is null)
         or (post_id is not null and league_id is not null and topic_id is null and reply_id is null)))
    or (kind = 'mention' and (
         (topic_id is not null and post_id is null and league_id is null)
         or (post_id is not null and league_id is not null and topic_id is null and reply_id is null)))
  );

-- ---------------------------------------------------------------------------
-- 2. Username suggestions while typing
-- ---------------------------------------------------------------------------
create or replace function public.banter_search_handles(p_prefix text, p_league_id uuid default null)
returns table (handle text, avatar_emoji text)
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
  select pp.handle, pp.avatar_emoji
    from public.player_profiles pp
   where not pp.leaderboard_banned
     and pp.user_id <> v_uid
     and lower(pp.handle) like v_prefix || '%'
     and (p_league_id is null or exists (
           select 1 from public.banter_league_members m where m.league_id = p_league_id and m.user_id = pp.user_id))
   order by char_length(pp.handle), lower(pp.handle)
   limit 8;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Resolve mentions in a saved message (internal: called by the post functions below)
-- ---------------------------------------------------------------------------
create or replace function public.banter_apply_mentions(
  p_kind text,          -- 'topic' | 'reply' | 'post'
  p_id uuid,            -- the new message
  p_body text,
  p_author uuid,
  p_topic_id uuid,      -- for 'topic' / 'reply'
  p_league_id uuid,     -- for league wall posts
  p_skip uuid[]         -- already notified by this message (reply target, topic author)
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_rec record;
begin
  for v_rec in
    select distinct on (pp.user_id) pp.user_id
      from (
        select lower(m[1]) as h, min(ord) as first_at
          from regexp_matches(coalesce(p_body, ''), '(?:^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,20})(?![A-Za-z0-9_])', 'g')
               with ordinality as t(m, ord)
         group by lower(m[1])
         order by min(ord)
         limit 5
      ) x
      join public.player_profiles pp on lower(pp.handle) = x.h
     where pp.user_id <> p_author
       and not pp.leaderboard_banned
       and public.banter_user_has_access(pp.user_id)
       and (p_league_id is null or exists (
             select 1 from public.banter_league_members lm where lm.league_id = p_league_id and lm.user_id = pp.user_id))
  loop
    insert into public.banter_mentions (source_kind, source_id, mentioned_user_id, author_id)
    values (p_kind, p_id, v_rec.user_id, p_author)
    on conflict do nothing;

    if not (v_rec.user_id = any (coalesce(p_skip, '{}'))) then
      if p_kind = 'post' then
        insert into public.banter_notifications (user_id, kind, post_id, league_id, from_user_id)
        values (v_rec.user_id, 'mention', p_id, p_league_id, p_author);
      else
        insert into public.banter_notifications (user_id, kind, topic_id, reply_id, from_user_id)
        values (v_rec.user_id, 'mention', p_topic_id, case when p_kind = 'reply' then p_id end, p_author);
      end if;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Post functions resolve mentions (same signatures; bodies from 0005 / 0006 plus the call)
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

  -- Mentions: not again for the member replied to or the topic's author (already notified).
  perform public.banter_apply_mentions('reply', v_id, v_body, v_uid, p_topic_id, null,
                                       array_remove(array[v_target, v_topic_author], null));

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

  -- Mentions on league walls only (league members only, not again for the member replied to).
  if p_league_id is not null then
    perform public.banter_apply_mentions('post', v_id, v_body, v_uid, null, p_league_id,
                                         array_remove(array[v_tag], null));
  end if;

  return jsonb_build_object('id', v_id, 'created_at', v_created);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Pins
-- ---------------------------------------------------------------------------
-- Admins only. Errors: not_signed_in, not_allowed, topic_not_found, too_many_pinned.
create or replace function public.banter_pin_topic(p_topic_id uuid, p_pinned boolean)
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
  if not public.has_banter_access() or not coalesce(public.is_admin(), false) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.banter_topics t where t.id = p_topic_id and t.deleted_at is null) then
    raise exception 'topic_not_found';
  end if;

  if coalesce(p_pinned, false) then
    if (select count(*) from public.banter_topics t
         where t.pinned_at is not null and t.deleted_at is null and t.id <> p_topic_id) >= 5 then
      raise exception 'too_many_pinned';
    end if;
    update public.banter_topics set pinned_at = coalesce(pinned_at, now()), pinned_by = v_uid where id = p_topic_id;
  else
    update public.banter_topics set pinned_at = null, pinned_by = null where id = p_topic_id;
  end if;
  return coalesce(p_pinned, false);
end;
$$;

-- Topic list: pinned first (return type changes, so drop and recreate).
drop function if exists public.banter_topics(text, integer, integer);

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
  can_delete boolean,
  is_pinned boolean,
  can_pin boolean
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
         (t.user_id = v_uid or v_admin),
         (t.pinned_at is not null),
         v_admin
    from public.banter_topics t
    join public.player_profiles pp on pp.user_id = t.user_id
   where t.deleted_at is null
     and not pp.leaderboard_banned
     and (v_search is null or t.title ilike '%' || v_search || '%' or t.body ilike '%' || v_search || '%')
   order by (t.pinned_at is not null) desc, t.pinned_at desc nulls last, t.last_activity_at desc, t.id
   limit v_limit offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. "Replies to you" and the badge include mentions (0008 versions plus kind 'mention', which
--    shares the reaction branch: the target is the message, the sender is from_user_id).
-- ---------------------------------------------------------------------------
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
    select n.id, n.kind, n.topic_id, t.title, n.reply_id, n.league_id, l.name, n.post_id,
           left(coalesce(r.body, p.body, t.body), 120), fp.handle, fp.avatar_emoji, n.created_at,
           (n.read_at is not null), n.reaction
      from public.banter_notifications n
      join public.player_profiles fp on fp.user_id = n.from_user_id and not fp.leaderboard_banned
      left join public.banter_topics t on t.id = n.topic_id and t.deleted_at is null
      left join public.banter_replies r on r.id = n.reply_id and r.deleted_at is null
      left join public.banter_posts p on p.id = n.post_id and p.deleted_at is null
      left join public.banter_leagues l on l.id = n.league_id
     where n.user_id = v_uid and n.kind in ('reaction', 'mention')
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
     where n.user_id = v_uid and n.read_at is null and n.kind in ('reaction', 'mention')
       and (
         (n.topic_id is not null and t.id is not null and (n.reply_id is null or r.id is not null))
         or (n.post_id is not null and p.id is not null and exists (
               select 1 from public.banter_league_members m where m.league_id = n.league_id and m.user_id = v_uid))
       )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Push: mentioned members get a push too. New kind 'topic' (a new topic: only its mentions);
--    'reply' and 'post' add their mention notifications. Otherwise as in 0008.
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
  if p_sender is null or p_id is null or p_kind not in ('reply', 'post', 'join', 'reaction', 'topic') then return; end if;

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
      union all
      select n.user_id, v_handle || ' mentioned you', m.*
        from msg m
        join public.banter_notifications n on n.kind = 'mention' and n.reply_id = m.id
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

  elsif p_kind = 'topic' then
    return query
    select s.user_id, s.endpoint, s.p256dh, s.auth,
           v_handle || ' mentioned you', left(t.title || ': ' || t.body, 140),
           '/play/discussion?topic=' || t.id,
           'banter-topic-' || t.id
      from public.banter_topics t
      join public.banter_notifications n on n.kind = 'mention' and n.topic_id = t.id and n.reply_id is null
      join public.banter_push_subscriptions s on s.user_id = n.user_id
      left join public.banter_push_settings st on st.user_id = n.user_id
     where t.id = p_id and t.user_id = p_sender and t.deleted_at is null
       and t.created_at > now() - interval '10 minutes'
       and n.user_id <> p_sender
       and coalesce(st.replies, true)
       and public.banter_user_has_access(n.user_id);

  elsif p_kind = 'post' then
    return query
    with msg as (
      select p.id, p.league_id, p.body, p.tagged_user_id, l.name as league_name
        from public.banter_posts p
        join public.banter_leagues l on l.id = p.league_id
       where p.id = p_id and p.user_id = p_sender and p.deleted_at is null
         and p.created_at > now() - interval '10 minutes'
    ), direct as (
      -- Replied to or mentioned: a direct notification, delivered even in a muted league.
      select m.tagged_user_id as uid, v_handle || ' replied to you in ' || m.league_name as title
        from msg m
        join public.banter_league_members lm on lm.league_id = m.league_id and lm.user_id = m.tagged_user_id
       where m.tagged_user_id is not null
      union
      select n.user_id, v_handle || ' mentioned you in ' || m.league_name
        from msg m
        join public.banter_notifications n on n.kind = 'mention' and n.post_id = m.id
    ), rcpt as (
      select d.uid, d.title, 'replies' as setting, m.* from direct d cross join msg m
      union all
      select lm.user_id, v_handle || ' in ' || m.league_name, 'league_messages', m.*
        from msg m
        join public.banter_league_members lm on lm.league_id = m.league_id
       where not exists (select 1 from direct d where d.uid = lm.user_id)
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

-- Grants.
revoke execute on function public.banter_apply_mentions(text, uuid, text, uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.banter_search_handles(text, uuid) from public, anon;
revoke execute on function public.banter_create_topic(text, text) from public, anon;
revoke execute on function public.banter_post_reply(uuid, text, uuid, boolean) from public, anon;
revoke execute on function public.banter_post(text, uuid, uuid) from public, anon;
revoke execute on function public.banter_pin_topic(uuid, boolean) from public, anon;
revoke execute on function public.banter_topics(text, integer, integer) from public, anon;
revoke execute on function public.banter_my_notifications(integer) from public, anon;
revoke execute on function public.banter_unread_count() from public, anon;
revoke execute on function public.banter_push_targets(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.banter_search_handles(text, uuid) to authenticated, service_role;
grant execute on function public.banter_create_topic(text, text) to authenticated, service_role;
grant execute on function public.banter_post_reply(uuid, text, uuid, boolean) to authenticated, service_role;
grant execute on function public.banter_post(text, uuid, uuid) to authenticated, service_role;
grant execute on function public.banter_pin_topic(uuid, boolean) to authenticated, service_role;
grant execute on function public.banter_topics(text, integer, integer) to authenticated, service_role;
grant execute on function public.banter_my_notifications(integer) to authenticated, service_role;
grant execute on function public.banter_unread_count() to authenticated, service_role;
grant execute on function public.banter_push_targets(uuid, text, uuid) to service_role;

-- Expected Security Advisor result: no new errors. banter_mentions has RLS on with no policies
-- (informational, intended). banter_search_handles and banter_pin_topic show the accepted
-- "Signed-In Users Can Execute SECURITY DEFINER" warning (both check has_banter_access(); pinning
-- also checks is_admin()). banter_apply_mentions and banter_push_targets are not executable by
-- anon or signed-in users.

-- ROLLBACK:
--   drop function if exists public.banter_pin_topic(uuid, boolean);
--   drop function if exists public.banter_search_handles(text, uuid);
--   re-run banter_create_topic (0005), banter_post_reply and banter_post (0006), banter_topics (0005,
--   after: drop function public.banter_topics(text, integer, integer)), banter_my_notifications,
--   banter_unread_count and banter_push_targets (0008), each with its grants;
--   drop function if exists public.banter_apply_mentions(text, uuid, text, uuid, uuid, uuid, uuid[]);
--   delete from public.banter_notifications where kind = 'mention';
--   restore banter_notifications_kind / banter_notifications_one_target from 20261115000008;
--   alter table public.banter_topics drop column if exists pinned_at, drop column if exists pinned_by;
--   drop table if exists public.banter_mentions;
