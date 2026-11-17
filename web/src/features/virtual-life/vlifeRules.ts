/**
 * Virtual Life pure helpers (no data calls), shared by the page and the tests.
 * The server decides everything that matters (balances, prices, ownership); these only shape
 * what the page shows.
 */

export type VlKind = 'base' | 'kit' | 'gear' | 'badge' | 'trophy' | 'room' | 'city';

export interface VlItem {
  key: string;
  kind: VlKind;
  name: string;
  emoji: string;
  price: number;
  for_sale: boolean;
  colour1: string | null;
  colour2: string | null;
}

export interface VlCity {
  key: string;
  name: string;
  country: string;
  flag: string;
  price: number;
}

export interface VlAvatarSlots {
  base: string | null;
  kit: string | null;
  gear: string | null;
  badge: string | null;
}

export interface VlLedgerRow {
  amount: number;
  reason: 'pick_won' | 'welcome' | 'welcome_topup' | 'checkin' | 'admin_grant' | 'shop' | 'travel';
  at: string;
}

export interface VlTrip {
  city: string;
  at: string;
}

export type VlState =
  | { status: 'visitor' }
  | { status: 'no_access' }
  | { status: 'needs_profile' }
  | { status: 'not_ready' }
  | { status: 'error' }
  | {
      status: 'ready';
      handle: string;
      isAdmin: boolean;
      balance: number;
      earnedTotal: number;
      wonPicksPaid: number;
      checkedInToday: boolean;
      streak: number;
      avatar: VlAvatarSlots;
      owned: string[];
      catalog: VlItem[];
      cities: VlCity[];
      trips: VlTrip[];
      recent: VlLedgerRow[];
    };

/** Coins per won Banter pick, welcome coins, check-in base and cap (must match the SQL). */
export const VL_COINS_PER_WIN = 10;
export const VL_WELCOME_COINS = 1000;
export const VL_CHECKIN_BASE = 5;
export const VL_CHECKIN_MAX = 11;

/** Bonus for a check-in that makes the streak `streak` days long (1 = first day). */
export function checkinBonus(streak: number): number {
  const s = Math.max(1, Math.floor(streak));
  return Math.min(VL_CHECKIN_BASE + (s - 1), VL_CHECKIN_MAX);
}

/** The streak a check-in today would give: carry on from yesterday, or start at 1. */
export function nextStreak(currentStreak: number, checkedInToday: boolean): number {
  return checkedInToday ? currentStreak : currentStreak + 1;
}

/** Free (price 0, for sale) items count as owned. */
export function isOwned(item: VlItem, owned: readonly string[]): boolean {
  return (item.for_sale && item.price === 0) || owned.includes(item.key);
}

/** Which item kinds fit an avatar slot. Travel badges go in the badge slot. */
export const SLOT_KINDS: Record<keyof VlAvatarSlots, VlKind[]> = {
  base: ['base'],
  kit: ['kit'],
  gear: ['gear'],
  badge: ['badge', 'city'],
};

/** Default look before the member has chosen: first free face and first free kit. */
export function defaultSlots(catalog: readonly VlItem[]): VlAvatarSlots {
  const free = (k: VlKind) => catalog.find((c) => c.kind === k && c.for_sale && c.price === 0)?.key ?? null;
  return { base: free('base'), kit: free('kit'), gear: null, badge: null };
}

export function withDefaults(slots: Partial<VlAvatarSlots> | null | undefined, catalog: readonly VlItem[]): VlAvatarSlots {
  if (!slots) return defaultSlots(catalog);
  return {
    base: slots.base ?? null,
    kit: slots.kit ?? null,
    gear: slots.gear ?? null,
    badge: slots.badge ?? null,
  };
}

export function itemByKey(catalog: readonly VlItem[], key: string | null): VlItem | undefined {
  return key ? catalog.find((c) => c.key === key) : undefined;
}

/** Where the fan is now: the most recent trip, else home. */
export function currentCity(trips: readonly VlTrip[], cities: readonly VlCity[]): VlCity | null {
  if (!trips.length) return null;
  const latest = [...trips].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  return cities.find((c) => c.key === latest.city) ?? null;
}

export function formatCoins(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

const REASON_LABEL: Record<VlLedgerRow['reason'], string> = {
  pick_won: 'Won Banter pick',
  welcome: 'Welcome coins',
  welcome_topup: 'Welcome top-up',
  admin_grant: 'Gift from admin',
  checkin: 'Daily check-in',
  shop: 'Shop',
  travel: 'Flight',
};

export function reasonLabel(r: string): string {
  return REASON_LABEL[r as VlLedgerRow['reason']] ?? 'Coins';
}

const ERRORS: Record<string, string> = {
  not_enough_coins: "You don't have enough Banta Coins for that yet. Win Banter picks or check in daily to earn more.",
  already_owned: 'You already own this.',
  already_visited: "You've already been to this city.",
  already_checked_in: "You've already checked in today. Come back tomorrow.",
  item_not_owned: "You don't own that item yet.",
  not_for_sale: 'That item is not for sale.',
  item_unknown: 'That item is no longer available.',
  city_unknown: 'That city is no longer available.',
  no_access: 'Virtual Life is for paid members.',
  no_profile: 'Choose your Banter Hub username first.',
  not_signed_in: 'Please sign in again.',
  not_admin: 'Only admins can give coins.',
  member_not_found: 'No member found with that username or email.',
  amount_invalid: 'Enter an amount from 1 to 100,000.',
};

export function vlErrorMessage(code: string): string {
  return ERRORS[code] ?? 'Something went wrong. Please try again.';
}

/** Turn the raw vl_get_state() JSON into a page state. Anything unexpected fails closed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toVlState(raw: any): VlState {
  if (!raw || typeof raw !== 'object') return { status: 'error' };
  if (raw.signed_in === false) return { status: 'visitor' };
  if (raw.access !== true) return { status: 'no_access' };
  if (raw.needs_profile === true) return { status: 'needs_profile' };
  if (typeof raw.handle !== 'string' || typeof raw.balance !== 'number') return { status: 'error' };
  const catalog: VlItem[] = Array.isArray(raw.catalog) ? raw.catalog : [];
  return {
    status: 'ready',
    handle: raw.handle,
    isAdmin: raw.is_admin === true,
    balance: raw.balance,
    earnedTotal: Number(raw.earned_total) || 0,
    wonPicksPaid: Number(raw.won_picks_paid) || 0,
    checkedInToday: raw.checked_in_today === true,
    streak: Number(raw.streak) || 0,
    avatar: withDefaults(raw.avatar, catalog),
    owned: Array.isArray(raw.owned) ? raw.owned : [],
    catalog,
    cities: Array.isArray(raw.cities) ? raw.cities : [],
    trips: Array.isArray(raw.trips) ? raw.trips : [],
    recent: Array.isArray(raw.recent) ? raw.recent : [],
  };
}

/** Admins have unlimited coins: the server never refuses their spends. */
export function canAfford(price: number, balance: number, isAdmin: boolean): boolean {
  return isAdmin || balance >= price;
}
