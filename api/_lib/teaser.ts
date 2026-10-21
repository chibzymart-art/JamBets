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
 * Markets whose row set is itself the pick (one table per outcome, or a curated shortlist).
 * Locked users get counts for these, never the fixture list.
 */
export const MEMBERSHIP_REVEALING_MARKETS: readonly string[] = [
  'curated',
  'home_win',
  'away_win',
  'draw',
  'corners',
  'over_2.5_goals',
  'ht_over_0.5_goals',
];
