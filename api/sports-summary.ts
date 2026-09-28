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

interface SportsSummaryData {
  basketball: {
    fixtureCount: number;
    leagueCount: number;
  };
  tennis: {
    fixtureCount: number;
    tournamentCount: number;
  };
  cached_at: string;
}

interface MemoryCacheEntry {
  data: SportsSummaryData;
  expiresAt: number;
}

let memoryCache: MemoryCacheEntry | null = null;
let inflightPromise: Promise<SportsSummaryData> | null = null;
const CACHE_TTL_MS = 300 * 1000; // 5 minutes Edge cache

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

async function fetchSummaryFromUpstream(): Promise<SportsSummaryData> {
  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Prefer: 'count=exact',
    Range: '0-0',
  };

  const [tfRes, ttRes, bfRes, blRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/tennis_fixtures?select=id&status=in.(scheduled,live)`, {
      headers,
      method: 'HEAD',
    }),
    fetch(`${SUPABASE_URL}/rest/v1/tennis_tournaments?select=id`, {
      headers,
      method: 'HEAD',
    }),
    fetch(`${SUPABASE_URL}/rest/v1/basketball_fixtures?select=id&status=in.(scheduled,live)`, {
      headers,
      method: 'HEAD',
    }),
    fetch(`${SUPABASE_URL}/rest/v1/basketball_leagues?select=id&is_active=eq.true`, {
      headers,
      method: 'HEAD',
    }),
  ]);

  const parseCount = (res: Response, fallback: number) => {
    const cr = res.headers.get('content-range');
    if (cr && cr.includes('/')) {
      const total = parseInt(cr.split('/')[1], 10);
      if (!isNaN(total)) return total;
    }
    return fallback;
  };

  const tennisFixtureCount = parseCount(tfRes, 16);
  const tennisTournamentCount = parseCount(ttRes, 16);
  const basketballFixtureCount = parseCount(bfRes, 20);
  const basketballLeagueCount = parseCount(blRes, 9);

  return {
    basketball: {
      fixtureCount: basketballFixtureCount,
      leagueCount: basketballLeagueCount,
    },
    tennis: {
      fixtureCount: tennisFixtureCount,
      tournamentCount: tennisTournamentCount,
    },
    cached_at: new Date().toISOString(),
  };
}

export default async function handler(req: Request): Promise<Response> {
  const origin = getCorsOrigin(req);
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`sports-summary:${clientIp}`, 120, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(rateLimit.resetSec),
        },
      }
    );
  }

  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    'CDN-Cache-Control': 'public, s-maxage=300',
    'Vercel-CDN-Cache-Control': 'public, s-maxage=300',
    'Vary': 'Origin',
  };

  try {
    const now = Date.now();
    if (memoryCache && now < memoryCache.expiresAt) {
      return new Response(
        JSON.stringify({ success: true, ...memoryCache.data }),
        { status: 200, headers: responseHeaders }
      );
    }

    if (!inflightPromise) {
      inflightPromise = fetchSummaryFromUpstream()
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

    const data = await inflightPromise;
    return new Response(
      JSON.stringify({ success: true, ...data }),
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
        success: true,
        basketball: { fixtureCount: 20, leagueCount: 9 },
        tennis: { fixtureCount: 16, tournamentCount: 16 },
        fallback: true,
      }),
      { status: 200, headers: responseHeaders }
    );
  }
}
