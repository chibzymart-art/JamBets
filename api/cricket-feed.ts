// Cricket feed: fixtures (public) + predictions (BigBang VIP + admin only).
// Reads cricket_fixtures / cricket_predictions with the service role and
// redacts predictions for everyone else, the same rule as the tennis and
// basketball feeds. Additive: no other feed or table is touched.
import { checkAdaptiveRateLimit } from './rate-limiter';
import { verifyEdgeAccess, hasMultiSportAccess } from './_lib/jwt-verifier';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface DayData {
  fixtures: any[];
  predictions: any[];
  cached_at: string;
}

interface IndexData {
  fixtures: { id: string; start_time: string; status: string }[];
  predictions: { fixture_id: string; stage: string; settlement_status: string }[];
}

const FIVE_MIN = 300_000;
const LIVE_TTL = 30_000;
const MAX_DAY_ENTRIES = 40;
const LOCK_MS = 48 * 3600 * 1000;

let indexCache: { data: IndexData; expiresAt: number } | null = null;
let indexInflight: Promise<IndexData> | null = null;
const dayCache = new Map<string, { data: DayData; expiresAt: number }>();
const dayInflight = new Map<string, Promise<DayData>>();

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('Origin') || '';
  const allowed = [
    'https://www.oddsbanta.com',
    'https://oddsbanta.com',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  return allowed.includes(origin) ? origin : 'https://www.oddsbanta.com';
}

function serviceHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: 'application/json',
  };
}

// ------------------------------------------------------------ time zones
function validTimeZone(tz: string | null): string {
  if (!tz || tz.length > 64) return 'Africa/Lagos';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'Africa/Lagos';
  }
}

function tzOffsetMs(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** UTC instant of local midnight starting `iso` (YYYY-MM-DD) in `tz`. */
function localMidnightUtc(iso: string, tz: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess, tz);
  t = guess - tzOffsetMs(t, tz); // second pass handles DST changes
  return t;
}

function localDateOf(ms: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------ upstream
async function fetchAll(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 0; page < 20; page++) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${page * 1000}`, { headers: serviceHeaders() });
    if (!res.ok) throw new Error(`cricket upstream ${res.status}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

async function fetchDay(fromIso: string, toIso: string): Promise<DayData> {
  const range = `start_time=gte.${encodeURIComponent(fromIso)}&start_time=lt.${encodeURIComponent(toIso)}`;
  const [fixtures, predictions] = await Promise.all([
    fetchAll(`cricket_fixtures?select=*&${range}&order=start_time.asc,id.asc`),
    fetchAll(`cricket_predictions?select=*&${range}&order=start_time.asc,id.asc`),
  ]);
  return { fixtures, predictions, cached_at: new Date().toISOString() };
}

async function fetchIndex(): Promise<IndexData> {
  const since = new Date(Date.now() - 400 * 86400 * 1000).toISOString();
  const [fixtures, predictions] = await Promise.all([
    fetchAll(`cricket_fixtures?select=id,start_time,status&start_time=gte.${encodeURIComponent(since)}&order=start_time.asc,id.asc`),
    fetchAll(`cricket_predictions?select=fixture_id,stage,settlement_status&start_time=gte.${encodeURIComponent(since)}&order=id.asc`),
  ]);
  return { fixtures, predictions };
}

async function getIndex(): Promise<IndexData> {
  if (indexCache && indexCache.expiresAt > Date.now()) return indexCache.data;
  if (!indexInflight) {
    indexInflight = fetchIndex()
      .then((data) => {
        const live = data.fixtures.some((f) => f.status === 'live');
        indexCache = { data, expiresAt: Date.now() + (live ? LIVE_TTL : FIVE_MIN) };
        return data;
      })
      .finally(() => {
        indexInflight = null;
      });
  }
  return indexInflight;
}

async function getDay(fromIso: string, toIso: string): Promise<DayData> {
  const key = `${fromIso}|${toIso}`;
  const hit = dayCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.data;
  let p = dayInflight.get(key);
  if (!p) {
    p = fetchDay(fromIso, toIso)
      .then((data) => {
        const live = data.fixtures.some((f) => f.status === 'live');
        if (dayCache.size >= MAX_DAY_ENTRIES) dayCache.delete(dayCache.keys().next().value as string);
        dayCache.set(key, { data, expiresAt: Date.now() + (live ? LIVE_TTL : FIVE_MIN) });
        return data;
      })
      .finally(() => {
        dayInflight.delete(key);
      });
    dayInflight.set(key, p);
  }
  return p;
}

// ------------------------------------------------------------ pick of record
// The pick of record is the first stage published: 'provisional' (it may be refreshed
// until 48h before the start, then the database locks it), or 'toss' when the match
// was first seen after the toss. A later toss-time prediction is shown as an update
// beside it and never replaces the pick or its result.
const STAGE_ORDER: Record<string, number> = { provisional: 0, toss: 1 };

function byFixture<T extends { fixture_id: string; stage: string }>(rows: T[]): Map<string, { pick: T; update: T | null }> {
  const map = new Map<string, { pick: T; update: T | null }>();
  const sorted = [...rows].sort((a, b) => (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9));
  for (const r of sorted) {
    const cur = map.get(r.fixture_id);
    if (!cur) map.set(r.fixture_id, { pick: r, update: null });
    else if (!cur.update) cur.update = r;
  }
  return map;
}

function tally(rows: { settlement_status: string }[]) {
  const won = rows.filter((r) => r.settlement_status === 'won').length;
  const lost = rows.filter((r) => r.settlement_status === 'lost').length;
  const voided = rows.filter((r) => r.settlement_status === 'void').length;
  return { settled: won + lost, won, lost, void: voided };
}

function publicPrediction(p: any, entitled: boolean) {
  if (!entitled) return { locked: true, settlement_status: p.settlement_status };
  return {
    stage: p.stage,
    home_win_prob: Number(p.home_win_prob),
    away_win_prob: Number(p.away_win_prob),
    predicted_winner: p.predicted_winner,
    probability: Number(p.probability),
    tier: p.tier,
    bat_first: p.bat_first,
    first_innings_median: p.first_innings_median === null ? null : Number(p.first_innings_median),
    settlement_status: p.settlement_status,
    created_at: p.created_at,
  };
}

export default async function handler(req: Request): Promise<Response> {
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': getCorsOrigin(req),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
    Vary: 'Authorization, Origin',
  };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });
  }
  const rateLimit = checkAdaptiveRateLimit(req, 'cricket-feed');
  if (!rateLimit.allowed) {
    return new Response(JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }), {
      status: 429,
      headers: { ...corsHeaders, 'Retry-After': String(rateLimit.resetSec) },
    });
  }

  const authHeader = req.headers.get('Authorization');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim() || null;
  const entitled = hasMultiSportAccess(await verifyEdgeAccess(rawToken));

  const url = new URL(req.url);
  const tz = validTimeZone(url.searchParams.get('tz'));
  const todayLocal = localDateOf(Date.now(), tz);
  const rawDate = url.searchParams.get('date') || '';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && !Number.isNaN(Date.parse(rawDate)) ? rawDate : todayLocal;
  const fromIso = new Date(localMidnightUtc(date, tz)).toISOString();
  const toIso = new Date(localMidnightUtc(addDays(date, 1), tz)).toISOString();

  try {
    const [day, index] = await Promise.all([getDay(fromIso, toIso), getIndex()]);
    const picks = byFixture(day.predictions);
    const now = Date.now();
    const matches = day.fixtures.map((f) => {
      const entry = picks.get(f.id);
      const startMs = Date.parse(f.start_time);
      return {
        ...f,
        pick_locked: !entry || entry.pick.settlement_status !== 'pending' || startMs - now <= LOCK_MS,
        prediction: entry ? publicPrediction(entry.pick, entitled) : null,
        toss_update: entry?.update && entitled ? publicPrediction(entry.update, true) : null,
      };
    });

    // Dates with matches, in the visitor's time zone (for the date dropdown and chip counts).
    const counts = new Map<string, number>();
    for (const f of index.fixtures) {
      const iso = localDateOf(Date.parse(f.start_time), tz);
      counts.set(iso, (counts.get(iso) || 0) + 1);
    }
    const dates = [...counts.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([iso, count]) => ({ iso, count }));
    const overall = tally([...byFixture(index.predictions).values()].map((e) => e.pick));
    const dayStats = tally([...picks.values()].map((e) => e.pick));

    return new Response(
      JSON.stringify({
        success: true,
        is_subscriber: entitled,
        date,
        today: todayLocal,
        tz,
        matches,
        dates,
        stats: overall,
        day_stats: dayStats,
        cached_at: day.cached_at,
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: 'Cricket feed unavailable' }), {
      status: 502,
      headers: corsHeaders,
    });
  }
}
