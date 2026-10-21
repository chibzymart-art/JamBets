// Locked-teaser helpers for Edge feeds.
//
// A locked item (visitor, expired trial, or a tier without access) must be built from an
// explicit ALLOWLIST of fields. Never spread the raw row (`...p`) or its `metadata` into a
// locked response: new columns added later would leak automatically.

/** Copies only the listed keys that exist on `src`. */
export function pickFields(src: Record<string, any> | null | undefined, keys: readonly string[]): Record<string, any> {
  const out: Record<string, any> = {};
  if (!src || typeof src !== 'object') return out;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
  }
  return out;
}

/** Parses metadata that may arrive as a JSON string. */
export function parseMeta(meta: unknown): Record<string, any> {
  if (!meta) return {};
  if (typeof meta === 'string') {
    try {
      const parsed = JSON.parse(meta);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof meta === 'object' ? (meta as Record<string, any>) : {};
}

/** Builds a locked teaser: allowlisted fields, allowlisted metadata, then fixed overrides. */
export function toLockedTeaser(
  src: Record<string, any>,
  opts: {
    keys: readonly string[];
    metaKeys?: readonly string[];
    overrides?: Record<string, any>;
    metaOverrides?: Record<string, any>;
  }
): Record<string, any> {
  const base = pickFields(src, opts.keys);
  const meta = {
    ...pickFields(parseMeta(src?.metadata), opts.metaKeys || []),
    ...(opts.metaOverrides || {}),
  };
  // A nested fixture may carry its own metadata (ingestion notes, model inputs): never send it locked.
  if (base.fixture && typeof base.fixture === 'object') {
    const { metadata: _fixtureMeta, ...fixtureRest } = base.fixture;
    base.fixture = fixtureRest;
  }
  return { ...base, ...(opts.overrides || {}), metadata: meta };
}

/**
 * Markets whose row set is itself the pick (one row per published signal, or a curated shortlist).
 * Locked users get counts for these, never the fixture list. Every market-feed market is one.
 * The 1X2 specialist markets (home_win, away_win, draw) are retired and no longer served.
 */
export const MEMBERSHIP_REVEALING_MARKETS: readonly string[] = [
  'general',
  'curated',
  'corners',
  'over_2.5_goals',
  'ht_over_0.5_goals',
];

/** Retired market names. Requests for them get 410 so nothing silently serves a different market. */
export const RETIRED_MARKETS: readonly string[] = ['home_win', 'away_win', 'draw'];

// ---------------------------------------------------------------------------
// Confidence tiers for locked users
//
// A tier on a locked card (BANGER next to "#1 vs #105") gives the pick away, so locked items carry
// LOCKED_TIER instead. The hubs still show "BANGER 3M" style totals: those come from
// buildLockedTierCounts, which only reports per-day totals and drops days with too few matches
// to hide anything.
// ---------------------------------------------------------------------------

export const LOCKED_TIER = 'LOCKED';

export type TierKey = 'BANGER' | 'TOP_PICK' | 'HIGH' | 'MID' | 'LOW' | 'NO_SAFE_BANKER' | 'OTHER';
export const TIER_KEYS: readonly TierKey[] = ['BANGER', 'TOP_PICK', 'HIGH', 'MID', 'LOW', 'NO_SAFE_BANKER', 'OTHER'];

/** Normalises any tier spelling used by the engines to one bucket (mirrors the hub pill logic). */
export function normalizeTier(category?: string | null, market?: string | null, prediction?: string | null): TierKey {
  const c = String(category || '').toUpperCase().replace(/[\s-]+/g, '_');
  const m = String(market || '').toUpperCase().replace(/[\s-]+/g, '_');
  const pr = String(prediction || '').toUpperCase();
  if (c.includes('NO_SAFE_BANKER') || c.includes('NOSAFEBANKER') || m === 'NO_SAFE_BANKER' || pr === 'SKIP') return 'NO_SAFE_BANKER';
  if (c.includes('BANGER')) return 'BANGER';
  if (c.includes('TOP_PICK') || c.includes('TOPPICK')) return 'TOP_PICK';
  if (c.includes('HIGH')) return 'HIGH';
  if (c.includes('MID')) return 'MID';
  if (c.includes('LOW') || c.includes('RISKY')) return 'LOW';
  return 'OTHER';
}

/** Accepts an IANA time zone from the client; falls back to the site default. */
export function resolveTimeZone(tz?: string | null): string {
  const fallback = 'Africa/Lagos';
  if (!tz || tz.length > 64) return fallback;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return fallback;
  }
}

/** YYYY-MM-DD of an instant in the given time zone (same convention as the web app's date tabs). */
export function localDateIn(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export interface LockedTierCounts {
  time_zone: string;
  /** Per local date: tier totals for the items whose tier was hidden. Missing date = withheld. */
  by_date: Record<string, Record<TierKey, number>>;
  /** Dates that had locked items but too few to publish tier totals. */
  withheld_dates: string[];
  /** Totals across today and later (the "All Dates" tab); null when withheld. */
  upcoming: Record<TierKey, number> | null;
}

function emptyTierRecord(): Record<TierKey, number> {
  const r = {} as Record<TierKey, number>;
  for (const k of TIER_KEYS) r[k] = 0;
  return r;
}

/**
 * Per-day tier totals for locked items. A bucket is published only when it holds at least
 * `minBucket` items; otherwise one match's tier could be read straight off the total.
 */
export function buildLockedTierCounts(
  items: { tier: TierKey; kickoff: string | null | undefined }[],
  tz: string,
  minBucket = 3,
  now: Date = new Date()
): LockedTierCounts {
  const today = localDateIn(now.toISOString(), tz) as string;
  const perDay: Record<string, Record<TierKey, number>> = {};
  const perDaySize: Record<string, number> = {};
  const upcoming = emptyTierRecord();
  let upcomingSize = 0;
  for (const it of items) {
    const d = localDateIn(it.kickoff, tz);
    if (!d) continue;
    if (!perDay[d]) { perDay[d] = emptyTierRecord(); perDaySize[d] = 0; }
    perDay[d][it.tier] += 1;
    perDaySize[d] += 1;
    if (d >= today) { upcoming[it.tier] += 1; upcomingSize += 1; }
  }
  const by_date: Record<string, Record<TierKey, number>> = {};
  const withheld_dates: string[] = [];
  for (const d of Object.keys(perDay).sort()) {
    if (perDaySize[d] >= minBucket) by_date[d] = perDay[d];
    else withheld_dates.push(d);
  }
  return { time_zone: tz, by_date, withheld_dates, upcoming: upcomingSize >= minBucket ? upcoming : null };
}

/** A nested fixture's own metadata (ingestion notes, model inputs) never goes to a locked user. */
export function withoutFixtureMetadata(fixture: any): any {
  if (!fixture || typeof fixture !== 'object') return fixture;
  const { metadata: _m, ...rest } = fixture;
  return rest;
}

/** Locked lists are ordered by kickoff, never by confidence, so position gives nothing away. */
export function byKickoffThenId(a: any, b: any): number {
  const ta = new Date(a?.target_kickoff_at || a?.fixture?.target_kickoff_at || 0).getTime() || 0;
  const tb = new Date(b?.target_kickoff_at || b?.fixture?.target_kickoff_at || 0).getTime() || 0;
  if (ta !== tb) return ta - tb;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}
