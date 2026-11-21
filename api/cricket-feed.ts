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

interface CricketFeedData {
  fixtures: any[];
  predictions: any[];
  cached_at: string;
}

let cache: { data: CricketFeedData; expiresAt: number } | null = null;
let inflight: Promise<CricketFeedData> | null = null;

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

async function fetchUpstream(): Promise<CricketFeedData> {
  const from = new Date(Date.now() - 2 * 86400 * 1000).toISOString();
  const to = new Date(Date.now() + 4 * 86400 * 1000).toISOString();
  const range = `start_time=gte.${encodeURIComponent(from)}&start_time=lte.${encodeURIComponent(to)}`;
  const [fxRes, prRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/cricket_fixtures?select=*&${range}&order=start_time.asc`, { headers: serviceHeaders() }),
    fetch(`${SUPABASE_URL}/rest/v1/cricket_predictions?select=*&${range}&order=start_time.asc`, { headers: serviceHeaders() }),
  ]);
  if (!fxRes.ok || !prRes.ok) {
    throw new Error(`cricket upstream ${fxRes.status}/${prRes.status}`);
  }
  return {
    fixtures: await fxRes.json(),
    predictions: await prRes.json(),
    cached_at: new Date().toISOString(),
  };
}

async function getData(): Promise<CricketFeedData> {
  if (cache && cache.expiresAt > Date.now()) return cache.data;
  if (!inflight) {
    inflight = fetchUpstream()
      .then((data) => {
        const live = data.fixtures.some((f) => f.status === 'live');
        cache = { data, expiresAt: Date.now() + (live ? 30_000 : 300_000) };
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// Latest stage wins: a toss-time prediction replaces the provisional one on the card;
// both stay stored (and locked) in the database.
function latestByFixture(predictions: any[]): Map<string, any> {
  const order: Record<string, number> = { provisional: 0, toss: 1 };
  const map = new Map<string, any>();
  for (const p of predictions) {
    const cur = map.get(p.fixture_id);
    if (!cur || (order[p.stage] ?? 0) > (order[cur.stage] ?? 0)) map.set(p.fixture_id, p);
  }
  return map;
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

  try {
    const data = await getData();
    const latest = latestByFixture(data.predictions);
    const matches = data.fixtures.map((f) => {
      const p = latest.get(f.id);
      const settled = p && p.settlement_status !== 'pending';
      const prediction = !p
        ? null
        : entitled
          ? {
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
            }
          : { locked: true, settlement_status: settled ? p.settlement_status : 'pending' };
      return { ...f, prediction };
    });
    const settledRows = [...latest.values()].filter((p) => p.settlement_status === 'won' || p.settlement_status === 'lost');
    const won = settledRows.filter((p) => p.settlement_status === 'won').length;
    return new Response(
      JSON.stringify({
        success: true,
        is_subscriber: entitled,
        matches,
        stats: { settled: settledRows.length, won, lost: settledRows.length - won },
        cached_at: data.cached_at,
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
