import { checkRateLimit, getClientIp } from './rate-limiter';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ADMIN_EMAILS = new Set([
  'chibzymart@gmail.com',
  'whizzchibz@gmail.com',
  'chibuezec.amuchie@gmail.com',
  'chibuezeamuchie@gmail.com',
  'nnamdiamuchie@gmail.com',
]);

interface GoalsFeedData {
  predictions: any[];
  leagues: any[];
  cached_at: string;
}

interface MemoryCacheEntry {
  data: GoalsFeedData;
  expiresAt: number;
}

let memoryCache: MemoryCacheEntry | null = null;
let inflightPromise: Promise<GoalsFeedData> | null = null;
const CACHE_TTL_MS = 30 * 1000; // 30 seconds instance memory cache

// In-memory cache for user auth verification (120s for valid users, 30s for invalid)
const userAuthCache = new Map<string, { isPaid: boolean; expiresAt: number }>();

async function checkIsPaidOrAdmin(authToken: string | null): Promise<boolean> {
  if (!authToken) return false;
  const rawToken = authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken.trim();
  if (!rawToken) return false;

  if (SUPABASE_SERVICE_ROLE_KEY && rawToken === SUPABASE_SERVICE_ROLE_KEY) {
    return true;
  }

  const cached = userAuthCache.get(rawToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.isPaid;
  }

  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${rawToken}`,
      },
    });

    if (!authRes.ok) {
      userAuthCache.set(rawToken, { isPaid: false, expiresAt: Date.now() + 30 * 1000 });
      return false;
    }

    const authUser = await authRes.json();
    if (!authUser || !authUser.id) {
      userAuthCache.set(rawToken, { isPaid: false, expiresAt: Date.now() + 30 * 1000 });
      return false;
    }

    const email = (authUser.email || '').toLowerCase().trim();
    if (authUser.app_metadata?.role === 'admin' || (email && ADMIN_EMAILS.has(email))) {
      userAuthCache.set(rawToken, { isPaid: true, expiresAt: Date.now() + 120 * 1000 });
      return true;
    }

    const userId = authUser.id;
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${rawToken}`,
      Accept: 'application/json',
    };

    const [subRes, entRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&status=eq.active&select=tier&limit=1`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}&select=tier,valid_until,can_view_predictions&limit=1`, { headers }),
    ]);

    let isPaid = false;

    if (subRes.ok) {
      const subData = await subRes.json();
      if (Array.isArray(subData) && subData.length > 0) {
        const tier = (subData[0].tier || '').toLowerCase();
        if (['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier)) {
          isPaid = true;
        }
      }
    }

    if (!isPaid && entRes.ok) {
      const entData = await entRes.json();
      if (Array.isArray(entData) && entData.length > 0) {
        const ent = entData[0];
        const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : Infinity;
        if (validUntil > Date.now()) {
          const tier = (ent.tier || '').toLowerCase();
          if (ent.can_view_predictions === true || ['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier)) {
            isPaid = true;
          }
        }
      }
    }

    userAuthCache.set(rawToken, { isPaid, expiresAt: Date.now() + 120 * 1000 });
    return isPaid;
  } catch (err) {
    console.error('Cryptographic auth check failed in goals feed:', err);
    return false;
  }
}

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

async function fetchGoalsFromUpstream(headers: Record<string, string>): Promise<GoalsFeedData> {
  const selectQuery = encodeURIComponent(
    `id,fixture_id,market,predicted_outcome,probability,confidence_tier,xg_combined,home_over25_rate,away_over25_rate,h2h_over25_rate,ht_goal_frequency,avg_first_goal_minute,target_kickoff_at,settlement_status,settled_at,actual_score,ht_score,settlement_notes,metadata,is_locked,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,queue_day,in_prediction_queue,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,metadata,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name))`
  );

  const [goalsRes, leagueRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/goals_predictions_paywall?select=${selectQuery}&order=probability.desc&limit=1000`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/football_leagues?select=id,name,code,country&order=name.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    ),
  ]);

  if (!goalsRes.ok || !leagueRes.ok) {
    throw new Error(`Supabase upstream status: goals=${goalsRes.status}, league=${leagueRes.status}`);
  }

  const [goalsPredictions, leagues] = await Promise.all([
    goalsRes.json(),
    leagueRes.json(),
  ]);

  return {
    predictions: goalsPredictions,
    leagues,
    cached_at: new Date().toISOString(),
  };
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    const corsOrigin = getCorsOrigin(req);
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate Limiting (SEC-04): 120 requests per minute per IP (tuned for African mobile CGNAT e.g. MTN, Airtel, Glo)
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`goals-feed:${clientIp}`, 120, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.resetSec),
          'X-RateLimit-Limit': '120',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimit.resetSec),
        },
      }
    );
  }

  const userAuthToken = req.headers.get('Authorization');
  const isVipOrAdmin = await checkIsPaidOrAdmin(userAuthToken);

  const upstreamAuth = isVipOrAdmin && userAuthToken ? userAuthToken : `Bearer ${SUPABASE_ANON_KEY}`;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: upstreamAuth.startsWith('Bearer ') ? upstreamAuth : `Bearer ${upstreamAuth}`,
    Accept: 'application/json',
  };

  const corsOrigin = getCorsOrigin(req);
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': isVipOrAdmin
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, s-maxage=30, stale-while-revalidate=60',
    'CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=30',
    'Vercel-CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=30',
    'Vary': 'Authorization, Origin',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  try {
    const now = Date.now();

    // 1. Return fresh in-memory cache if available (STRICTLY for unauthenticated / non-paid requests)
    if (!isVipOrAdmin && memoryCache && now < memoryCache.expiresAt) {
      return new Response(
        JSON.stringify({ success: true, ...memoryCache.data }),
        { status: 200, headers: responseHeaders }
      );
    }

    // 2. Anti-stampede fetch: deduplicate concurrent in-flight requests for guest users
    let feedData: GoalsFeedData;
    if (!isVipOrAdmin) {
      if (!inflightPromise) {
        inflightPromise = fetchGoalsFromUpstream(headers)
          .then((data) => {
            memoryCache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
            inflightPromise = null;
            return data;
          })
          .catch((err) => {
            inflightPromise = null;
            throw err;
          });
      }
      feedData = await inflightPromise;
    } else {
      feedData = await fetchGoalsFromUpstream(headers);
    }

    return new Response(
      JSON.stringify({ success: true, ...feedData }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err: any) {
    if (!isVipOrAdmin && memoryCache) {
      return new Response(
        JSON.stringify({ success: true, ...memoryCache.data, stale: true }),
        { status: 200, headers: responseHeaders }
      );
    }

    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to fetch goals feed',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
