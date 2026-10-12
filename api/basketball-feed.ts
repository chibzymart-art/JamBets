import { checkAdaptiveRateLimit, getClientIp } from './rate-limiter';
import { verifyEdgeAuth } from './_lib/jwt-verifier';
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

interface BasketballFeedData {
  predictions: any[];
  leagues: any[];
  settlements: any[];
  stats: {
    total_matches: number;
    bangers_count: number;
    top_picks_count: number;
    high_confidence_count: number;
    leagues_count: number;
    settled_count: number;
    settled_won: number;
    settled_lost: number;
    settled_void: number;
    win_rate: number;
  };
  cached_at: string;
}

// Global SWR Edge Cache: 180s fresh (3 min default) + 3600s stale (1 hour)
const basketballSwrCache = new EdgeSwrCache<BasketballFeedData>(180 * 1000, 3600 * 1000);
EdgeCacheRegistry.register('basketball', basketballSwrCache);

// Adaptive Dynamic TTL for Live Scores and Instant Settlement Invalidation (Sub-Phase 2.4)
function computeBasketballTtl(data: BasketballFeedData): number {
  const hasLive = (data.predictions || []).some((p: any) => {
    const st = (p.fixture?.status || '').toLowerCase();
    const period = (p.fixture?.current_period || '').toLowerCase();
    return st === 'live' || st === 'in_progress' || period.includes('q') || period.includes('ot') || period.includes('half');
  });
  return hasLive ? 15 * 1000 : 180 * 1000;
}

async function checkIsPaidOrAdmin(authToken: string | null): Promise<boolean> {
  const status = await verifyEdgeAuth(authToken);
  return status === 'paid_or_trial';
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

function pruneBasketballPrediction(p: any): any {
  let meta = p.metadata;
  if (typeof meta === 'string') {
    try { meta = JSON.parse(meta); } catch { meta = {}; }
  }
  let prunedMeta: Record<string, any> = {};
  if (meta && typeof meta === 'object') {
    if (meta.simulation) prunedMeta.simulation = meta.simulation;
    if (meta.ai_tactical_analysis) prunedMeta.ai_tactical_analysis = meta.ai_tactical_analysis;
  }

  const fix = p.fixture || {};
  const prunedFix: Record<string, any> = {
    id: fix.id,
    canonical_key: fix.canonical_key || fix.id,
    status: fix.status,
    target_kickoff_at: fix.target_kickoff_at,
    home_score: fix.home_score,
    away_score: fix.away_score,
    period_scores: fix.period_scores,
    current_period: fix.current_period,
    time_remaining: fix.time_remaining,
    market_spread: fix.market_spread,
    market_total: fix.market_total,
    home_moneyline_odds: fix.home_moneyline_odds,
    away_moneyline_odds: fix.away_moneyline_odds,
    home_rest_days: fix.home_rest_days,
    away_rest_days: fix.away_rest_days,
    is_home_b2b: fix.is_home_b2b,
    is_away_b2b: fix.is_away_b2b,
    league: fix.league,
    home_team: fix.home_team,
    away_team: fix.away_team,
  };

  return {
    id: p.id,
    fixture_id: p.fixture_id,
    market: p.market,
    prediction: p.prediction,
    probability: p.probability,
    confidence_category: p.confidence_category,
    secondary_predictions: p.secondary_predictions || [],
    simulations_count: p.simulations_count || 250000,
    simulated_home_score: p.simulated_home_score,
    simulated_away_score: p.simulated_away_score,
    edge_percentage: p.edge_percentage,
    fair_odds: p.fair_odds,
    market_odds: p.market_odds,
    tier_required: p.tier_required || 'free',
    publication_status: p.publication_status || 'published',
    target_kickoff_at: p.target_kickoff_at,
    settlement_status: p.settlement_status,
    settlement_notes: p.settlement_notes,
    settled_at: p.settled_at,
    actual_result: p.actual_result,
    metadata: prunedMeta,
    fixture: prunedFix,
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

export function applyBasketballScraperBlinding(predictionsOrData: any): any {
  const preds = Array.isArray(predictionsOrData)
    ? predictionsOrData
    : (predictionsOrData?.predictions || []);
  const wonPreds = preds
    .filter((p: any) => p && p.settlement_status === 'won')
    .map((p: any) => ({
      ...p,
      is_locked: false,
      metadata: { proof_of_work: 'verified_won_settlement' },
    }));
  if (Array.isArray(predictionsOrData)) {
    return wonPreds;
  }
  const wonSettles = (predictionsOrData?.settlements || []).filter((s: any) => (s.status || '').toLowerCase() === 'won');
  return {
    ...predictionsOrData,
    predictions: wonPreds,
    settlements: wonSettles,
    stats: {
      ...predictionsOrData?.stats,
      total_matches: wonPreds.length,
      settled_count: wonSettles.length,
    },
  };
}

// Multi-Sport VIP Paywall Redaction for Basketball:
// For unauthenticated / free visitors:
// - Future and pending predictions are masked with teaser markers and locked confidence picks
// - Historical settled predictions (won, lost, void) retain their true settlement_status, settled_at, and actual_result so track records are transparent and verified
function applyBasketballPaywallRedaction(preds: any[]): any[] {
  return preds.map((p: any) => {
    const isSettled = p.settlement_status === 'won' || p.settlement_status === 'lost' || p.settlement_status === 'void';
    return {
      ...p,
      is_locked: !isSettled,
      probability: isSettled ? p.probability : null,
      confidence_category: p.confidence_category || 'TOP PICK',
      prediction: isSettled ? (p.prediction || 'VIP Pick') : '🔒 BigBang VIP Pick',
      settlement_status: p.settlement_status || 'pending',
      settlement_notes: p.settlement_notes || null,
      actual_result: p.actual_result || null,
      settled_at: p.settled_at || null,
      simulated_home_score: isSettled ? p.simulated_home_score : null,
      simulated_away_score: isSettled ? p.simulated_away_score : null,
      edge_percentage: isSettled ? p.edge_percentage : null,
      fair_odds: isSettled ? p.fair_odds : null,
      market_odds: isSettled ? p.market_odds : null,
      secondary_predictions: isSettled ? (p.secondary_predictions || []) : [],
      metadata: isSettled ? p.metadata : {
        ai_tactical_analysis: '🔒 Basketball predictions and 250,000 Monte Carlo simulations are reserved for BigBang VIP members.',
        simulation: null,
        secondary_locked: true,
      },
    };
  });
}

async function fetchBasketballFromUpstream(): Promise<BasketballFeedData> {
  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

  // 1. Primary Path: Zero-Join Point Read from pre-computed cached_feeds table (Sub-Phase 2.3)
  try {
    const snapRes = await fetch(
      `${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:basketball&select=payload,updated_at&limit=1`,
      { headers }
    );
    if (snapRes.ok) {
      const snapRows = await snapRes.json();
      if (Array.isArray(snapRows) && snapRows.length > 0 && snapRows[0]?.payload) {
        const payload = snapRows[0].payload as BasketballFeedData;
        if (Array.isArray(payload.predictions) && Array.isArray(payload.leagues)) {
          return payload;
        }
      }
    }
  } catch (err) {
    console.warn('[BasketballFeed] Zero-join cached feed lookup failed, falling back to relational join:', err);
  }

  // 2. Fallback Path: 3-Table Join on basketball_predictions + fixtures + leagues
  const predTable = 'basketball_predictions';

  const predSelect = encodeURIComponent(
    `id,fixture_id,market,prediction,probability,confidence_category,secondary_predictions,metadata,simulations_count,simulated_home_score,simulated_away_score,edge_percentage,fair_odds,market_odds,tier_required,publication_status,target_kickoff_at,settlement_status,settlement_notes,settled_at,actual_result,fixture:basketball_fixtures(id,canonical_key,target_kickoff_at,status,home_score,away_score,period_scores,current_period,time_remaining,market_spread,market_total,home_moneyline_odds,away_moneyline_odds,home_rest_days,away_rest_days,is_home_b2b,is_away_b2b,league:basketball_leagues(id,code,name,country,quarter_minutes,periods_count,default_pace),home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(id,canonical_name,short_name,city,state,arena_name,altitude_ft,offensive_rating,defensive_rating,net_rating,pace,four_factors,logo_url),away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(id,canonical_name,short_name,city,state,arena_name,altitude_ft,offensive_rating,defensive_rating,net_rating,pace,four_factors,logo_url))`
  );

  const settleSelect = encodeURIComponent(
    `id,prediction_id,fixture_id,status,final_home_score,final_away_score,score_margin,total_points,notes,settled_at`
  );

  const now = new Date();
  const minDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [predsRes, leaguesRes, settleRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/${predTable}?select=${predSelect}&target_kickoff_at=gte.${minDate}&order=target_kickoff_at.asc&limit=1000`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/basketball_leagues?select=id,code,name,country,quarter_minutes,periods_count,default_pace&is_active=eq.true&order=name.asc&limit=100`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/basketball_settlements?select=${settleSelect}&order=settled_at.desc&limit=100`,
      { headers }
    ),
  ]);

  const rawPredictions = predsRes.ok ? await predsRes.json() : [];
  const rawLeagues = leaguesRes.ok ? await leaguesRes.json() : [];
  const rawSettlements = settleRes.ok ? await settleRes.json() : [];

  const rawList = (Array.isArray(rawPredictions) ? rawPredictions : []).map(pruneBasketballPrediction);
  const seenFixKey = new Set<string>();
  const predictions: any[] = [];
  for (const p of rawList) {
    const f = p.fixture || {};
    const h = (f.home_team?.canonical_name || f.home_team?.name || '').toLowerCase().trim();
    const a = (f.away_team?.canonical_name || f.away_team?.name || '').toLowerCase().trim();
    const dt = (p.target_kickoff_at || f.target_kickoff_at || '').substring(0, 10);
    const mkt = (p.market || '').toLowerCase();
    const dedupeKey = h && a ? `${h}::${a}::${dt}::${mkt}` : p.id;
    if (!seenFixKey.has(dedupeKey)) {
      seenFixKey.add(dedupeKey);
      predictions.push(p);
    }
  }
  const leagues = Array.isArray(rawLeagues) ? rawLeagues : [];
  const settlements = Array.isArray(rawSettlements) ? rawSettlements : [];

  // Compute stats
  let bangers = 0;
  let topPicks = 0;
  let highConf = 0;

  for (const p of predictions) {
    const tier = (p.confidence_category || '').toUpperCase();
    if (tier === 'BANGER' || tier.includes('BANGER')) bangers++;
    else if (tier === 'TOP PICK' || tier.includes('TOP')) topPicks++;
    else if (tier === 'HIGH CONFIDENCE' || tier.includes('HIGH')) highConf++;
  }

  let settledWon = 0;
  let settledLost = 0;
  let settledVoid = 0;

  for (const s of settlements) {
    const st = (s.status || '').toLowerCase();
    if (st === 'won') settledWon++;
    else if (st === 'lost') settledLost++;
    else if (st === 'void' || st === 'voided') settledVoid++;
  }

  const finishedDecisive = settledWon + settledLost;
  const winRate = finishedDecisive > 0 ? Math.round((settledWon / finishedDecisive) * 100) : (settledWon > 0 ? 100 : 0);

  return {
    predictions,
    leagues,
    settlements: settlements,
    stats: {
      total_matches: predictions.length,
      bangers_count: bangers,
      top_picks_count: topPicks,
      high_confidence_count: highConf,
      leagues_count: leagues.length,
      settled_count: settlements.length,
      settled_won: settledWon,
      settled_lost: settledLost,
      settled_void: settledVoid,
      win_rate: winRate,
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
  const rateLimit = checkAdaptiveRateLimit(req, 'bball-feed');
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(rateLimit.resetSec),
          'X-RateLimit-Limit': String(rateLimit.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimit.resetSec),
        },
      }
    );
  }

  const authHeader = req.headers.get('Authorization');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim() || null;
  const isInternalService = Boolean(SUPABASE_SERVICE_ROLE_KEY && rawToken === SUPABASE_SERVICE_ROLE_KEY);
  const isBot = !isInternalService && isScraperBot(req);

  const isPaidOrAdmin = isBot ? false : await checkIsPaidOrAdmin(rawToken);

  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    'Cache-Control': isPaidOrAdmin
      ? 'private, max-age=30, stale-while-revalidate=120'
      : 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
    'CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300',
    'Vercel-CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=300',
    'Vary': 'Authorization, Origin, User-Agent',
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': String(rateLimit.limit),
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  const url = new URL(req.url);
  const forceRefresh = (isInternalService || isPaidOrAdmin) &&
    (url.searchParams.get('refresh') === 'true' || req.headers.get('x-force-refresh') === 'true');
  if (forceRefresh) {
    basketballSwrCache.invalidate('basketball:raw');
  }

  try {
    const { data: rawFeed, isStale } = await basketballSwrCache.getOrFetch('basketball:raw', fetchBasketballFromUpstream, computeBasketballTtl);

    const sanitizedPredictions = !isPaidOrAdmin ? applyBasketballPaywallRedaction(rawFeed.predictions) : rawFeed.predictions;
    const dataToServe = {
      ...rawFeed,
      predictions: isBot ? applyBasketballScraperBlinding(sanitizedPredictions) : sanitizedPredictions,
      stats: {
        ...rawFeed.stats,
        total_matches: sanitizedPredictions.length,
        settled_lost: isPaidOrAdmin ? rawFeed.stats.settled_lost : 0,
        settled_void: isPaidOrAdmin ? rawFeed.stats.settled_void : 0,
      },
      is_stale: isStale,
    };

    const bodyStr = JSON.stringify({
      success: true,
      is_subscriber: isPaidOrAdmin,
      is_scraper_blinded: isBot,
      ...dataToServe,
    });

    const etag = generateEtag(bodyStr);
    if (matchesEtag(req, etag)) {
      return create304Response(etag, responseHeaders);
    }

    responseHeaders['ETag'] = etag;
    return new Response(bodyStr, { status: 200, headers: responseHeaders });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Basketball Edge proxy error' }),
      {
        status: 502,
        headers: corsHeaders,
      }
    );
  }
}
