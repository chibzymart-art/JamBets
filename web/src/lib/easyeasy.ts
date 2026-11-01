/**
 * EasyEasy promoter conversion reporting (registrations only).
 *
 * The pixel (loaded async in index.html) captures a promoter click id from the landing URL
 * (ee_click_id / subid / ee_subid / click_id) into localStorage + a 30-day cookie.
 * Here we only report a registration when a click id exists, so organic users are never sent to EasyEasy.
 *
 * Privacy: EasyEasy receives only { event: 'signup', order_id: <random account id>, subid: <their click id> }
 * plus the page address and referrer, which the pixel adds itself. We never pass a name, email or password,
 * and we only send while the page address and referrer carry no login tokens, codes or email addresses.
 *
 * Every call is fire-and-forget: if the pixel is blocked or EasyEasy is down, nothing on Oddsbanta changes.
 */
import { supabase } from './supabase';

interface EasyEasyApi {
  initialized?: boolean;
  track?: (event: string, data?: Record<string, unknown>) => Promise<unknown>;
  getClickId?: () => string | null;
}

interface SignupUser {
  id: string;
  created_at?: string;
  user_metadata?: Record<string, unknown> | null;
}

/** A registration counts if the account is reported within this many days of being created. */
const ATTRIBUTION_DAYS = 30;
const SENSITIVE_KEY = /token|code|email|password|secret|otp|key|session|auth|jwt/i;

function api(): EasyEasyApi | null {
  if (typeof window === 'undefined') return null;
  return ((window as unknown as { EasyEasy?: EasyEasyApi }).EasyEasy) || null;
}

/** Promoter click id held by the pixel in this browser, if any. */
export function getEasyEasyClickId(): string | null {
  try {
    const fromPixel = api()?.getClickId?.();
    if (fromPixel) return String(fromPixel).slice(0, 200);
    const stored = window.localStorage.getItem('ee_click_id');
    return stored ? stored.slice(0, 200) : null;
  } catch {
    return null;
  }
}

function hasSensitiveParts(raw: string): boolean {
  if (!raw) return false;
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return true;
  }
  if (url.username || url.password) return true;
  const hash = url.hash.replace(/^#/, '');
  if (hash.includes('=')) return true; // auth callbacks put tokens in the hash
  for (const [k, v] of url.searchParams) {
    if (SENSITIVE_KEY.test(k) || v.includes('@')) return true;
  }
  return false;
}

/** True when the address and referrer the pixel will attach carry nothing personal. */
export function pageIsSafeToReport(): boolean {
  try {
    return !hasSensitiveParts(window.location.href) && !hasSensitiveParts(document.referrer || '');
  } catch {
    return false;
  }
}

const inFlight = new Set<string>();

/**
 * Report a registration once per account. Called on every sign-in; it decides for itself:
 * - only accounts created in the last ATTRIBUTION_DAYS (so a late email confirmation still counts),
 * - only with a promoter click id: the one saved on the account at sign-up, or, for Google sign-ups,
 *   the one in this browser, provided the account was created after that promoter click
 *   (an existing member who clicks a promoter link is not a new registration),
 * - never twice: marked on the account (works across devices) and in this browser.
 */
export function reportEasyEasySignup(user: SignupUser | null | undefined): void {
  try {
    if (!user?.id) return;
    const meta = user.user_metadata || {};
    if (meta.ee_signup_reported_at) return;
    const doneKey = `ob_ee_signup_${user.id}`;
    if (window.localStorage.getItem(doneKey) === '1') return;
    if (inFlight.has(user.id)) return;

    const createdMs = Date.parse(user.created_at || '');
    if (!Number.isFinite(createdMs) || Date.now() - createdMs > ATTRIBUTION_DAYS * 864e5) return;

    let clickId = typeof meta.ee_click_id === 'string' && meta.ee_click_id ? meta.ee_click_id.slice(0, 200) : null;
    if (!clickId) {
      const local = getEasyEasyClickId();
      const clickTime = Number(window.localStorage.getItem('ee_click_time'));
      if (local && Number.isFinite(clickTime) && clickTime > 0 && createdMs >= clickTime - 60_000) clickId = local;
    }
    if (!clickId) return; // not referred by a promoter: report nothing

    inFlight.add(user.id);
    const send = (): boolean => {
      const ee = api();
      if (!ee?.track || !pageIsSafeToReport()) return false;
      window.localStorage.setItem(doneKey, '1');
      ee.track('signup', { order_id: user.id, subid: clickId }).catch(() => null);
      // Mark on the account so no other device reports it again; also keeps the click id for Google sign-ups.
      supabase.auth
        .updateUser({ data: { ee_click_id: clickId, ee_signup_reported_at: new Date().toISOString() } })
        .catch(() => null);
      return true;
    };
    // The pixel loads async and supabase-js clears login tokens from the address on its own; wait for both.
    // If it never becomes safe, nothing is sent now and the next sign-in tries again.
    if (send()) {
      inFlight.delete(user.id);
      return;
    }
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      let done = false;
      try {
        done = send();
      } catch {
        done = false;
      }
      if (done || tries >= 30) {
        window.clearInterval(timer);
        inFlight.delete(user.id);
      }
    }, 1000);
  } catch {
    /* tracking must never affect sign-in */
  }
}
