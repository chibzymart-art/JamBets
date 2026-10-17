import { checkAdaptiveRateLimit, getClientIp } from './rate-limiter';
import { verifyEdgeAccess, hasMultiSportAccess } from './_lib/jwt-verifier';
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

interface TennisFeedData {
  predictions: any[];
  tournaments: any[];
  settlements: any[];
  stats: {
    total_matches: number;
    bangers_count: number;
    top_picks_count: number;
    high_confidence_count: number;
    tournaments_count: number;
    settled_count: number;
    settled_won: number;
    settled_lost: number;
    settled_void: number;
    win_rate: number;
  };
  cached_at: string;
}

// Global SWR Edge Cache: 900s fresh (15 min default) + 3600s stale (1 hour)
const tennisSwrCache = new EdgeSwrCache<TennisFeedData>(900 * 1000, 3600 * 1000);
EdgeCacheRegistry.register('tennis', tennisSwrCache);

// Adaptive Dynamic TTL for Live Scores and Instant Settlement Invalidation (Sub-Phase 2.4)
function computeTennisTtl(data: TennisFeedData): number {
  const hasLive = (data.predictions || []).some((p: any) => {
    const st = (p.fixture?.status || '').toLowerCase();
    return st === 'live' || st === 'in_progress' || st.includes('set') || st.includes('game');
  });
  return hasLive ? 15 * 1000 : 900 * 1000;
}

// Multi-sport (tennis) is strictly BigBang VIP + Admin. Trial / Standard / Expired / Visitor stay locked.
async function checkIsPaidOrAdmin(authToken: string | null): Promise<boolean> {
  const level = await verifyEdgeAccess(authToken);
  return hasMultiSportAccess(level);
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

async function fetchTennisDataFromUpstream(rawToken?: string | null): Promise<TennisFeedData> {
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    Accept: 'application/json',
  };

  if (rawToken) {
    headers['Authorization'] = `Bearer ${rawToken}`;
  } else if (SUPABASE_SERVICE_ROLE_KEY) {
    headers['Authorization'] = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  } else {
    headers['Authorization'] = `Bearer ${SUPABASE_ANON_KEY}`;
  }

  // 1. Primary Path: Zero-Join Point Read from pre-computed cached_feeds table (Sub-Phase 2.3)
  try {
    const snapRes = await fetch(
      `${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:tennis&select=payload,updated_at&limit=1`,
      { headers }
    );
    if (snapRes.ok) {
      const snapRows = await snapRes.json();
      if (Array.isArray(snapRows) && snapRows.length > 0 && snapRows[0]?.payload) {
        const payload = snapRows[0].payload as TennisFeedData;
        if (Array.isArray(payload.predictions) && Array.isArray(payload.tournaments)) {
          return payload;
        }
      }
    }
  } catch (err) {
    console.warn('[TennisFeed] Zero-join cached feed lookup failed, falling back to relational join:', err);
  }

  // 2. Fallback Path: 3-Table Join on tennis_predictions + fixtures + tournaments
  const predSelect = encodeURIComponent(
    '*,fixture:tennis_fixtures(id,canonical_key,round,best_of_sets,target_kickoff_at,status,score_p1_sets,score_p2_sets,set_scores,current_game_score,server_indicator,tournament:tennis_tournaments(id,name,tour,category,surface,court_pace_index),player1:tennis_players!tennis_fixtures_player1_id_fkey(id,display_name,canonical_name,country,current_rank,hard_elo,clay_elo,grass_elo,indoor_elo),player2:tennis_players!tennis_fixtures_player2_id_fkey(id,display_name,canonical_name,country,current_rank,hard_elo,clay_elo,grass_elo,indoor_elo))'
  );

  const settleSelect = encodeURIComponent(
    '*,fixture:tennis_fixtures(id,canonical_key,round,status,score_p1_sets,score_p2_sets,set_scores,tournament:tennis_tournaments(name,tour,surface,court_pace_index),player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name),player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name))'
  );

  const now = new Date();
  const minDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const maxDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();

  const [predsRes, tourneysRes, settleRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/tennis_predictions?select=${predSelect}&target_kickoff_at=gte.${minDate}&target_kickoff_at=lte.${maxDate}&order=target_kickoff_at.asc&limit=1000`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/tennis_tournaments?select=*&order=name.asc&limit=100`,
      { headers }
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/tennis_settlements?select=${settleSelect}&order=settled_at.desc&limit=100`,
      { headers }
    ),
  ]);

  const predictions = predsRes.ok ? await predsRes.json() : [];
  const tournaments = tourneysRes.ok ? await tourneysRes.json() : [];
  const settlements = settleRes.ok ? await settleRes.json() : [];

  // Ensure locked predictions have structured paywall teaser markers if unpopulated
  for (const p of predictions) {
    if (p.is_locked && (!p.secondary_predictions || p.secondary_predictions.length === 0)) {
      p.secondary_predictions = [
        { market: 'game_handicap', prediction: '🔒 VIP Banker', probability: null, locked: true },
        { market: 'first_set_winner', prediction: '🔒 VIP Banker', probability: null, locked: true },
        { market: 'set_handicap', prediction: '🔒 VIP Banker', probability: null, locked: true },
        { market: 'total_games_over_under', prediction: '🔒 VIP Banker', probability: null, locked: true },
      ];
    }
  }

  // Compute stats
  let bangers = 0;
  let topPicks = 0;
  let highConf = 0;

  for (const p of predictions) {
    const tier = p.confidence_category || '';
    if (tier === 'BANGER') bangers++;
    else if (tier === 'TOP PICK') topPicks++;
    else if (tier === 'HIGH CONFIDENCE') highConf++;
  }

  let settledWon = 0;
  let settledLost = 0;
  let settledVoid = 0;

  for (const s of settlements) {
    const st = (s.status || '').toLowerCase();
    if (st === 'won') settledWon++;
    else if (st === 'lost') settledLost++;
    else if (st === 'void') settledVoid++;
  }

  const finishedDecisive = settledWon + settledLost;
  const winRate = finishedDecisive > 0 ? Math.round((settledWon / finishedDecisive) * 100) : 0;

  return {
    predictions: Array.isArray(predictions) ? predictions : [],
    tournaments: Array.isArray(tournaments) ? tournaments : [],
    settlements: Array.isArray(settlements) ? settlements : [],
    stats: {
      total_matches: Array.isArray(predictions) ? predictions.length : 0,
      bangers_count: bangers,
      top_picks_count: topPicks,
      high_confidence_count: highConf,
      tournaments_count: Array.isArray(tournaments) ? tournaments.length : 0,
      settled_count: Array.isArray(settlements) ? settlements.length : 0,
      settled_won: settledWon,
      settled_lost: settledLost,
      settled_void: settledVoid,
      win_rate: winRate,
    },
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

export default async function handler(req: Request): Promise<Response> {
  const origin = getCorsOrigin(req);
  const corsHeaders = {
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
  const rateLimit = checkAdaptiveRateLimit(req, 'tennis-feed');
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

  const url = new URL(req.url);
  const forceRefresh = (isInternalService || isPaidOrAdmin) &&
    (url.searchParams.get('refresh') === 'true' || req.headers.get('x-force-refresh') === 'true');
  if (forceRefresh) {
    tennisSwrCache.invalidate('tennis:raw');
  }

  try {
    const { data: feedData, isStale } = await tennisSwrCache.getOrFetch(
      'tennis:raw',
      () => fetchTennisDataFromUpstream(SUPABASE_SERVICE_ROLE_KEY || null),
      computeTennisTtl
    );

    if (isBot) {
      const wonOnly = feedData.predictions
        .filter((p) => p.settlement_status === 'won')
        .map((p) => ({
          ...p,
          is_locked: false,
          metadata: { proof_of_work: 'verified_won_settlement' },
        }));
      const wonSettlements = (feedData.settlements || []).filter((s: any) => (s.status || '').toLowerCase() === 'won');
      const botHeaders: Record<string, string> = {
        ...corsHeaders,
        'Cache-Control': 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400',
        'CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=86400',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=900, stale-while-revalidate=86400',
        'Vary': 'Authorization, Origin, User-Agent',
      };
      const botBodyStr = JSON.stringify({
        success: true,
        is_subscriber: false,
        is_scraper_blinded: true,
        stats: {
          ...feedData.stats,
          total_matches: wonOnly.length,
          settled_count: wonSettlements.length,
        },
        tournaments: feedData.tournaments,
        settlements: wonSettlements,
        predictions: wonOnly,
        cached_at: feedData.cached_at,
        is_stale: isStale,
      });
      const botEtag = generateEtag(botBodyStr);
      if (matchesEtag(req, botEtag)) {
        return create304Response(botEtag, botHeaders);
      }
      botHeaders['ETag'] = botEtag;
      return new Response(botBodyStr, {
        status: 200,
        headers: botHeaders,
      });
    }

    const url = new URL(req.url);
    const surfaceFilter = url.searchParams.get('surface')?.toLowerCase();
    const tourFilter = url.searchParams.get('tour')?.toUpperCase();
    const tierFilter = url.searchParams.get('tier')?.toLowerCase();
    const statusFilter = url.searchParams.get('status')?.toLowerCase();

    // Redact or preserve based on subscriber status
    const processedPredictions = feedData.predictions
      .filter((p) => {
        if (surfaceFilter && surfaceFilter !== 'all') {
          const s = p.fixture?.tournament?.surface?.toLowerCase();
          if (s !== surfaceFilter) return false;
        }
        if (tourFilter && tourFilter !== 'ALL') {
          const t = p.fixture?.tournament?.tour?.toUpperCase();
          if (t !== tourFilter) return false;
        }
        if (tierFilter && tierFilter !== 'all') {
          const tier = (p.confidence_category || '').toLowerCase();
          if (tierFilter === 'bangers' && tier !== 'banger') return false;
          if (tierFilter === 'top_picks' && tier !== 'top pick') return false;
        }
        if (statusFilter && statusFilter !== 'all') {
          const st = (p.fixture?.status || '').toLowerCase();
          if (st !== statusFilter) return false;
        }

        return true;
      })
      .map((p) => {
        if (isPaidOrAdmin) {
          return {
            ...p,
            is_locked: false,
          };
        }

        // For free users & visitors: ALL tennis predictions (including settled) are locked teasers without exposing won/lost
        return {
          ...p,
          prediction: '🔒 BigBang VIP Pick',
          probability: null,
          confidence_category: p.confidence_category || 'TOP PICK',
          fair_odds: null,
          market_odds: null,
          settlement_status: 'pending',
          settlement_notes: null,
          actual_result: null,
          secondary_predictions: [],
          metadata: {
            ...p.metadata,
            ai_tactical_analysis: '🔒 ATP & WTA match predictions and Markov chain models are reserved for BigBang VIP members.',
            markov: undefined,
          },
          is_locked: true,
        };
      });

    const sanitizedStats = isPaidOrAdmin ? feedData.stats : {
      ...feedData.stats,
      settled_count: 0,
      settled_won: 0,
      settled_lost: 0,
      settled_void: 0,
      win_rate: 0,
    };

    const responseHeaders: Record<string, string> = {
      ...corsHeaders,
      'Cache-Control': isPaidOrAdmin
        ? 'private, max-age=60, stale-while-revalidate=300'
        : 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400',
      'CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
      'Vercel-CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
      'Vary': 'Authorization, Origin',
      'X-RateLimit-Limit': String(rateLimit.limit),
      'X-RateLimit-Remaining': String(rateLimit.remaining),
    };

    const bodyStr = JSON.stringify({
      success: true,
      is_subscriber: isPaidOrAdmin,
      stats: sanitizedStats,
      tournaments: feedData.tournaments,
      settlements: isPaidOrAdmin ? feedData.settlements : [],
      predictions: processedPredictions,
      cached_at: feedData.cached_at,
      is_stale: isStale,
    });

    const etag = generateEtag(bodyStr);
    if (matchesEtag(req, etag)) {
      return create304Response(etag, responseHeaders);
    }

    responseHeaders['ETag'] = etag;
    return new Response(bodyStr, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (error: any) {
    console.error('Tennis feed error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Failed to fetch tennis feed',
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
