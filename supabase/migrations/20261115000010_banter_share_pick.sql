-- Banter Hub: share a football pick into a Discussion topic or a league chat, shown as a live card.
-- Additive only: two new columns, new / recreated Banter functions; nothing in the Predictions Hub
-- changes and no Predictions Hub table is read except through the member's own Banter pick.
-- Needs the Banter migrations up to 20261115000009_banter_mentions_pins.sql applied.
--
-- NOT APPLIED. The owner reviews and applies this by hand. Rerun the Security Advisor afterwards.
--
-- Rules (owner):
--   * A member shares one of their OWN football picks (only theirs) into a topic (as a reply) or into
--     one of their leagues (as a wall message), with an optional comment.
--   * The message stores the pick's id, never a copy. The card (teams, league, kickoff, the pick and
--     its status: pending / won / lost / void) is read live from the pick, so it changes colour when
--     the pick settles. Card data comes only from the topic / wall functions.
--   * Football only for now (other sports are suspended).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.banter_replies
  add column if not exists shared_pick_id uuid references public.football_user_picks(id) on delete set null;
alter table public.banter_posts
  add column if not exists shared_pick_id uuid references public.football_user_picks(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 2. The card (internal)
-- ---------------------------------------------------------------------------
create or replace function public.banter_pick_card(p_pick_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'id', k.id,
           'market', k.market,
           'selection', k.selection,
           'kickoff_at', k.kickoff_at,
           'status', k.status,
           'points', k.points,
           'league_name', l.name,
           'league_country', l.country,
           'home_team', hmt.name,
           'away_team', awt.name,
           'home_score', case when f.status = 'finished' then f.home_score end,
           'away_score', case when f.status = 'finished' then f.away_score end)
    from public.football_user_picks k
    join public.football_fixtures f on f.id = k.fixture_id
    left join public.football_leagues l on l.id = f.league_id
    left join public.football_teams hmt on hmt.id = f.home_team_id
    left join public.football_teams awt on awt.id = f.away_team_id
   where k.id = p_pick_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Share
-- ---------------------------------------------------------------------------
-- Errors: not_signed_in, no_access, pick_not_found, destination_invalid, plus every error of
-- banter_post_reply (topic) or banter_post (league): rate limits, banned, not_member, ...
create or replace function public.banter_share_pick(
  p_pick_id uuid,
  p_topic_id uuid default null,
  p_league_id uuid default null,
  p_comment text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := coalesce(nullif(btrim(coalesce(p_comment, '')), ''), '🎯 My pick');
  v_res jsonb;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_signed_in'; end if;
  if not public.has_banter_access() then raise exception 'no_access'; end if;
  if not exists (select 1 from public.football_user_picks k where k.id = p_pick_id and k.user_id = v_uid) then
    raise exception 'pick_not_found';
  end if;
  if (p_topic_id is null) = (p_league_id is null) then raise exception 'destination_invalid'; end if;

  if p_topic_id is not null then
    -- Same rules as any reply (access, username, ban, rate limits, mentions, notifications).
    v_res := public.banter_post_reply(p_topic_id, v_body, null, false);
    v_id := (v_res ->> 'id')::uuid;
    update public.banter_replies set shared_pick_id = p_pick_id where id = v_id and user_id = v_uid;
    return v_res || jsonb_build_object('kind', 'reply', 'topic_id', p_topic_id);
  else
    -- Same rules as any league wall message (membership included).
    v_res := public.banter_post(v_body, p_league_id, null);
    v_id := (v_res ->> 'id')::uuid;
    update public.banter_posts set shared_pick_id = p_pick_id where id = v_id and user_id = v_uid;
    return v_res || jsonb_build_object('kind', 'post', 'league_id', p_league_id);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reads carry the live card (0008 versions plus 'pick').
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
  my_reaction text,
  pick jsonb
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
         rs.s ->> 'mine',
         case when p.shared_pick_id is not null then public.banter_pick_card(p.shared_pick_id) end
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
               'my_reaction', rs.s ->> 'mine',
               'pick', case when r.shared_pick_id is not null then public.banter_pick_card(r.shared_pick_id) end
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

revoke execute on function public.banter_pick_card(uuid) from public, anon, authenticated;
revoke execute on function public.banter_share_pick(uuid, uuid, uuid, text) from public, anon;
revoke execute on function public.banter_wall(uuid, timestamptz, integer) from public, anon;
revoke execute on function public.banter_topic(uuid) from public, anon;
grant execute on function public.banter_share_pick(uuid, uuid, uuid, text) to authenticated, service_role;
grant execute on function public.banter_wall(uuid, timestamptz, integer) to authenticated, service_role;
grant execute on function public.banter_topic(uuid) to authenticated, service_role;

-- Expected Security Advisor result: no new errors. banter_share_pick shows the accepted
-- "Signed-In Users Can Execute SECURITY DEFINER" warning (it checks has_banter_access() first, and
-- that the pick is the caller's own). banter_pick_card is not executable by anon or signed-in users.

-- ROLLBACK:
--   drop function if exists public.banter_share_pick(uuid, uuid, uuid, text);
--   re-run banter_wall (after: drop function public.banter_wall(uuid, timestamptz, integer)) and
--   banter_topic from 20261115000008_banter_reactions.sql, with their grants;
--   drop function if exists public.banter_pick_card(uuid);
--   alter table public.banter_posts drop column if exists shared_pick_id;
--   alter table public.banter_replies drop column if exists shared_pick_id;
