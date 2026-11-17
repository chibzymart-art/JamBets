import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { supabase } from '../lib/supabase';
import type { FavoritePredictionItem } from '../components/FavoritesDrawer';
import { mergeSlips, type SlipState } from './slipMerge';

/**
 * Keeps the Acca slip in step with the signed-in member's account (public.user_slips), so a slip
 * built on the laptop shows on the phone and the other way round.
 *
 * The existing per-device copy in localStorage is left exactly as it is; this hook only reads the
 * App's slip state and, when the account has a newer slip, puts it into that state (and localStorage).
 *  - First sign-in on a device: device slip and account slip are merged, then saved.
 *  - After that: a change on this device is saved (short delay); when the page is opened or comes
 *    back into view, a newer account slip replaces this device's copy.
 * Signed out: nothing happens. Any error: the slip keeps working per device as before.
 */

const LS_ITEMS = 'oddsbanta_favorites_v2';
const LS_IDS = 'jambets_favorites';
const syncedKey = (uid: string) => `oddsbanta_slip_synced_${uid}`; // account updated_at last seen here
const dirtyKey = (uid: string) => `oddsbanta_slip_dirty_${uid}`; // local change not yet saved

function lsGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string | null) {
  try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* blocked */ }
}

export function useSlipSync(
  userId: string | null | undefined,
  items: FavoritePredictionItem[],
  ids: string[],
  setItems: Dispatch<SetStateAction<FavoritePredictionItem[]>>,
  setIds: Dispatch<SetStateAction<string[]>>,
) {
  const current = useRef<SlipState>({ items, ids });
  current.current = { items, ids };
  const ready = useRef(false); // first pull done for this user
  const applying = useRef<string | null>(null); // snapshot we just put in from the account
  const saveTimer = useRef<number | null>(null);
  const lastSent = useRef<string>('');

  const apply = (s: SlipState) => {
    const snap = JSON.stringify(s);
    applying.current = snap;
    lastSent.current = snap;
    setItems(s.items);
    setIds(s.ids);
    lsSet(LS_ITEMS, JSON.stringify(s.items));
    lsSet(LS_IDS, JSON.stringify(s.ids));
  };

  const save = async (uid: string, s: SlipState) => {
    const { data, error } = await supabase.rpc('slip_save', { p_items: s.items, p_fixture_ids: s.ids });
    if (error) return false;
    const at = (data as { updated_at?: string } | null)?.updated_at ?? null;
    if (at) lsSet(syncedKey(uid), at);
    lsSet(dirtyKey(uid), null);
    lastSent.current = JSON.stringify(s);
    return true;
  };

  const pull = async (uid: string) => {
    const { data, error } = await supabase.rpc('slip_get');
    if (error || !data) return;
    const server = data as { items: FavoritePredictionItem[]; fixture_ids: string[]; updated_at: string | null };
    const serverState: SlipState = {
      items: Array.isArray(server.items) ? server.items : [],
      ids: Array.isArray(server.fixture_ids) ? server.fixture_ids : [],
    };
    const local = current.current;
    const seenAt = lsGet(syncedKey(uid));
    const dirty = lsGet(dirtyKey(uid)) === '1';

    if (!seenAt) {
      // First time on this device for this account: keep both.
      const merged = mergeSlips(local, serverState);
      apply(merged);
      await save(uid, merged);
    } else if (dirty) {
      // Changes made here that never reached the account: send them.
      await save(uid, local);
    } else if (server.updated_at && server.updated_at !== seenAt) {
      // The account has a newer slip (changed on another device).
      apply(serverState);
      lsSet(syncedKey(uid), server.updated_at);
    }
    ready.current = true;
  };

  // Pull on sign-in / page load, and whenever the page comes back into view.
  useEffect(() => {
    ready.current = false;
    if (!userId) return;
    let alive = true;
    pull(userId).catch(() => { ready.current = true; });
    const onVisible = () => {
      if (alive && document.visibilityState === 'visible') pull(userId).catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Save local changes to the account.
  useEffect(() => {
    if (!userId || !ready.current) return;
    const snap = JSON.stringify({ items, ids });
    if (applying.current === snap) { applying.current = null; return; }
    if (snap === lastSent.current) return;
    lsSet(dirtyKey(userId), '1');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      save(userId, { items, ids }).catch(() => {});
    }, 600);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, ids, userId]);
}
