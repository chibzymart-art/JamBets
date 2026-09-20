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

// In-memory cache for user auth verification (120s for valid users, 30s for invalid)
const userAuthCache = new Map<string, { isPaid: boolean; expiresAt: number }>();

async function checkIsPaidOrAdmin(authToken: string | null): Promise<boolean> {
  if (!authToken) return false;
  const rawToken = authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken.trim();
  if (!rawToken) return false;

  // 1. Direct Service Role Key Match (internal/admin scripts)
  if (SUPABASE_SERVICE_ROLE_KEY && rawToken === SUPABASE_SERVICE_ROLE_KEY) {
    return true;
  }

  // 2. Check in-memory cache to eliminate duplicate Supabase Auth roundtrips
  const cached = userAuthCache.get(rawToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.isPaid;
  }

  try {
    // 3. Cryptographically verify token signature against Supabase Auth API
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${rawToken}`,
      },
    });

    if (!authRes.ok) {
      // Signature is invalid, token is forged or expired -> fail closed
      userAuthCache.set(rawToken, { isPaid: false, expiresAt: Date.now() + 30 * 1000 });
      return false;
    }

    const authUser = await authRes.json();
    if (!authUser || !authUser.id) {
      userAuthCache.set(rawToken, { isPaid: false, expiresAt: Date.now() + 30 * 1000 });
      return false;
    }

    // 4. Server-verified role or admin email whitelist
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

    // 5. Query active subscriptions & entitlements for this verified user
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
    console.error('Cryptographic auth verification error:', err);
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

    // 1. Return cached Edge data if fresh (shields Supabase from both guest & VIP queries!)
    const cached = memoryCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      const payload = !isVipOrAdmin
        ? { ...cached.data, predictions: applyPaywallRedaction(cached.data.predictions) }
        : cached.data;
      return new Response(
        JSON.stringify({ success: true, ...payload }),
        { status: 200, headers: responseHeaders }
      );
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
