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

interface MemoryCacheEntry {
  data: BasketballFeedData;
  expiresAt: number;
}

const memoryCache = new Map<string, MemoryCacheEntry>();
const inflightPromises = new Map<string, Promise<BasketballFeedData>>();
const CACHE_TTL_MS = 120 * 1000; // 120 seconds edge memory cache

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
    if (
      authUser.app_metadata?.role === 'admin' ||
      authUser.user_metadata?.role === 'admin' ||
      (email && ADMIN_EMAILS.has(email))
    ) {
      userAuthCache.set(rawToken, { isPaid: true, expiresAt: Date.now() + 120 * 1000 });
      return true;
    }

    const userId = authUser.id;
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${rawToken}`,
      Accept: 'application/json',
    };

    const [subRes, entRes, userRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&status=eq.active&select=tier&limit=1`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}&select=tier,valid_until,features&limit=1`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=role&limit=1`, { headers }),
    ]);

    // Check users table role
    if (userRes.ok) {
      const userData = await userRes.json();
      if (Array.isArray(userData) && userData.length > 0 && userData[0].role === 'admin') {
        userAuthCache.set(rawToken, { isPaid: true, expiresAt: Date.now() + 120 * 1000 });
        return true;
      }
    }

    let isPaid = false;

    // Subscriptions: Only BigBang VIP & Admin have access to multi-sport (Basketball)
    if (subRes.ok) {
      const subData = await subRes.json();
      if (Array.isArray(subData) && subData.length > 0) {
        const tier = (subData[0].tier || '').toLowerCase();
        if (['bigbang', 'vip', 'admin'].includes(tier)) {
          isPaid = true;
        }
      }
    }

    // Entitlements: Must be BigBang, VIP, Admin, or have multi-sport/basketball features
    if (!isPaid && entRes.ok) {
      const entData = await entRes.json();
      if (Array.isArray(entData) && entData.length > 0) {
        const ent = entData[0];
        const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : Infinity;
        if (validUntil > Date.now()) {
          const tier = (ent.tier || '').toLowerCase();
          const feats = ent.features || {};
          const isEntAdmin = tier === 'admin' || feats.admin === true;
          const hasVipFeatures = Boolean(
            feats.bigbang === true ||
            feats.all_sports === true ||
            feats.multi_sport === true ||
            feats.basketball === true
          );
          if (['bigbang', 'vip', 'admin'].includes(tier) || isEntAdmin || hasVipFeatures) {
            isPaid = true;
          }
        }
      }
    }

    userAuthCache.set(rawToken, { isPaid, expiresAt: Date.now() + 120 * 1000 });
    return isPaid;
  } catch (err) {
    console.error('Cryptographic auth check failed in basketball feed:', err);
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

async function fetchBasketballFromUpstream(isPaidOrAdmin: boolean): Promise<BasketballFeedData> {
  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

  const predTable = isPaidOrAdmin ? 'basketball_predictions' : 'basketball_predictions_paywall';

  const predSelect = encodeURIComponent(
    `id,fixture_id,market,prediction,probability,confidence_category,secondary_predictions,metadata,simulations_count,simulated_home_score,simulated_away_score,edge_percentage,fair_odds,market_odds,tier_required,publication_status,target_kickoff_at,settlement_status,settlement_notes,settled_at,actual_result,fixture:basketball_fixtures(id,canonical_key,target_kickoff_at,status,home_score,away_score,period_scores,current_period,time_remaining,market_spread,market_total,home_moneyline_odds,away_moneyline_odds,home_rest_days,away_rest_days,is_home_b2b,is_away_b2b,league:basketball_leagues(id,code,name,country,quarter_minutes,periods_count,default_pace),home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(id,canonical_name,short_name,city,state,arena_name,altitude_ft,offensive_rating,defensive_rating,net_rating,pace,four_factors,logo_url),away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(id,canonical_name,short_name,city,state,arena_name,altitude_ft,offensive_rating,defensive_rating,net_rating,pace,four_factors,logo_url))`
  );

  const settleSelect = encodeURIComponent(
    `id,prediction_id,fixture_id,status,final_home_score,final_away_score,score_margin,total_points,notes,settled_at`
  );

  const [predsRes, leaguesRes, settleRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/${predTable}?select=${predSelect}&order=target_kickoff_at.asc&limit=1000`,
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

  const predictions = (Array.isArray(rawPredictions) ? rawPredictions : []).map(pruneBasketballPrediction);
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

// Strict Paywall Redaction for Basketball:
// 1. Non-paid users only see WON predictions for finished matches (unlocked as proof)
// 2. Non-paid users NEVER see lost, void, or un-won finished predictions (completely hidden)
// 3. Upcoming predictions are locked
function applyBasketballPaywallRedaction(preds: any[]): any[] {
  return preds
    .filter((p: any) => {
      const status = (p.settlement_status || '').toLowerCase();
      const isFinished = p.fixture?.status === 'finished' || Boolean(p.settled_at);
      if (status === 'lost' || status === 'void' || status === 'voided' || (isFinished && status !== 'won')) {
        return false;
      }
      return true;
    })
    .map((p: any) => {
      const isWon = (p.settlement_status || '').toLowerCase() === 'won';
      if (isWon) {
        return {
          ...p,
          is_locked: false,
        };
      }
      return {
        ...p,
        is_locked: true,
        probability: null,
        confidence_category: p.confidence_category === 'BANGER' ? 'BANGER' : 'TOP PICK',
        prediction: '🔒 Subscriber Only',
        secondary_predictions: [],
        metadata: {},
      };
    });
}

  for (const s of settlements) {
    const st = (s.status || '').toLowerCase();
    if (st === 'won') settledWon++;
    else if (st === 'lost') settledLost++;
    else if (st === 'void' || st === 'voided') settledVoid++;
  }

  const finishedDecisive = settledWon + settledLost;
  const winRate = finishedDecisive > 0 ? Math.round((settledWon / finishedDecisive) * 100) : 85.0;

  const sanitizedPredictions = !isPaidOrAdmin ? applyBasketballPaywallRedaction(predictions) : predictions;

  return {
    predictions: sanitizedPredictions,
    leagues,
    settlements: isPaidOrAdmin ? settlements : settlements.filter((s: any) => (s.status || '').toLowerCase() === 'won'),
    stats: {
      total_matches: sanitizedPredictions.length,
      bangers_count: bangers,
      top_picks_count: topPicks,
      high_confidence_count: highConf,
      leagues_count: leagues.length,
      settled_count: isPaidOrAdmin ? settlements.length : settledWon,
      settled_won: settledWon,
      settled_lost: isPaidOrAdmin ? settledLost : 0,
      settled_void: isPaidOrAdmin ? settledVoid : 0,
      win_rate: isPaidOrAdmin ? winRate : (settledWon > 0 ? 100 : 0),
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
  const rateLimit = checkRateLimit(`bball-feed:${clientIp}`, 120, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          'Retry-After': String(rateLimit.resetSec),
          'X-RateLimit-Limit': '120',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimit.resetSec),
        },
      }
    );
  }

  const authHeader = req.headers.get('Authorization');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim() || null;
  const isPaidOrAdmin = await checkIsPaidOrAdmin(rawToken);

  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    'Cache-Control': isPaidOrAdmin
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, s-maxage=60, stale-while-revalidate=300',
    'CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=60',
    'Vercel-CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=60',
    'Vary': 'Authorization, Origin',
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': '120',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  const cacheKey = `bball:${isPaidOrAdmin ? 'vip' : 'public'}`;

  try {
    const now = Date.now();
    const cached = memoryCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return new Response(
        JSON.stringify({ success: true, is_subscriber: isPaidOrAdmin, ...cached.data }),
        { status: 200, headers: responseHeaders }
      );
    }

    let fetchPromise = inflightPromises.get(cacheKey);
    if (!fetchPromise) {
      fetchPromise = fetchBasketballFromUpstream(isPaidOrAdmin)
        .then((data) => {
          memoryCache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS });
          inflightPromises.delete(cacheKey);
          return data;
        })
        .catch((err) => {
          inflightPromises.delete(cacheKey);
          throw err;
        });
      inflightPromises.set(cacheKey, fetchPromise);
    }

    const feedData = await fetchPromise;
    return new Response(
      JSON.stringify({ success: true, is_subscriber: isPaidOrAdmin, ...feedData }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err: any) {
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      return new Response(
        JSON.stringify({ success: true, is_subscriber: isPaidOrAdmin, ...cached.data, stale: true }),
        { status: 200, headers: responseHeaders }
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Basketball Edge proxy error' }),
      {
        status: 502,
        headers: corsHeaders,
      }
    );
  }
}
