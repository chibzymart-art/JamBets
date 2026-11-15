import { supabase } from '../../lib/supabase';

/**
 * Banter Hub push notifications (installed web app and browsers).
 *
 * - The push-only service worker /banter-sw.js is registered here, by the Banter Hub only, with
 *   scope /play/. It has no fetch handler, so no page (Predictions Hub included) behaves differently.
 * - Browsers only show the permission prompt after the member's own tap: turnOnPush() must be
 *   called from a click.
 * - iPhone / iPad: push works only after the site is added to the Home Screen (iOS 16.4+).
 * - After a successful post the website calls notifyPush(kind, id); the server works out who to
 *   notify. It is fire-and-forget: a failure never affects posting.
 */

export const SW_URL = '/banter-sw.js';
export const SW_SCOPE = '/play/';

export type PushSupport =
  | 'supported'
  | 'ios_needs_home_screen' // iPhone/iPad in Safari: add to Home Screen first
  | 'unsupported';

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && (navigator.maxTouchPoints || 0) > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const has = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !isStandalone()) return 'ios_needs_home_screen';
  return has ? 'supported' : 'unsupported';
}

export function permission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((base64.length + 3) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (pushSupport() !== 'supported') return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration(SW_SCOPE);
    if (existing) return existing;
    return await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
  } catch {
    return null;
  }
}

async function serverKey(): Promise<string | null> {
  try {
    const res = await fetch('/api/banter-push', { method: 'GET' });
    if (!res.ok) return null;
    const j = (await res.json()) as { enabled?: boolean; publicKey?: string | null };
    return j.enabled && j.publicKey ? j.publicKey : null;
  } catch {
    return null;
  }
}

/** This device's current push subscription, if any (no prompt). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  if (!reg) return null;
  try { return await reg.pushManager.getSubscription(); } catch { return null; }
}

export type TurnOnResult = 'on' | 'denied' | 'unsupported' | 'ios_needs_home_screen' | 'not_ready' | 'failed';

/** Ask permission (must be called from a tap), subscribe this device and save it for the member. */
export async function turnOnPush(): Promise<TurnOnResult> {
  const support = pushSupport();
  if (support !== 'supported') return support;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const key = await serverKey();
  if (!key) return 'not_ready';
  const reg = await registration();
  if (!reg) return 'failed';
  try {
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
    }
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    const { error } = await supabase.rpc('banter_save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys?.p256dh,
      p_auth: json.keys?.auth,
      p_user_agent: navigator.userAgent.slice(0, 300),
    });
    if (error) {
      if (error.code === 'PGRST202' || /could not find the function/i.test(error.message || '')) return 'not_ready';
      return 'failed';
    }
    return 'on';
  } catch {
    return 'failed';
  }
}

/** Stop push on this device (unsubscribe and forget it on the server). */
export async function turnOffPush(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return true;
  try {
    await supabase.rpc('banter_remove_push_subscription', { p_endpoint: sub.endpoint });
  } catch { /* still unsubscribe locally */ }
  try { return await sub.unsubscribe(); } catch { return false; }
}

/** After a successful post: ask the server to notify the right members. Never throws or blocks. */
export function notifyPush(kind: 'reply' | 'post' | 'join' | 'reaction' | 'topic' | 'pick' | 'follow', id: string | null | undefined): void {
  if (!id) return;
  void (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      await fetch('/api/banter-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind, id }),
        keepalive: true,
      });
    } catch { /* push is best effort */ }
  })();
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface PushSettings {
  replies: boolean;
  league_messages: boolean;
  league_activity: boolean;
  /** Missing until the follows database change is applied. */
  thread_messages?: boolean;
  follows?: boolean;
  muted_leagues: string[];
  devices: number;
}

export async function fetchPushSettings(): Promise<PushSettings | null> {
  try {
    const { data, error } = await supabase.rpc('banter_push_settings');
    if (error) return null;
    return data as PushSettings;
  } catch {
    return null;
  }
}

export async function savePushSettings(
  s: Pick<PushSettings, 'replies' | 'league_messages' | 'league_activity' | 'thread_messages' | 'follows'>,
): Promise<boolean> {
  if (s.thread_messages !== undefined || s.follows !== undefined) {
    try {
      const { error } = await supabase.rpc('banter_set_push_settings', {
        p_replies: s.replies,
        p_league_messages: s.league_messages,
        p_league_activity: s.league_activity,
        p_thread_messages: s.thread_messages ?? null,
        p_follows: s.follows ?? null,
      });
      if (!error) return true;
      if (!(error.code === 'PGRST202' || /could not find the function/i.test(error.message || ''))) return false;
    } catch {
      return false;
    }
  }
  try {
    const { error } = await supabase.rpc('banter_set_push_settings', {
      p_replies: s.replies,
      p_league_messages: s.league_messages,
      p_league_activity: s.league_activity,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function setLeagueMute(leagueId: string, muted: boolean): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('banter_set_league_mute', { p_league_id: leagueId, p_muted: muted });
    return !error;
  } catch {
    return false;
  }
}

// The "Turn on notifications" card is shown once (until dismissed or turned on) per browser.
const PROMPT_KEY = 'banter_push_prompt_v1';
export function promptDismissed(): boolean {
  try { return localStorage.getItem(PROMPT_KEY) === 'done'; } catch { return false; }
}
export function dismissPrompt(): void {
  try { localStorage.setItem(PROMPT_KEY, 'done'); } catch { /* private mode */ }
}
