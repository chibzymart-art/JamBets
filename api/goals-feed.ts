import { checkAdaptiveRateLimit, getClientIp } from './rate-limiter';
import { verifyEdgeAuth, AuthStatus } from './_lib/jwt-verifier';
import { EdgeSwrCache, EdgeCacheRegistry } from './_lib/edge-cache';
import { generateEtag, matchesEtag, create304Response } from './_lib/etag';


export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface GoalsFeedData {
  predictions: any[];
  leagues: any[];
  cached_at: string;
}

// Global SWR Edge Cache: 900s fresh (15 min default) + 3600s stale (1 hour)
const goalsSwrCache = new EdgeSwrCache<GoalsFeedData>(900 * 1000, 3600 * 1000);
EdgeCacheRegistry.register('goals', goalsSwrCache);

// Adaptive Dynamic TTL for Live Scores and Instant Settlement Invalidation (Sub-Phase 2.4)
function computeGoalsTtl(data: GoalsFeedData): number {
  const hasLive = (data.predictions || []).some((p: any) => {
    const st = (p.fixture?.status || '').toLowerCase();
    return st === 'live' || st === '1h' || st === '2h' || st === 'ht' || st === 'in_progress';
  });
  return hasLive ? 15 * 1000 : 900 * 1000;
}

export type { AuthStatus };

async function checkAuthStatus(authToken: string | null): Promise<AuthStatus> {
  return verifyEdgeAuth(authToken);
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

async function fetchGoalsFromUpstream(): Promise<GoalsFeedData> {
  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const upstreamHeaders = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

  // 1. Primary Path: Zero-Join Point Read from pre-computed cached_feeds table (Sub-Phase 2.3)
  try {
    const snapRes = await fetch(
      `${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:goals&select=payload,updated_at&limit=1`,
      { headers: upstreamHeaders }
    );
    if (snapRes.ok) {
      const snapRows = await snapRes.json();
      if (Array.isArray(snapRows) && snapRows.length > 0 && snapRows[0]?.payload) {
        const payload = snapRows[0].payload as GoalsFeedData;
        if (Array.isArray(payload.predictions) && Array.isArray(payload.leagues)) {
          return payload;
        }
      }
    }
  } catch (snapErr) {
    console.warn('[GOALS-FEED] Failed point-read from cached_feeds, falling back to relational query:', snapErr);
  }

  // 2. Fallback Path: Direct relational query on goals_predictions_paywall
  const selectQuery = encodeURIComponent(
    `id,fixture_id,market,predicted_outcome,probability,confidence_tier,xg_combined,home_over25_rate,away_over25_rate,h2h_over25_rate,ht_goal_frequency,avg_first_goal_minute,target_kickoff_at,settlement_status,settled_at,actual_score,ht_score,settlement_notes,metadata,is_locked,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,queue_day,in_prediction_queue,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,metadata,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name))`
  );

  const [goalsRes, leagueRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/goals_predictions_paywall?select=${selectQuery}&order=probability.desc&limit=1000`,
      { headers: upstreamHeaders }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/football_leagues?select=id,name,code,country&order=name.asc`,
      { headers: upstreamHeaders }
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

// Scraper Bot Detector: Checks User-Agent for curl, python-requests, scrapers, and headless crawlers
export function isScraperBot(req: Request): boolean {
  const ua = (req.headers.get('user-agent') || '').toLowerCase().trim();
  if (!ua || ua.length < 5) return true;

  const botPatterns = [
    'python-requests',
    'python-urllib',
    'requests',
    'aiohttp',
    'httpx',
    'curl',
    'wget',
    'scrapy',
    'go-http-client',
    'node-fetch',
    'axios',
    'postmanruntime',
    'postman',
    'headless',
    'puppeteer',
    'playwright',
    'selenium',
    'phantomjs',
    'bot',
    'crawler',
    'spider',
    'slurp',
    'baiduspider',
    'yandex',
    'duckduckbot',
    'facebookexternalhit',
    'bytespider',
    'semrushbot',
    'ahrefsbot',
    'mj12bot',
    'dotbot',
    'petalbot',
  ];

  return botPatterns.some((pattern) => ua.includes(pattern));
}

export function applyGoalsScraperBlinding(preds: any[]): any[] {
  return preds
    .filter((p: any) => p.settlement_status === 'won')
    .map((p: any) => ({
      ...p,
      is_locked: false,
      metadata: { proof_of_work: 'verified_won_settlement' },
    }));
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

  // Rate Limiting (SEC-04): User-Centric CGNAT-Safe (180 req/min for auth users, 120 req/min for anon IPs)
  const clientIp = getClientIp(req);
  const rateLimit = checkAdaptiveRateLimit(req, 'goals-feed');
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.resetSec),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimit.resetSec),
        },
      }
    );
  }

  const userAuthToken = req.headers.get('Authorization');
  const rawToken = userAuthToken?.startsWith('Bearer ') ? userAuthToken.slice(7).trim() : userAuthToken?.trim() || null;
  const isInternalService = Boolean(SUPABASE_SERVICE_ROLE_KEY && rawToken === SUPABASE_SERVICE_ROLE_KEY);
  const isBot = !isInternalService && isScraperBot(req);

  const authStatus = isBot ? 'visitor' : await checkAuthStatus(userAuthToken);
  const isVipOrAdmin = authStatus === 'paid_or_trial';

  const corsOrigin = getCorsOrigin(req);
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': isVipOrAdmin
      ? 'private, max-age=60, stale-while-revalidate=300'
      : 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400',
    'CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
    'Vary': 'Authorization, Origin, User-Agent',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': String(rateLimit.limit),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  const url = new URL(req.url);
  const forceRefresh = (isInternalService || isVipOrAdmin) &&
    (url.searchParams.get('refresh') === 'true' || req.headers.get('x-force-refresh') === 'true');
  if (forceRefresh) {
    goalsSwrCache.invalidate('goals:raw');
  }

  try {
    const { data: feedData, isStale } = await goalsSwrCache.getOrFetch('goals:raw', fetchGoalsFromUpstream, computeGoalsTtl);

    // Every goals row is a published Over pick, so the list of fixtures is itself the prediction.
    // Locked users get counts only (same rule as market-feed membership markets).
    const isLockedAudience = !isBot && !isVipOrAdmin;
    const preds = isBot
      ? applyGoalsScraperBlinding(feedData.predictions)
      : isLockedAudience
      ? []
      : feedData.predictions;

    const lockedPreview = isLockedAudience
      ? (() => {
          const all = Array.isArray(feedData.predictions) ? feedData.predictions : [];
          const byMarket: Record<string, number> = {};
          for (const p of all) {
            const m = String(p?.market || 'goals');
            byMarket[m] = (byMarket[m] || 0) + 1;
          }
          return { count: all.length, by_market: byMarket };
        })()
      : undefined;

    const payload = {
      ...feedData,
      predictions: preds,
      ...(isLockedAudience ? { leagues: [], locked_preview: lockedPreview } : {}),
      is_scraper_blinded: isBot,
      auth_status: authStatus,
      is_stale: isStale,
    };

    const bodyStr = JSON.stringify({ success: true, ...payload });
    const etag = generateEtag(bodyStr);
    if (matchesEtag(req, etag)) {
      return create304Response(etag, responseHeaders);
    }

    responseHeaders['ETag'] = etag;
    return new Response(bodyStr, { status: 200, headers: responseHeaders });
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to fetch goals feed',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      }
    );
  }
}
