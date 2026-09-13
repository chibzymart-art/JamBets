import { checkRateLimit, getClientIp } from './rate-limiter';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';

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
let memoryCache: MemoryCacheEntry | null = null;
let inflightPromise: Promise<FeedData> | null = null;
const CACHE_TTL_MS = 45 * 1000; // 45 seconds instance memory cache

async function fetchFromUpstream(headers: Record<string, string>): Promise<FeedData> {
  const selectQuery = encodeURIComponent(
    `id,fixture_id,prediction,market,probability,confidence_category,secondary_predictions,metadata,settlement_status,settlement_notes,settled_at,actual_score,publication_status,simulations_count,target_kickoff_at,tier_required,is_locked,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,queue_day,in_prediction_queue,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,metadata,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name))`
  );

  const [predRes, leagueRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/football_predictions_paywall?select=${selectQuery}&publication_status=eq.published&order=target_kickoff_at.asc&limit=2000`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/football_leagues?select=id,name,code,country&order=name.asc`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    ),
  ]);

  if (!predRes.ok || !leagueRes.ok) {
    throw new Error(`Supabase upstream status: pred=${predRes.status}, league=${leagueRes.status}`);
  }

  const [predictions, leagues] = await Promise.all([
    predRes.json(),
    leagueRes.json(),
  ]);

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
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: userAuthToken || `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };

  const responseHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
    'CDN-Cache-Control': 'public, s-maxage=60',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=60',
    'Access-Control-Allow-Origin': '*',
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  try {
    const now = Date.now();

    // 1. Return fresh in-memory cache if available (for unauthenticated public feed)
    if (!userAuthToken && memoryCache && now < memoryCache.expiresAt) {
      return new Response(
        JSON.stringify({ success: true, ...memoryCache.data }),
        { status: 200, headers: responseHeaders }
      );
    }

    // 2. Anti-stampede fetch: deduplicate concurrent in-flight requests
    let feedData: FeedData;
    if (!userAuthToken) {
      if (!inflightPromise) {
        inflightPromise = fetchFromUpstream(headers)
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
      feedData = await fetchFromUpstream(headers);
    }

    return new Response(
      JSON.stringify({ success: true, ...feedData }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err: any) {
    // Fallback: If upstream errors but we have stale in-memory cache, return stale cache
    if (memoryCache) {
      return new Response(
        JSON.stringify({ success: true, ...memoryCache.data, stale: true }),
        { status: 200, headers: responseHeaders }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Edge proxy error' }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
