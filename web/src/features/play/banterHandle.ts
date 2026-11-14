/**
 * Banter Hub username rules. Mirrors the database checks in
 * supabase/migrations/20261114000001_banter_foundations.sql (the server is the authority;
 * this only gives instant feedback while typing).
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 20;
export const HANDLE_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

export const RESERVED_HANDLES = [
  'admin', 'administrator', 'oddsbanta', 'support', 'moderator', 'mod',
  'staff', 'system', 'root', 'null', 'undefined',
];

export const AVATAR_CHOICES = ['⚽', '🦅', '🦁', '🐐', '🔥', '🎯', '🧠', '⚡', '👑', '🦉', '🐆', '🚀'];

export type HandleProblem = 'too_short' | 'too_long' | 'bad_chars' | 'reserved' | null;

/** Returns the first problem with a handle, or null when it is acceptable. */
export function checkHandle(raw: string): HandleProblem {
  const h = (raw || '').trim();
  if (h.length < HANDLE_MIN) return 'too_short';
  if (h.length > HANDLE_MAX) return 'too_long';
  if (!HANDLE_PATTERN.test(h)) return 'bad_chars';
  if (RESERVED_HANDLES.includes(h.toLowerCase())) return 'reserved';
  return null;
}

/** Plain-English message for a local check result or a server error code. */
export function handleMessage(code: string | null): string {
  switch (code) {
    case 'too_short':
      return `Use at least ${HANDLE_MIN} characters.`;
    case 'too_long':
      return `Use ${HANDLE_MAX} characters or fewer.`;
    case 'bad_chars':
    case 'handle_invalid':
      return 'Use only letters, numbers and underscores (no spaces).';
    case 'reserved':
    case 'handle_reserved':
      return 'That username is reserved. Please choose another.';
    case 'handle_taken':
      return 'That username is taken. Please choose another.';
    case 'avatar_invalid':
      return 'Please pick one of the avatars.';
    case 'no_access':
      return 'Banter Hub is for paid members. Upgrade to keep using it.';
    case 'not_signed_in':
      return 'Please sign in again.';
    case 'no_user_row':
      return 'Your account is still being set up. Please try again in a minute.';
    case null:
      return '';
    default:
      return 'Something went wrong. Please try again.';
  }
}
