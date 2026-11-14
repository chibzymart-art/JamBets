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
