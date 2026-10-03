/**
 * Public track record aggregation (server side, edge runtime).
 *
 * Bandwidth design:
 *   - Narrow column selects on settled, non-pass rows only (~100 KB total per refresh).
 *   - One upstream refresh per edge instance per CACHE_TTL_MS, with in-flight de-duplication.
 *   - Callers add CDN caching on top (s-maxage + stale-while-revalidate), so Supabase sees
 *     at most a handful of refreshes per hour regardless of traffic.
 *
 * Only aggregates of SETTLED picks leave this module (no upcoming paid picks), which is why the
 * service key may be used here. Falls back to the anon key when the service key is absent.
 *
 * Score tiers mirror web/src/lib/confidenceScore.ts (score = probability × 10).
 */

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes per edge instance
const PAGE_SIZE = 1000;
const MAX_PAGES = 10; // hard ceiling: 10k rows per product

// ── Score tiers (keep in sync with web/src/lib/confidenceScore.ts) ──────────────
export type TierKey = 'tier9' | 'tier8' | 'tier6' | 'tierLow';
export const TIER_ORDER: TierKey[] = ['tier9', 'tier8', 'tier6', 'tierLow'];
export const TIER_LABELS: Record<TierKey, { range: string; name: string }> = {
  tier9: { range: '9+', name: 'Very High' },
  tier8: { range: '8–8.9', name: 'High' },
  tier6: { range: '6–7.9', name: 'Moderate' },
  tierLow: { range: 'Below 6', name: 'Low' },
};

export function probabilityToScore(probability: unknown): number | null {
  if (probability === null || probability === undefined) return null;
  let p = Number(probability);
  if (Number.isNaN(p)) return null;
  if (p > 1) p = p / 100;
  p = Math.min(1, Math.max(0, p));
  return Math.round(p * 100) / 10;
}

export function tierKeyForScore(score: number): TierKey {
  if (score >= 9) return 'tier9';
  if (score >= 8) return 'tier8';
  if (score >= 6) return 'tier6';
  return 'tierLow';
}

// ── Types ───────────────────────────────────────────────────────────────────────
export type ProductKey = 'football' | 'goals' | 'tennis' | 'basketball';

export interface TierStats {
  tier: TierKey;
  range: string;
  name: string;
  won: number;
  lost: number;
  void: number;
  settled: number; // won + lost
  hitRate: number | null; // 0–100, one decimal; null when nothing settled
}

export interface ProductStats {
  product: ProductKey;
  label: string;
  market: string;
  won: number;
  lost: number;
  void: number;
  settled: number;
  hitRate: number | null;
  since: string | null;
  until: string | null;
  tiers: TierStats[];
}

export interface RecentPick {
  kickoff: string;
  league: string | null;
  home: string | null;
  away: string | null;
  prediction: string;
  score: number | null;
  result: 'won' | 'lost';
  finalScore: string | null;
}

export interface TrackRecord {
  generatedAt: string;
  products: ProductStats[];
  recent: RecentPick[];
  note: string;
}

const PRODUCTS: Array<{ key: ProductKey; label: string; market: string; table: string; excludePass: boolean }> = [
  { key: 'football', label: 'Football', market: 'Main match pick', table: 'football_predictions', excludePass: true },
  { key: 'goals', label: 'Football goals', market: 'Over 2.5 / first-half goals', table: 'goals_predictions', excludePass: false },
  { key: 'tennis', label: 'Tennis', market: 'Match winner (primary pick only)', table: 'tennis_predictions', excludePass: true },
  { key: 'basketball', label: 'Basketball', market: 'Main pick', table: 'basketball_predictions', excludePass: true },
];

// ── Upstream helpers ────────────────────────────────────────────────────────────
function authHeaders(): Record<string, string> {
  const key = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

async function fetchAllRows<T>(pathAndQuery: string): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
      headers: { ...authHeaders(), 'Range-Unit': 'items', Range: `${from}-${from + PAGE_SIZE - 1}` },
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`Upstream ${res.status} for ${pathAndQuery.split('?')[0]}`);
    }
    const batch = (await res.json()) as T[];
    if (!Array.isArray(batch)) break;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

interface SettledRow {
  probability: number | null;
  settlement_status: 'won' | 'lost' | 'void';
  target_kickoff_at: string | null;
}

function emptyTiers(): Record<TierKey, TierStats> {
  const out = {} as Record<TierKey, TierStats>;
  for (const t of TIER_ORDER) {
    out[t] = { tier: t, ...TIER_LABELS[t], won: 0, lost: 0, void: 0, settled: 0, hitRate: null };
  }
  return out;
}

function rate(won: number, lost: number): number | null {
  const n = won + lost;
  return n > 0 ? Math.round((won / n) * 1000) / 10 : null;
}

async function loadProduct(p: (typeof PRODUCTS)[number]): Promise<ProductStats> {
  const filters = [
    'select=probability,settlement_status,target_kickoff_at',
    'settlement_status=in.(won,lost,void)',
    p.excludePass ? 'confidence_category=neq.NO_SAFE_BANKER' : '',
    'order=target_kickoff_at.asc',
  ]
    .filter(Boolean)
    .join('&');

  const rows = await fetchAllRows<SettledRow>(`${p.table}?${filters}`);
  const tiers = emptyTiers();
  let since: string | null = null;
  let until: string | null = null;
  let won = 0;
  let lost = 0;
  let voided = 0;

  for (const r of rows) {
    const score = probabilityToScore(r.probability);
    if (score === null) continue;
    const t = tiers[tierKeyForScore(score)];
    if (r.settlement_status === 'won') {
      t.won++;
      won++;
    } else if (r.settlement_status === 'lost') {
      t.lost++;
      lost++;
    } else {
      t.void++;
      voided++;
    }
    if (r.target_kickoff_at) {
      if (!since || r.target_kickoff_at < since) since = r.target_kickoff_at;
      if (!until || r.target_kickoff_at > until) until = r.target_kickoff_at;
    }
  }

  for (const t of TIER_ORDER) {
    tiers[t].settled = tiers[t].won + tiers[t].lost;
    tiers[t].hitRate = rate(tiers[t].won, tiers[t].lost);
  }

  return {
    product: p.key,
    label: p.label,
    market: p.market,
    won,
    lost,
    void: voided,
    settled: won + lost,
    hitRate: rate(won, lost),
    since,
    until,
    tiers: TIER_ORDER.map((t) => tiers[t]),
  };
}

/** "newells-old-boys" → "Newells Old Boys". Names are stored as slugs in the fixtures tables. */
export function prettyName(slug: unknown): string | null {
  if (!slug) return null;
  const s = String(slug).trim();
  if (!s) return null;
  if (/[A-Z ]/.test(s)) return s; // already a display name
  return s
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && /^(fc|ac|sc|cf|afc|psv|rb|cd|ud|sd|us|as|fk|sk|bk|if|aik)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

const OUTCOME_LABELS: Record<string, string> = {
  home: 'Home win',
  away: 'Away win',
  draw: 'Draw',
  '1x': 'Home or draw (1X)',
  x2: 'Draw or away (X2)',
  '12': 'Home or away (12)',
  yes: 'Both teams to score: yes',
  no: 'Both teams to score: no',
};

export function formatPick(market: unknown, prediction: unknown): string {
  const pred = String(prediction ?? '').toLowerCase();
  const mkt = String(market ?? '').toLowerCase();
  const line = mkt.match(/(\d+\.\d)/)?.[1];
  if ((pred === 'over' || pred === 'under') && line) {
    const scope = mkt.startsWith('ht_') ? 'first-half goals' : mkt.startsWith('corners') ? 'corners' : 'goals';
    return `${pred === 'over' ? 'Over' : 'Under'} ${line} ${scope}`;
  }
  return OUTCOME_LABELS[pred] || (pred ? pred[0].toUpperCase() + pred.slice(1) : '—');
}

const RECENT_SELECT =
  'market,prediction,probability,settlement_status,actual_score,target_kickoff_at,' +
  'fixture:football_fixtures(home_team:football_teams!football_fixtures_home_team_id_fkey(name),' +
  'away_team:football_teams!football_fixtures_away_team_id_fkey(name),league:football_leagues(name))';

async function loadRecent(): Promise<RecentPick[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/football_predictions?select=${RECENT_SELECT}` +
      '&settlement_status=in.(won,lost)&confidence_category=neq.NO_SAFE_BANKER' +
      '&order=target_kickoff_at.desc&limit=12',
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    kickoff: r.target_kickoff_at,
    league: r.fixture?.league?.name ?? null,
    home: prettyName(r.fixture?.home_team?.name),
    away: prettyName(r.fixture?.away_team?.name),
    prediction: formatPick(r.market, r.prediction),
    score: probabilityToScore(r.probability),
    result: r.settlement_status === 'won' ? 'won' : 'lost',
    finalScore: r.actual_score ?? null,
  }));
}

async function buildTrackRecord(): Promise<TrackRecord> {
  const [products, recent] = await Promise.all([
    Promise.all(
      PRODUCTS.map((p) =>
        loadProduct(p).catch(
          (): ProductStats => ({
            product: p.key,
            label: p.label,
            market: p.market,
            won: 0,
            lost: 0,
            void: 0,
            settled: 0,
            hitRate: null,
            since: null,
            until: null,
            tiers: TIER_ORDER.map((t) => emptyTiers()[t]),
          })
        )
      )
    ),
    loadRecent().catch(() => [] as RecentPick[]),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    products,
    recent,
    note:
      'Live forward results only: every pick was published before kickoff and settled after the final whistle. ' +
      'Not a backtest. Hit rate excludes void and no-pick matches.',
  };
}

// ── Cache ───────────────────────────────────────────────────────────────────────
let cache: { data: TrackRecord; expiresAt: number } | null = null;
let inflight: Promise<TrackRecord> | null = null;

export async function getTrackRecord(): Promise<TrackRecord> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) return cache.data;
  if (!inflight) {
    inflight = buildTrackRecord()
      .then((data) => {
        cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (err) {
    if (cache) return cache.data; // serve stale on upstream failure
    throw err;
  }
}

// ── Upcoming fixture names (no picks, no probabilities) for public SSR pages ─────
export interface UpcomingFixture {
  kickoff: string;
  league: string | null;
  home: string | null;
  away: string | null;
}

let upcomingCache: { data: UpcomingFixture[]; expiresAt: number } | null = null;
let upcomingInflight: Promise<UpcomingFixture[]> | null = null;
const UPCOMING_TTL_MS = 15 * 60 * 1000;

async function loadUpcoming(): Promise<UpcomingFixture[]> {
  const from = new Date();
  const to = new Date(from.getTime() + 36 * 3600 * 1000);
  const select =
    'target_kickoff_at,home_team:football_teams!football_fixtures_home_team_id_fkey(name),' +
    'away_team:football_teams!football_fixtures_away_team_id_fkey(name),league:football_leagues(name)';
  const key = SUPABASE_ANON_KEY; // public fixture names only
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/football_fixtures?select=${select}` +
      `&target_kickoff_at=gte.${from.toISOString()}&target_kickoff_at=lt.${to.toISOString()}` +
      '&order=target_kickoff_at.asc&limit=30',
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    kickoff: r.target_kickoff_at,
    league: r.league?.name ?? null,
    home: prettyName(r.home_team?.name),
    away: prettyName(r.away_team?.name),
  }));
}

export async function getUpcomingFixtures(): Promise<UpcomingFixture[]> {
  const now = Date.now();
  if (upcomingCache && now < upcomingCache.expiresAt) return upcomingCache.data;
  if (!upcomingInflight) {
    upcomingInflight = loadUpcoming()
      .then((data) => {
        upcomingCache = { data, expiresAt: Date.now() + UPCOMING_TTL_MS };
        return data;
      })
      .finally(() => {
        upcomingInflight = null;
      });
  }
  try {
    return await upcomingInflight;
  } catch {
    return upcomingCache?.data ?? [];
  }
}
