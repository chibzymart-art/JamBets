// v2.4-edge-cache-prod-sync
import { checkAdaptiveRateLimit, getClientIp } from './rate-limiter';
import { verifyEdgeAuth, AuthStatus } from './_lib/jwt-verifier';
import { EdgeSwrCache, EdgeCacheRegistry } from './_lib/edge-cache';
import { generateEtag, matchesEtag, create304Response } from './_lib/etag';
import { LOCKED_TIER, normalizeTier, buildLockedTierCounts, resolveTimeZone, byKickoffThenId, withoutFixtureMetadata } from './_lib/teaser';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface FeedData {
  predictions: any[];
  leagues: any[];
  cached_at: string;
}

// Global SWR Edge Cache: 900s fresh (15 min default) + 3600s stale (1 hour)
const feedSwrCache = new EdgeSwrCache<FeedData>(900 * 1000, 3600 * 1000);
EdgeCacheRegistry.register('football', feedSwrCache);

// Adaptive Dynamic TTL for Live Scores and Instant Settlement Invalidation (Sub-Phase 2.4)
function computeFootballTtl(data: FeedData): number {
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

// Scraper Blinding Redaction:
// Scrapers and automated crawlers are blinded from all active, pending, in-play, and unverified predictions.
// Scrapers can ONLY see verified 'won' historical predictions as public proof of work for SEO.
export function applyScraperBlinding(predictions: any[]): any[] {
  return predictions
    .filter((p: any) => p.settlement_status === 'won')
    .map((p: any) => ({
      ...p,
      is_locked: false,
      probability: p.probability,
      market: p.market,
      confidence_category: p.confidence_category || 'TOP_PICK',
      prediction: p.prediction,
      settlement_status: 'won',
      actual_score: p.actual_score,
      settled_at: p.settled_at,
      metadata: { proof_of_work: 'verified_won_settlement' },
    }));
}

// Strict Edge Paywall & Visitor Redaction:
// 1. Paid & Active 3-Day Trial: Full access to all predictions, probabilities, and won/lost settlements
// 2. Unauthenticated Human Visitors (Real Browser):
//    - Retains all fixtures (full count over 100) while strictly redacting prediction details
//    - Blinded from active pre-match predictions (stripped probabilities, markets, and metadata)
//    - Prompted: '🔒 Register to view Oddsbanta AI predictions'
// 3. Expired Trial / Non-Paying Users:
//    - Blinded from active predictions ('🔒 Subscribe to Oddsbanta VIP')
//    - Blinded from settlements (cannot view won or lost games for free)
function isSettledPick(p: any): boolean {
  return ['won', 'lost', 'void', 'voided', 'half_won', 'half_lost'].includes(String(p?.settlement_status || '').toLowerCase());
}

export function applyPaywallRedaction(predictions: any[], authStatus: AuthStatus): any[] {
  if (authStatus === 'paid_or_trial') {
    return predictions;
  }

  if (authStatus === 'expired') {
    // Expired trial users: retain all fixtures for full count, blinded from predictions & settlements
    return predictions.map((p: any) => ({
      ...p,
      is_locked: true,
      probability: null,
      market: null,
      fixture: withoutFixtureMetadata(p.fixture),
      // No tier on an open locked card: next to the fixture it gives the pick away. Settled cards keep
      // theirs so the per-tier track record stays visible.
      confidence_category: isSettledPick(p) ? (p.confidence_category || 'TOP_PICK') : LOCKED_TIER,
      prediction: '🔒 Subscribe to Oddsbanta VIP',
      publication_status: p.publication_status || 'published',
      secondary_predictions: [],
      metadata: { locked: true, subscription_required: true, trial_expired: true },
    }));
  }

  // authStatus === 'visitor': Unauthenticated human visitors in browsers
  // Retains all fixtures (full count over 100) while strictly redacting prediction details
  return predictions.map((p: any) => ({
    ...p,
    is_locked: true,
    probability: null,
    market: null,
    fixture: withoutFixtureMetadata(p.fixture),
    confidence_category: isSettledPick(p) ? (p.confidence_category || 'TOP_PICK') : LOCKED_TIER,
    prediction: '🔒 Register to view Oddsbanta AI predictions',
    publication_status: p.publication_status || 'published',
    secondary_predictions: [],
    metadata: { locked: true, registration_required: true },
  }));
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

function prunePrediction(p: any): any {
  let meta = p.metadata;
  if (typeof meta === 'string') {
    try {
      meta = JSON.parse(meta);
    } catch {
      meta = {};
    }
  }
  let prunedMeta: Record<string, any> = {};
  if (meta && typeof meta === 'object') {
    if (meta.ai_summary) prunedMeta.ai_summary = meta.ai_summary;
    if (meta.poisson_parameters) prunedMeta.poisson_parameters = meta.poisson_parameters;
    if (meta.simulation_outlines) prunedMeta.simulation_outlines = meta.simulation_outlines;
    if (meta.lambda_home != null) prunedMeta.lambda_home = meta.lambda_home;
    if (meta.lambda_away != null) prunedMeta.lambda_away = meta.lambda_away;
    if (meta.home_attack != null) prunedMeta.home_attack = meta.home_attack;
    if (meta.away_attack != null) prunedMeta.away_attack = meta.away_attack;
    if (meta.home_defense != null) prunedMeta.home_defense = meta.home_defense;
    if (meta.has_change != null) prunedMeta.has_change = meta.has_change;
    if (meta.previous_prediction) prunedMeta.previous_prediction = meta.previous_prediction;
    if (meta.change_reason) prunedMeta.change_reason = meta.change_reason;
    if (meta.change_detected_at) prunedMeta.change_detected_at = meta.change_detected_at;
  }

  const fix = p.fixture || {};
  const prunedFix: Record<string, any> = {
    id: fix.id,
    canonical_key: fix.canonical_key || fix.id,
    status: fix.status,
    target_kickoff_at: fix.target_kickoff_at,
    home_score: fix.home_score,
    away_score: fix.away_score,
    match_minute: fix.match_minute,
    period: fix.period,
    half_time_home_score: fix.half_time_home_score,
    half_time_away_score: fix.half_time_away_score,
    corners_home: fix.corners_home,
    corners_away: fix.corners_away,
    venue: fix.venue,
    league: fix.league,
    home_team: fix.home_team,
    away_team: fix.away_team,
  };
  if (fix.cancelled_at) prunedFix.cancelled_at = fix.cancelled_at;
  if (fix.postponed_at) prunedFix.postponed_at = fix.postponed_at;

  return {
    id: p.id,
    fixture_id: p.fixture_id,
    prediction: p.prediction,
    market: p.market,
    probability: p.probability,
    confidence_category: p.confidence_category,
    publication_status: p.publication_status || 'published',
    secondary_predictions: p.secondary_predictions || [],
    simulations_count: p.simulations_count || 250000,
    tier_required: p.tier_required || 'free',
    settlement_status: p.settlement_status,
    settlement_notes: p.settlement_notes,
    settled_at: p.settled_at,
    actual_score: p.actual_score,
    target_kickoff_at: p.target_kickoff_at,
    is_locked: false,
    metadata: prunedMeta,
    fixture: prunedFix,
  };
}

async function fetchFromUpstream(): Promise<FeedData> {
  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

  // 1. Primary Path: Zero-Join Point Read from pre-computed cached_feeds table (Sub-Phase 2.3)
  try {
    const snapRes = await fetch(
      `${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:football:today&select=payload,updated_at&limit=1`,
      { headers }
    );
    if (snapRes.ok) {
      const snapRows = await snapRes.json();
      if (Array.isArray(snapRows) && snapRows.length > 0 && snapRows[0]?.payload) {
        const payload = snapRows[0].payload as FeedData;
        if (Array.isArray(payload.predictions) && Array.isArray(payload.leagues)) {
          return payload;
        }
      }
    }
  } catch (snapErr) {
    console.warn('[PRED-FEED] Failed point-read from cached_feeds, falling back to relational query:', snapErr);
  }

  // 2. Fallback Path: Direct relational multi-table join (cold bootstrap / resilience)
  const now = new Date();
  const yesterdayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
  const minDate = yesterdayUtc.toISOString();
  const maxDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();

  const selectQuery = encodeURIComponent(
    `id,fixture_id,prediction,market,probability,confidence_category,secondary_predictions,metadata,settlement_status,settlement_notes,settled_at,actual_score,publication_status,simulations_count,target_kickoff_at,tier_required,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name))`
  );

  const [predRes, leagueRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/football_predictions?select=${selectQuery}&publication_status=eq.published&target_kickoff_at=gte.${minDate}&target_kickoff_at=lte.${maxDate}&order=target_kickoff_at.asc,id.asc&limit=1000`,
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

  const predictions = (Array.isArray(rawPredictions) ? rawPredictions : []).map(prunePrediction);

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

  // Rate Limiting (SEC-04): User-Centric CGNAT-Safe (180 req/min for auth users, 120 req/min for anon IPs)
  const clientIp = getClientIp(req);
  const rateLimit = checkAdaptiveRateLimit(req, 'pred-feed');
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

  // Scraper Bot Detection (curl, python-requests, scrapers, headless spiders)
  const isBot = !isInternalService && isScraperBot(req);

  const authStatus = isBot ? 'visitor' : await checkAuthStatus(userAuthToken);
  const isPaidOrTrial = authStatus === 'paid_or_trial';

  const corsOrigin = getCorsOrigin(req);
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': isPaidOrTrial
      ? 'private, max-age=60, stale-while-revalidate=300'
      : 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400',
    'CDN-Cache-Control': isPaidOrTrial ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': isPaidOrTrial ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
    'Vary': 'Authorization, Origin, User-Agent',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': String(rateLimit.limit),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  const url = new URL(req.url);
  const forceRefresh = (isInternalService || isPaidOrTrial) &&
    (url.searchParams.get('refresh') === 'true' || req.headers.get('x-force-refresh') === 'true');
  if (forceRefresh) {
    feedSwrCache.invalidate('feed:raw');
  }

  try {
    const { data: rawFeed, isStale } = await feedSwrCache.getOrFetch('feed:raw', fetchFromUpstream, computeFootballTtl);

    const bodyStr = JSON.stringify({
      success: true,
      ...(isBot
        ? {
            predictions: applyScraperBlinding(rawFeed.predictions),
            leagues: rawFeed.leagues,
            cached_at: rawFeed.cached_at,
            auth_status: 'scraper_blinded',
            is_stale: isStale,
          }
        : {
            ...rawFeed,
            predictions: authStatus === 'paid_or_trial'
              ? rawFeed.predictions
              : applyPaywallRedaction(rawFeed.predictions, authStatus).sort(byKickoffThenId),
            ...(authStatus === 'paid_or_trial'
              ? {}
              : {
                  locked_tier_counts: buildLockedTierCounts(
                    (rawFeed.predictions || []).filter((p: any) => !isSettledPick(p)).map((p: any) => ({
                      tier: normalizeTier(p.confidence_category, p.market, p.prediction),
                      kickoff: p.target_kickoff_at || p.fixture?.target_kickoff_at,
                    })),
                    resolveTimeZone(url.searchParams.get('tz'))
                  ),
                }),
            auth_status: authStatus,
            is_stale: isStale,
          }),
    });

    const etag = generateEtag(bodyStr);
    if (matchesEtag(req, etag)) {
      return create304Response(etag, responseHeaders);
    }

    responseHeaders['ETag'] = etag;
    return new Response(bodyStr, { status: 200, headers: responseHeaders });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Edge proxy error' }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin },
      }
    );
  }
}
