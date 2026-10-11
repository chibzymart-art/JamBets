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

export type AuthStatus = 'paid_or_trial' | 'expired' | 'visitor';

// In-memory cache for user auth verification (120s for valid users, 30s for invalid)
const userAuthCache = new Map<string, { status: AuthStatus; expiresAt: number }>();

async function checkAuthStatus(authToken: string | null): Promise<AuthStatus> {
  if (!authToken) return 'visitor';
  const rawToken = authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken.trim();
  if (!rawToken) return 'visitor';

  if (SUPABASE_SERVICE_ROLE_KEY && rawToken === SUPABASE_SERVICE_ROLE_KEY) {
    return 'paid_or_trial';
  }

  const cached = userAuthCache.get(rawToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.status;
  }

  try {
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${rawToken}`,
      },
    });

    if (!authRes.ok) {
      userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + 30 * 1000 });
      return 'visitor';
    }

    const authUser = await authRes.json();
    if (!authUser || !authUser.id) {
      userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + 30 * 1000 });
      return 'visitor';
    }

    const email = (authUser.email || '').toLowerCase().trim();
    if (
      authUser.app_metadata?.role === 'admin' ||
      authUser.user_metadata?.role === 'admin' ||
      (email && ADMIN_EMAILS.has(email))
    ) {
      userAuthCache.set(rawToken, { status: 'paid_or_trial', expiresAt: Date.now() + 120 * 1000 });
      return 'paid_or_trial';
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
      fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=role,created_at&limit=1`, { headers }),
    ]);

    let userData: any = null;
    if (userRes.ok) {
      userData = await userRes.json();
      if (Array.isArray(userData) && userData.length > 0 && userData[0].role === 'admin') {
        userAuthCache.set(rawToken, { status: 'paid_or_trial', expiresAt: Date.now() + 120 * 1000 });
        return 'paid_or_trial';
      }
    }

    let isPaid = false;

    // 1. Check active paid subscriptions
    if (subRes.ok) {
      const subData = await subRes.json();
      if (Array.isArray(subData) && subData.length > 0) {
        const tier = (subData[0].tier || '').toLowerCase();
        if (['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier)) {
          isPaid = true;
        }
      }
    }

    // 2. Check entitlements (active 3-day trial or active entitlement)
    if (!isPaid && entRes.ok) {
      const entData = await entRes.json();
      if (Array.isArray(entData) && entData.length > 0) {
        const ent = entData[0];
        const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : Infinity;
        if (validUntil > Date.now()) {
          const tier = (ent.tier || '').toLowerCase();
          const feats = ent.features || {};
          const isEntAdmin = tier === 'admin' || feats.admin === true;
          const hasVipOrTrialFeatures = Boolean(
            tier === 'trial' ||
            tier === 'free_trial' ||
            ['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier) ||
            feats.trial === true ||
            feats.vip === true ||
            feats.football_predictions === true ||
            feats.specialist_markets === true ||
            feats.simulations === true ||
            feats.all_sports === true ||
            feats.bigbang === true
          );
          if (['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier) || isEntAdmin || hasVipOrTrialFeatures) {
            isPaid = true;
          }
        }
      }
    }

    // 3. 3-Day Free Trial evaluation (72 hours from user registration)
    if (!isPaid) {
      const createdAt = authUser.created_at || (Array.isArray(userData) && userData[0]?.created_at);
      if (createdAt) {
        const createdMs = new Date(createdAt).getTime();
        const trialDurationMs = 3 * 24 * 60 * 60 * 1000; // 72 hours
        if (Date.now() - createdMs < trialDurationMs) {
          isPaid = true; // Active 3-Day Free Trial
        }
      }
    }

    const status: AuthStatus = isPaid ? 'paid_or_trial' : 'expired';
    userAuthCache.set(rawToken, { status, expiresAt: Date.now() + (isPaid ? 120 * 1000 : 30 * 1000) });
    return status;
  } catch (err) {
    console.error('Cryptographic auth check failed in goals feed:', err);
    return 'visitor';
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

async function fetchGoalsFromUpstream(headers: Record<string, string>): Promise<GoalsFeedData> {
  const selectQuery = encodeURIComponent(
    `id,fixture_id,market,predicted_outcome,probability,confidence_tier,xg_combined,home_over25_rate,away_over25_rate,h2h_over25_rate,ht_goal_frequency,avg_first_goal_minute,target_kickoff_at,settlement_status,settled_at,actual_score,ht_score,settlement_notes,metadata,is_locked,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,queue_day,in_prediction_queue,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,metadata,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name))`
  );

  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const upstreamHeaders = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

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

function applyGoalsPaywallRedaction(preds: any[], authStatus: AuthStatus): any[] {
  if (authStatus === 'paid_or_trial') {
    return preds.map((p: any) => ({
      ...p,
      is_locked: false,
    }));
  }

  const isExpired = authStatus === 'expired';
  const lockedPrompt = isExpired
    ? '🔒 Subscribe to Oddsbanta VIP'
    : '🔒 Register to view Oddsbanta AI predictions';

  return preds.map((p: any) => {
    return {
      ...p,
      is_locked: true,
      predicted_outcome: lockedPrompt,
      probability: null,
      tactical_rationale: null,
      tactical_tag: null,
      settlement_status: 'pending',
      settlement_notes: null,
      ht_score: null,
      actual_score: null,
      metadata: {
        locked: true,
        auth_status: authStatus,
        subscription_required: isExpired,
        registration_required: !isExpired,
        trial_expired: isExpired,
      },
    };
  });
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

  // Rate Limiting (SEC-04): 120 requests per minute per IP (tuned for African mobile CGNAT e.g. MTN, Airtel, Glo)
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`goals-feed:${clientIp}`, 120, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.resetSec),
          'X-RateLimit-Limit': '120',
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
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, s-maxage=30, stale-while-revalidate=60',
    'CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=30',
    'Vercel-CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=30',
    'Vary': 'Authorization, Origin, User-Agent',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  try {
    const now = Date.now();

    // 1. Return fresh in-memory cache if available
    if (memoryCache && now < memoryCache.expiresAt) {
      const preds = isBot
        ? applyGoalsScraperBlinding(memoryCache.data.predictions)
        : !isVipOrAdmin
        ? applyGoalsPaywallRedaction(memoryCache.data.predictions, authStatus)
        : memoryCache.data.predictions;

      const payload = {
        ...memoryCache.data,
        predictions: preds,
        is_scraper_blinded: isBot,
        auth_status: authStatus,
      };
      return new Response(
        JSON.stringify({ success: true, ...payload }),
        { status: 200, headers: responseHeaders }
      );
    }

    // 2. Anti-stampede fetch: deduplicate concurrent in-flight requests
    let feedData: GoalsFeedData;
    if (!inflightPromise) {
      inflightPromise = fetchGoalsFromUpstream()
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

    const preds = isBot
      ? applyGoalsScraperBlinding(feedData.predictions)
      : !isVipOrAdmin
      ? applyGoalsPaywallRedaction(feedData.predictions, authStatus)
      : feedData.predictions;

    const payload = {
      ...feedData,
      predictions: preds,
      is_scraper_blinded: isBot,
      auth_status: authStatus,
    };

    return new Response(
      JSON.stringify({ success: true, ...payload }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err: any) {
    if (!isVipOrAdmin && memoryCache) {
      const preds = isBot
        ? applyGoalsScraperBlinding(memoryCache.data.predictions)
        : applyGoalsPaywallRedaction(memoryCache.data.predictions, authStatus);

      return new Response(
        JSON.stringify({
          success: true,
          ...memoryCache.data,
          predictions: preds,
          is_scraper_blinded: isBot,
          auth_status: authStatus,
          stale: true,
        }),
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
