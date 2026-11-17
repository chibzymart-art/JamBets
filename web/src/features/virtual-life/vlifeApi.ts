import { supabase } from '../../lib/supabase';
import { toVlState, type VlAvatarSlots, type VlState } from './vlifeRules';

/**
 * Virtual Life data calls. Every earn and spend happens in database functions
 * (vl_check_in, vl_buy, vl_travel); the page never sends an amount, only what to buy or where to fly.
 */

type Result<T> = { ok: true; data: T } | { ok: false; code: string };

function errorCode(err: { message?: string; code?: string } | null): string {
  const m = (err?.message || '').trim();
  // Migration not applied yet: PostgREST can't find the function.
  if (err?.code === 'PGRST202' || /could not find the function/i.test(m)) return 'not_ready';
  return /^[a-z_]+$/.test(m) ? m : 'unknown';
}

export async function fetchVlState(isSignedIn: boolean): Promise<VlState> {
  if (!isSignedIn) return { status: 'visitor' };
  try {
    const { data, error } = await supabase.rpc('vl_get_state');
    if (error) return errorCode(error) === 'not_ready' ? { status: 'not_ready' } : { status: 'error' };
    return toVlState(data);
  } catch {
    return { status: 'error' };
  }
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<Result<T>> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, code: errorCode(error) };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, code: 'unknown' };
  }
}

export const vlCheckIn = () => call<{ streak: number; bonus: number; balance: number }>('vl_check_in');

export const vlBuy = (itemKey: string) => call<{ item: string; balance: number }>('vl_buy', { p_item_key: itemKey });

export const vlTravel = (cityKey: string) =>
  call<{ city: string; badge: string; balance: number }>('vl_travel', { p_city_key: cityKey });

export const vlSetAvatar = (s: VlAvatarSlots) =>
  call<VlAvatarSlots>('vl_set_avatar', { p_base: s.base, p_kit: s.kit, p_gear: s.gear, p_badge: s.badge });

export interface VlLeaderRow {
  place: number;
  handle: string;
  avatar_emoji: string;
  base_emoji: string | null;
  value: number;
  is_me: boolean;
}

export const vlLeaderboard = (kind: 'rich' | 'travel', limit = 50) =>
  call<VlLeaderRow[]>('vl_leaderboard', { p_kind: kind, p_limit: limit });

/** Balance for the Banter profile card; null when not available (no access, not applied, error). */
export async function fetchVlBalance(): Promise<number | null> {
  const r = await call<number | null>('vl_my_balance');
  return r.ok && typeof r.data === 'number' ? r.data : null;
}
