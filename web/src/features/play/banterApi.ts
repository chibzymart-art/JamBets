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
function errorCode(err: { message?: string } | null): string {
  const m = (err?.message || '').trim();
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
