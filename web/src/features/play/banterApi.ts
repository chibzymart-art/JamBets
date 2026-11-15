import { supabase } from '../../lib/supabase';

/**
 * Banter Hub data calls. Access is decided by the server (get_banter_state checks
 * has_banter_access()); any error is treated as "no access" so the hub fails closed.
 */

import { toBanterState, type BanterState, type RawState } from './banterState';

export type { BanterState };

export async function fetchBanterState(isSignedIn: boolean): Promise<BanterState> {
  // No session: there is nothing to ask the server (anon cannot call the RPC).
  if (!isSignedIn) return { status: 'visitor' };
  try {
    const { data, error } = await supabase.rpc('get_banter_state');
    if (error) return { status: 'error' };
    return toBanterState(data as RawState);
  } catch {
    return { status: 'error' };
  }
}

/** Server error code from a raised exception (the message is the code), or 'unknown'. */
function errorCode(err: { message?: string; code?: string } | null): string {
  const m = (err?.message || '').trim();
  // The database function isn't there yet (migration not applied): PostgREST PGRST202.
  if (err?.code === 'PGRST202' || /could not find the function/i.test(m)) return 'not_ready';
  return /^[a-z_]+$/.test(m) ? m : 'unknown';
}

export async function saveBanterProfile(
  handle: string,
  avatar: string,
): Promise<{ ok: true; state: BanterState } | { ok: false; code: string }> {
  try {
    const { data, error } = await supabase.rpc('set_banter_profile', {
      p_handle: handle.trim(),
      p_avatar_emoji: avatar,
    });
    if (error) return { ok: false, code: errorCode(error) };
    return { ok: true, state: toBanterState(data as RawState) };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

// ---------------------------------------------------------------------------
// Football picks
// ---------------------------------------------------------------------------

export interface BanterFixture {
  fixture_id: string;
  kickoff_at: string;
  status: string;
  league_code: string;
  league_name: string;
  league_country: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
}

export interface BanterLeague {
  league_code: string;
  league_name: string;
  league_country: string;
  fixtures: number;
}

export interface BanterPick {
  id: string;
  fixture_id: string;
  market: string;
  selection: string;
  kickoff_at: string;
  status: 'pending' | 'won' | 'lost' | 'void';
  points: number | null;
  settled_at: string | null;
  fixture_status: string;
  league_name: string | null;
  league_country: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
}

type Result<T> = { ok: true; data: T } | { ok: false; code: string };

async function call<T>(fn: string, args: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, code: errorCode(error) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

export const fetchFootballLeagues = (date: string, tz: string) =>
  call<BanterLeague[]>('banter_football_leagues', { p_date: date, p_tz: tz });

export const fetchFootballFixtures = (date: string, tz: string, leagues: string[] | null) =>
  call<BanterFixture[]>('banter_football_fixtures', { p_date: date, p_tz: tz, p_leagues: leagues });

export const fetchMyFootballPicks = (date: string | null, tz: string) =>
  call<BanterPick[]>('banter_my_football_picks', { p_date: date, p_tz: tz });

export const submitFootballPick = (fixtureId: string, market: string, selection: string) =>
  call<{ id: string }>('banter_submit_football_pick', { p_fixture_id: fixtureId, p_market: market, p_selection: selection });

export const cancelFootballPick = (fixtureId: string, market: string) =>
  call<boolean>('banter_cancel_football_pick', { p_fixture_id: fixtureId, p_market: market });

export const saveBanterLeagues = (leagues: string[]) =>
  call<unknown>('set_banter_leagues', { p_leagues: leagues });

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export type LeaderboardPeriod = 'week' | 'month' | 'all';

export interface LeaderboardRow {
  place: number;
  handle: string;
  avatar_emoji: string;
  points: number;
  won: number;
  lost: number;
  voided: number;
  settled: number;
  hit_rate: number;
  is_me: boolean;
}

export const fetchLeaderboard = (period: LeaderboardPeriod, limit = 50) =>
  call<LeaderboardRow[]>('banter_leaderboard', { p_period: period, p_limit: limit });

// ---------------------------------------------------------------------------
// Private leagues
// ---------------------------------------------------------------------------

export interface BanterLeagueSummary {
  league_id: string;
  name: string;
  invite_code: string;
  is_owner: boolean;
  members: number;
  created_at: string;
  /** Missing until the public-leagues database change is applied (treated as private). */
  is_public?: boolean;
}

export const fetchMyLeagues = () => call<BanterLeagueSummary[]>('banter_my_leagues', {});

export async function createLeague(name: string, isPublic = false) {
  const r = await call<{ league_id: string; name: string; invite_code: string; is_public?: boolean }>(
    'banter_create_league',
    { p_name: name.trim(), p_is_public: isPublic },
  );
  // Before the public-leagues database change is applied, only the one-argument version exists.
  if (!r.ok && r.code === 'not_ready' && !isPublic) {
    return call<{ league_id: string; name: string; invite_code: string }>('banter_create_league', { p_name: name.trim() });
  }
  if (!r.ok && r.code === 'not_ready' && isPublic) return { ok: false as const, code: 'public_not_ready' };
  return r;
}

export const joinLeague = (code: string) =>
  call<{ league_id: string; name: string; already_member: boolean }>('banter_join_league', { p_invite_code: code.trim().toUpperCase() });

export interface PublicLeague {
  league_id: string;
  name: string;
  creator_handle: string | null;
  members: number;
  is_member: boolean;
  created_at: string;
}

export const fetchPublicLeagues = (search: string, order: 'newest' | 'biggest' = 'newest', limit = 30, offset = 0) =>
  call<PublicLeague[]>('banter_public_leagues', { p_search: search.trim() || null, p_limit: limit, p_offset: offset, p_order: order });

export const joinPublicLeague = (leagueId: string) =>
  call<{ league_id: string; name: string; already_member: boolean }>('banter_join_public_league', { p_league_id: leagueId });

export const setLeaguePublic = (leagueId: string, isPublic: boolean) =>
  call<boolean>('banter_set_league_public', { p_league_id: leagueId, p_is_public: isPublic });

export const leaveLeague = (leagueId: string) =>
  call<'left' | 'deleted'>('banter_leave_league', { p_league_id: leagueId });

export const fetchLeagueTable = (leagueId: string, period: LeaderboardPeriod) =>
  call<LeaderboardRow[]>('banter_league_table', { p_league_id: leagueId, p_period: period });

// ---------------------------------------------------------------------------
// Wall
// ---------------------------------------------------------------------------

export interface WallPost {
  id: string;
  handle: string;
  avatar_emoji: string;
  body: string;
  created_at: string;
  is_me: boolean;
  can_delete: boolean;
  /** Missing until the reply-everywhere database change is applied. */
  tagged_handle?: string | null;
  tagged_is_me?: boolean;
  reply_to?: QuotedMessage | null;
  /** Missing until the reactions database change is applied. */
  reactions?: ReactionCounts | null;
  my_reaction?: ReactionKind | null;
  /** A shared pick (missing until the share-pick database change is applied). */
  pick?: SharedPick | null;
}

/** A member's own football pick shared into a message, read live by the server. */
export interface SharedPick {
  id: string;
  market: string;
  selection: string;
  kickoff_at: string;
  status: 'pending' | 'won' | 'lost' | 'void';
  points: number | null;
  league_name: string | null;
  league_country: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
}

export const sharePick = (pickId: string, dest: { topicId?: string; leagueId?: string }, comment: string) =>
  call<{ id: string; created_at: string; kind: 'reply' | 'post' }>('banter_share_pick', {
    p_pick_id: pickId,
    p_topic_id: dest.topicId || null,
    p_league_id: dest.leagueId || null,
    p_comment: comment.trim() || null,
  });

export type ReactionKind = 'up' | 'down' | 'angry' | 'laugh' | 'cry';
export type ReactionTarget = 'topic' | 'reply' | 'post';
export type ReactionCounts = Partial<Record<ReactionKind, number>>;

export const react = (kind: ReactionTarget, id: string, reaction: ReactionKind) =>
  call<{ state: 'added' | 'changed' | 'removed'; reaction_id: string | null; counts: ReactionCounts | null; mine: ReactionKind | null }>(
    'banter_react',
    { p_kind: kind, p_id: id, p_reaction: reaction },
  );

/** The message a reply answers: a live one (with a short preview) or one that was removed. */
export type QuotedMessage =
  | { id: string; removed: true }
  | { id: string; removed: false; handle: string; preview: string; topic?: boolean };

export const fetchWall = (leagueId: string | null, before: string | null, limit = 30) =>
  call<WallPost[]>('banter_wall', { p_league_id: leagueId, p_before: before, p_limit: limit });

export async function postToWall(body: string, leagueId: string | null, replyTo: string | null = null) {
  const plain = { p_body: body.trim(), p_league_id: leagueId };
  if (!replyTo) return call<{ id: string; created_at: string }>('banter_post', plain);
  const r = await call<{ id: string; created_at: string }>('banter_post', { ...plain, p_reply_to: replyTo });
  // Before the reply-everywhere database change only the two-argument version exists: post it plainly.
  if (!r.ok && r.code === 'not_ready') return call<{ id: string; created_at: string }>('banter_post', plain);
  return r;
}

export const deleteWallPost = (postId: string) => call<boolean>('banter_delete_post', { p_post_id: postId });

// ---------------------------------------------------------------------------
// Discussion (topics, replies, in-app notifications)
// ---------------------------------------------------------------------------

export interface TopicSummary {
  id: string;
  title: string;
  preview: string;
  handle: string;
  avatar_emoji: string;
  created_at: string;
  last_activity_at: string;
  replies: number;
  is_me: boolean;
  can_delete: boolean;
  /** Missing until the mentions / pins database change is applied. */
  is_pinned?: boolean;
  can_pin?: boolean;
}

export interface TopicReply {
  id: string;
  body: string;
  handle: string;
  avatar_emoji: string;
  created_at: string;
  is_me: boolean;
  can_delete: boolean;
  tagged_handle: string | null;
  tagged_is_me: boolean;
  reply_to: QuotedMessage | null;
  reactions?: ReactionCounts | null;
  my_reaction?: ReactionKind | null;
  pick?: SharedPick | null;
}

export interface TopicDetail {
  topic: {
    id: string;
    title: string;
    body: string;
    handle: string;
    avatar_emoji: string;
    created_at: string;
    last_activity_at: string;
    is_me: boolean;
    can_delete: boolean;
    reactions?: ReactionCounts | null;
    my_reaction?: ReactionKind | null;
  };
  replies: TopicReply[];
}

export interface BanterNotification {
  id: string;
  kind: 'reply' | 'topic_reply' | 'league_reply' | 'reaction' | 'mention';
  /** For kind 'reaction'. */
  reaction?: ReactionKind | null;
  topic_id: string | null;
  topic_title: string | null;
  reply_id: string | null;
  /** League wall replies (kind 'league_reply'). */
  league_id?: string | null;
  league_name?: string | null;
  post_id?: string | null;
  preview: string;
  from_handle: string;
  from_avatar: string;
  created_at: string;
  is_read: boolean;
}

export const fetchTopics = (search: string, limit = 20, offset = 0) =>
  call<TopicSummary[]>('banter_topics', { p_search: search.trim() || null, p_limit: limit, p_offset: offset });

export const fetchTopic = (topicId: string) => call<TopicDetail>('banter_topic', { p_topic_id: topicId });

export const createTopic = (title: string, body: string) =>
  call<{ id: string; created_at: string }>('banter_create_topic', { p_title: title.trim(), p_body: body.trim() });

export async function postReply(topicId: string, body: string, replyTo: string | null, toTopic = false) {
  const plain = { p_topic_id: topicId, p_body: body.trim(), p_reply_to: replyTo };
  if (!toTopic || replyTo) return call<{ id: string; created_at: string }>('banter_post_reply', plain);
  const r = await call<{ id: string; created_at: string }>('banter_post_reply', { ...plain, p_reply_to_topic: true });
  // Before the reply-everywhere database change: a plain reply (the topic author is still notified).
  if (!r.ok && r.code === 'not_ready') return call<{ id: string; created_at: string }>('banter_post_reply', plain);
  return r;
}

export const deleteTopic = (topicId: string) => call<boolean>('banter_delete_topic', { p_topic_id: topicId });

export const deleteReply = (replyId: string) => call<boolean>('banter_delete_reply', { p_reply_id: replyId });

export const fetchNotifications = (limit = 30) =>
  call<BanterNotification[]>('banter_my_notifications', { p_limit: limit });

export const fetchUnreadCount = () => call<number>('banter_unread_count', {});

export const markNotificationsRead = (ids: string[] | null) =>
  call<number>('banter_mark_notifications_read', { p_ids: ids });

// ---------------------------------------------------------------------------
// Mentions and pins
// ---------------------------------------------------------------------------

export interface HandleSuggestion {
  handle: string;
  avatar_emoji: string;
}

export const searchHandles = (prefix: string, leagueId: string | null = null) =>
  call<HandleSuggestion[]>('banter_search_handles', { p_prefix: prefix, p_league_id: leagueId });

export const pinTopic = (topicId: string, pinned: boolean) =>
  call<boolean>('banter_pin_topic', { p_topic_id: topicId, p_pinned: pinned });
