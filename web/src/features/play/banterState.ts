/** Maps the server's get_banter_state() reply to the screen to show. Pure, so it can be unit-tested. */

export type BanterState =
  | { status: 'visitor' }
  | { status: 'no_access' }
  | { status: 'needs_profile' }
  | { status: 'ready'; handle: string; avatar: string; leagues: string[] | null }
  | { status: 'error' };

export interface RawState {
  signed_in?: boolean;
  access?: boolean;
  handle?: string | null;
  avatar_emoji?: string | null;
  followed_leagues?: string[] | null;
}

export function toBanterState(raw: RawState | null | undefined): BanterState {
  if (!raw || typeof raw !== 'object') return { status: 'error' };
  if (!raw.signed_in) return { status: 'visitor' };
  if (raw.access !== true) return { status: 'no_access' };
  if (!raw.handle) return { status: 'needs_profile' };
  return {
    status: 'ready',
    handle: raw.handle,
    avatar: raw.avatar_emoji || '⚽',
    leagues: Array.isArray(raw.followed_leagues) ? raw.followed_leagues : null,
  };
}
