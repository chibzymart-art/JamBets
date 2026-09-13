import { checkRateLimit, getClientIp } from './rate-limiter';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';

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
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate Limiting (SEC-04): 60 requests per minute per IP
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`goals-feed:${clientIp}`, 60, 60);
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
    'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
    'CDN-Cache-Control': 'public, s-maxage=30',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=30',
    'Access-Control-Allow-Origin': '*',
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  try {
    const now = Date.now();

    // 1. Return fresh in-memory cache if available (for unauthenticated requests)
    if (!userAuthToken && memoryCache && now < memoryCache.expiresAt) {
      return new Response(
        JSON.stringify({ success: true, ...memoryCache.data }),
        { status: 200, headers: responseHeaders }
      );
    }

    // 2. Anti-stampede fetch: deduplicate concurrent in-flight requests
    let feedData: GoalsFeedData;
    if (!userAuthToken) {
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
    if (memoryCache) {
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
