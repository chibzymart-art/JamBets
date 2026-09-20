import { checkRateLimit, getClientIp } from './rate-limiter';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODg1Mzg3MiwiZXhwIjoyMTA0NDI5ODcyfQ.GN9S6B0YUsq3oz5ouMgI27i0Vu0SRAdEO0aaPLewfQk';

const ADMIN_EMAILS = new Set([
  'chibzymart@gmail.com',
  'whizzchibz@gmail.com',
  'chibuezec.amuchie@gmail.com',
  'chibuezeamuchie@gmail.com',
  'nnamdiamuchie@gmail.com',
]);

interface FeedData {
  predictions: any[];
  leagues: any[];
  cached_at: string;
}

interface MemoryCacheEntry {
  data: FeedData;
  expiresAt: number;
}

// In-memory cache & promise deduplication to prevent cache stampedes
const memoryCache = new Map<string, MemoryCacheEntry>();
const inflightPromises = new Map<string, Promise<FeedData>>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds edge memory cache

// Fast JWT payload decoder
function parseJwtPayload(token: string): any {
  try {
    const raw = token.startsWith('Bearer ') ? token.slice(7) : token;
    const parts = raw.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

// Memory cache for user auth checks (120 seconds)
const userAuthCache = new Map<string, { isPaid: boolean; expiresAt: number }>();

async function checkIsPaidOrAdmin(authToken: string | null): Promise<boolean> {
  if (!authToken) return false;
  const payload = parseJwtPayload(authToken);
  if (!payload) return false;

  // 1. Service role or app_metadata admin
  if (payload.role === 'service_role' || payload.app_metadata?.role === 'admin') {
    return true;
  }

  // 2. Email whitelist
  const email = (payload.email || '').toLowerCase().trim();
  if (email && ADMIN_EMAILS.has(email)) {
    return true;
  }

  // 3. User database subscription / entitlement lookup
  const userId = payload.sub || payload.id;
  if (!userId) return false;

  const cached = userAuthCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.isPaid;
  }

  try {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`,
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

    userAuthCache.set(userId, { isPaid, expiresAt: Date.now() + 120 * 1000 });
    return isPaid;
  } catch {
    return false;
  }
}

// Strict Paywall Redaction:
// 1. Non-paid users are locked from seeing any pending predictions (0 free picks)
// 2. Non-paid users only see WON predictions for the day (unlocked as proof)
// 3. Non-paid users NEVER see lost or void predictions (completely hidden)
function applyPaywallRedaction(predictions: any[]): any[] {
  return predictions
    .filter((p: any) => {
      const status = p.settlement_status;
      // Rule: Hide all lost and void predictions completely
      if (status === 'lost' || status === 'void' || status === 'voided') {
        return false;
      }
      return true;
    })
    .map((p: any) => {
      // Rule: Won predictions are visible as proof
      if (p.settlement_status === 'won') {
        return {
          ...p,
          is_locked: false,
        };
      }

      // Rule: 100% of upcoming/pending predictions are strictly locked
      return {
        ...p,
        is_locked: true,
        probability: null,
        confidence_category: 'LOCKED',
        prediction: 'LOCKED',
        secondary_predictions: [], // Strip data to prevent leakage
        metadata: {},              // Strip simulation details to prevent leakage
      };
    });
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

async function fetchFromUpstream(): Promise<FeedData> {
  const selectQuery = encodeURIComponent(
    `id,fixture_id,prediction,market,probability,confidence_category,secondary_predictions,metadata,settlement_status,settlement_notes,settled_at,actual_score,publication_status,simulations_count,target_kickoff_at,tier_required,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,queue_day,in_prediction_queue,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,metadata,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name))`
  );

  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

  const [predRes, leagueRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/football_predictions?select=${selectQuery}&publication_status=eq.published&order=target_kickoff_at.asc,id.asc&limit=2000`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/football_leagues?select=id,name,code,country&order=name.asc`,
      { headers: { apikey: authKey, Authorization: `Bearer ${authKey}` } }
    ),
  ]);

  if (!predRes.ok || !leagueRes.ok) {
    throw new Error(`Supabase upstream status: pred=${predRes.status}, league=${leagueRes.status}`);
  }

  const [rawPredictions, leagues] = await Promise.all([
    predRes.json(),
    leagueRes.json(),
  ]);

  const predictions = (Array.isArray(rawPredictions) ? rawPredictions : []).map((p: any) => ({
    ...p,
    is_locked: false,
  }));

  return {
    predictions,
    leagues,
    cached_at: new Date().toISOString(),
  };
}

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate Limiting (SEC-04): 60 requests per minute per IP
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`pred-feed:${clientIp}`, 60, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.resetSec),
          'X-RateLimit-Limit': '60',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimit.resetSec),
        },
      }
    );
  }

  const userAuthToken = req.headers.get('Authorization');
  const isVipOrAdmin = await checkIsPaidOrAdmin(userAuthToken);

  const upstreamHeaders = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: userAuthToken || `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };

  const corsOrigin = getCorsOrigin(req);
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': isVipOrAdmin
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, s-maxage=60, stale-while-revalidate=120',
    'CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=60',
    'Vercel-CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=60',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  const cacheKey = `feed:public`;

  try {
    const now = Date.now();

    // 1. For unauthenticated / non-paid users, return cached Edge data if fresh
    if (!isVipOrAdmin) {
      const cached = memoryCache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        const paywalledData = {
          ...cached.data,
          predictions: applyPaywallRedaction(cached.data.predictions),
        };
        return new Response(
          JSON.stringify({ success: true, ...paywalledData }),
          { status: 200, headers: responseHeaders }
        );
      }
    }

    // 2. Fetch with promise deduplication to avoid thundering herd
    let fetchPromise = inflightPromises.get('upstream');
    if (!fetchPromise) {
      fetchPromise = fetchFromUpstream()
        .then((data) => {
          memoryCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
          inflightPromises.delete('upstream');
          return data;
        })
        .catch((err) => {
          inflightPromises.delete('upstream');
          throw err;
        });
      inflightPromises.set('upstream', fetchPromise);
    }

    const rawFeed = await fetchPromise;

    const payload = !isVipOrAdmin
      ? { ...rawFeed, predictions: applyPaywallRedaction(rawFeed.predictions) }
      : rawFeed;

    return new Response(
      JSON.stringify({ success: true, ...payload }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err: any) {
    // Fallback: If upstream errors but we have stale cache, serve stale cache
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      const paywalledData = !isVipOrAdmin
        ? { ...cached.data, predictions: applyPaywallRedaction(cached.data.predictions) }
        : cached.data;
      return new Response(
        JSON.stringify({ success: true, ...paywalledData, stale: true }),
        { status: 200, headers: responseHeaders }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Edge proxy error' }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      }
    );
  }
}
