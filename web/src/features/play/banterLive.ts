import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';

/**
 * Banter Hub live updates, with no database change.
 *
 * - "Pings": a Supabase Realtime broadcast per conversation (a topic, a league wall, the topic list,
 *   one member). A ping carries no message text, only that something changed. Whoever is looking
 *   refetches through the normal RPCs, so every access rule stays in the database functions.
 *   The sender pings right after a successful post; its own client ignores its own pings.
 * - Polling fallback: every POLL_MS while the page is visible (paused when hidden, and an immediate
 *   refresh when it becomes visible again), so a missed ping or a blocked socket still updates.
 */

export const POLL_MS = 10_000;

/** Channel names. Handles are lower-cased so a member's channel does not depend on capitals. */
export const liveKey = {
  topic: (topicId: string) => `topic:${topicId}`,
  topicList: () => 'topics',
  league: (leagueId: string) => `league:${leagueId}`,
  member: (handle: string) => `member:${handle.trim().toLowerCase()}`,
};

type Listener = () => void;
interface Entry { channel: RealtimeChannel; listeners: Set<Listener>; joined: boolean }
const channels = new Map<string, Entry>();

function entryFor(key: string): Entry {
  let e = channels.get(key);
  if (e) return e;
  const channel = supabase.channel(`banter:${key}`, { config: { broadcast: { self: false, ack: false } } });
  const entry: Entry = { channel, listeners: new Set(), joined: false };
  channel.on('broadcast', { event: 'ping' }, () => {
    entry.listeners.forEach((fn) => {
      try { fn(); } catch { /* a listener error must not break the others */ }
    });
  });
  channels.set(key, entry);
  return entry;
}

/** Listen for pings on one channel. Returns the unsubscribe function. */
export function subscribePing(key: string, fn: Listener): () => void {
  const e = entryFor(key);
  e.listeners.add(fn);
  if (!e.joined) {
    e.joined = true;
    try {
      e.channel.subscribe();
    } catch {
      /* realtime unavailable: polling still updates */
    }
  }
  return () => {
    e.listeners.delete(fn);
    if (e.listeners.size === 0) {
      channels.delete(key);
      try { supabase.removeChannel(e.channel); } catch { /* ignore */ }
    }
  };
}

/** Tell everyone looking at these channels that something changed. Never throws, never blocks. */
export function sendPing(...keys: (string | null | undefined)[]): void {
  const unique = [...new Set(keys.filter((k): k is string => !!k))];
  for (const key of unique) {
    const listening = channels.get(key);
    try {
      if (listening && listening.channel.state === 'joined') {
        void listening.channel.send({ type: 'broadcast', event: 'ping', payload: { at: Date.now() } });
      } else {
        // Not listening on it ourselves: deliver over REST without joining.
        const ch = supabase.channel(`banter:${key}`, { config: { broadcast: { self: false, ack: false } } });
        ch.httpSend('ping', { at: Date.now() })
          .catch(() => { /* polling covers it */ })
          .finally(() => { try { supabase.removeChannel(ch); } catch { /* ignore */ } });
      }
    } catch {
      /* polling covers it */
    }
  }
  // Same-tab listeners (another panel of this page, e.g. the bell) update straight away.
  notifyLocal();
}

// ---------------------------------------------------------------------------
// Same-tab signal: something about "Replies to you" changed (read, new, etc.).
// ---------------------------------------------------------------------------
const localListeners = new Set<Listener>();
export function onLocalNotify(fn: Listener): () => void {
  localListeners.add(fn);
  return () => { localListeners.delete(fn); };
}
export function notifyLocal(): void {
  localListeners.forEach((fn) => {
    try { fn(); } catch { /* ignore */ }
  });
}

/**
 * Keep something fresh while it is on screen: refresh on pings from the given channels and every
 * intervalMs while the page is visible. Refreshes are coalesced (at most one in flight, one queued).
 */
export function useLiveRefresh(
  keys: (string | null | undefined)[],
  refresh: () => Promise<unknown> | unknown,
  { intervalMs = POLL_MS, enabled = true }: { intervalMs?: number; enabled?: boolean } = {},
): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const keyList = keys.filter((k): k is string => !!k).join('|');

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    let queued = false;
    let disposed = false;

    const run = async () => {
      if (disposed) return;
      if (running) { queued = true; return; }
      running = true;
      try { await refreshRef.current(); } catch { /* keep polling */ }
      running = false;
      if (queued && !disposed) { queued = false; void run(); }
    };

    const unsubs = keyList ? keyList.split('|').map((k) => subscribePing(k, () => { void run(); })) : [];

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(() => { void run(); }, intervalMs); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { void run(); start(); } else stop();
    };
    if (typeof document === 'undefined' || document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      unsubs.forEach((u) => u());
    };
  }, [keyList, intervalMs, enabled]);
}

/** True when the element's bottom is within `slack` px of the viewport bottom (reading the latest). */
export function nearBottom(slack = 200): boolean {
  if (typeof window === 'undefined') return true;
  const doc = document.documentElement;
  return window.innerHeight + window.scrollY >= doc.scrollHeight - slack;
}

/** True when the element's top is at or below the top of the viewport (its first items are visible). */
export function topVisible(el: HTMLElement | null): boolean {
  if (!el) return true;
  return el.getBoundingClientRect().top >= -40;
}
