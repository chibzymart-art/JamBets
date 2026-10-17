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
const CACHE_TTL_MS = 120 * 1000; // 120 seconds edge memory cache (reduces Supabase upstream load)

export type AuthStatus = 'paid_or_trial' | 'expired' | 'visitor';

// In-memory cache for user auth verification (120s for valid users, 30s for invalid)
const userAuthCache = new Map<string, { status: AuthStatus; expiresAt: number }>();

async function checkAuthStatus(authToken: string | null): Promise<AuthStatus> {
  if (!authToken) return 'visitor';
  const rawToken = authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken.trim();
  if (!rawToken) return 'visitor';

  // 1. Direct Service Role Key Match (internal/admin scripts)
  if (SUPABASE_SERVICE_ROLE_KEY && rawToken === SUPABASE_SERVICE_ROLE_KEY) {
    return 'paid_or_trial';
  }

  // 2. Check in-memory cache to eliminate duplicate Supabase Auth roundtrips
  const cached = userAuthCache.get(rawToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.status;
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
      userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + 30 * 1000 });
      return 'visitor';
    }

    const authUser = await authRes.json();
    if (!authUser || !authUser.id) {
      userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + 30 * 1000 });
      return 'visitor';
    }

    // 4. Server-verified role or admin email whitelist
    const email = (authUser.email || '').toLowerCase().trim();
    const metaRole = (authUser.app_metadata?.role || authUser.user_metadata?.role || '').toLowerCase();
    if (
      ['admin', 'standard', 'bigbang', 'vip', 'pro'].includes(metaRole) ||
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

    // 5. Query active subscriptions, entitlements & users table for this verified user
    const [subRes, entRes, userRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&status=eq.active&select=tier&order=created_at.desc&limit=1`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}&select=tier,valid_until,features&order=created_at.desc&limit=1`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=role&limit=1`, { headers }),
    ]);

    // Check users table role
    if (userRes.ok) {
      const userData = await userRes.json();
      if (Array.isArray(userData) && userData.length > 0) {
        const uRole = (userData[0].role || '').toLowerCase();
        if (['admin', 'standard', 'bigbang', 'vip', 'pro'].includes(uRole)) {
          userAuthCache.set(rawToken, { status: 'paid_or_trial', expiresAt: Date.now() + 120 * 1000 });
          return 'paid_or_trial';
        }
      }
    }

    // Check active paid subscriptions
    if (subRes.ok) {
      const subData = await subRes.json();
      if (Array.isArray(subData) && subData.length > 0) {
        const tier = (subData[0].tier || '').toLowerCase();
        if (['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier)) {
          userAuthCache.set(rawToken, { status: 'paid_or_trial', expiresAt: Date.now() + 120 * 1000 });
          return 'paid_or_trial';
        }
      }
    }

    // Check entitlements (active 3-day trial or active entitlement)
    if (entRes.ok) {
      const entData = await entRes.json();
      if (Array.isArray(entData) && entData.length > 0) {
        const ent = entData[0];
        const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : 0;
        const tier = (ent.tier || '').toLowerCase();
        const feats = ent.features || {};
        const isEntAdmin = tier === 'admin' || feats.admin === true;
        const hasVipOrTrial = Boolean(
          tier === 'trial' ||
          ['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier) ||
          feats.trial === true ||
          feats.vip === true ||
          feats.football_predictions === true ||
          feats.simulations === true ||
          feats.all_sports === true ||
          feats.bigbang === true
        );

        if ((isEntAdmin || hasVipOrTrial) && validUntil > Date.now()) {
          userAuthCache.set(rawToken, { status: 'paid_or_trial', expiresAt: Date.now() + 120 * 1000 });
          return 'paid_or_trial';
        }
      }
    }

    // 6. 3-Day Free Trial fallback based on account creation timestamp
    const createdAt = authUser.created_at;
    if (createdAt) {
      const createdMs = new Date(createdAt).getTime();
      const trialDurationMs = 3 * 24 * 60 * 60 * 1000; // 72 hours
      if (Date.now() - createdMs < trialDurationMs) {
        userAuthCache.set(rawToken, { status: 'paid_or_trial', expiresAt: Date.now() + 60 * 1000 });
        return 'paid_or_trial';
      }
    }

    // Authenticated user whose 3-day trial or subscription has expired
    userAuthCache.set(rawToken, { status: 'expired', expiresAt: Date.now() + 120 * 1000 });
    return 'expired';
  } catch (err) {
    console.error('Cryptographic auth verification error:', err);
    return 'visitor';
  }
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
      confidence_category: p.confidence_category || 'TOP_PICK',
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
    confidence_category: p.confidence_category || 'TOP_PICK',
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
  const now = new Date();
  // Anchor live feed to start of yesterday (00:00:00 UTC) through +5 days forward.
  // This guarantees 100% of Yesterday, Today, and upcoming forward fixtures fit within the 1000 limit without truncation.
  // Older historical dates (2 to 30 days ago) are seamlessly loaded on-demand via fetchPastDateArchive.
  const yesterdayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
  const minDate = yesterdayUtc.toISOString();
  const maxDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();

  const selectQuery = encodeURIComponent(
    `id,fixture_id,prediction,market,probability,confidence_category,secondary_predictions,metadata,settlement_status,settlement_notes,settled_at,actual_score,publication_status,simulations_count,target_kickoff_at,tier_required,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name))`
  );

  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

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

  // Rate Limiting (SEC-04): 120 requests per minute per IP (tuned for African mobile CGNAT e.g. MTN, Airtel, Glo)
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`pred-feed:${clientIp}`, 120, 60);
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

  // Scraper Bot Detection (curl, python-requests, scrapers, headless spiders)
  const isBot = !isInternalService && isScraperBot(req);

  const authStatus = isBot ? 'visitor' : await checkAuthStatus(userAuthToken);
  const isPaidOrTrial = authStatus === 'paid_or_trial';

  const corsOrigin = getCorsOrigin(req);
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': isPaidOrTrial
      ? 'private, no-cache, no-store, must-revalidate'
      : 'public, s-maxage=60, stale-while-revalidate=300',
    'CDN-Cache-Control': isPaidOrTrial ? 'no-store' : 'public, s-maxage=60',
    'Vercel-CDN-Cache-Control': isPaidOrTrial ? 'no-store' : 'public, s-maxage=60',
    'Vary': 'Authorization, Origin, User-Agent',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'X-RateLimit-Limit': '120',
    'X-RateLimit-Remaining': String(rateLimit.remaining),
  };

  const cacheKey = `feed:public`;

  try {
    const now = Date.now();

    // 1. Return cached Edge data if fresh (shields Supabase from both guest & VIP queries!)
    const cached = memoryCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      if (isBot) {
        return new Response(
          JSON.stringify({
            success: true,
            predictions: applyScraperBlinding(cached.data.predictions),
            leagues: cached.data.leagues,
            cached_at: cached.data.cached_at,
            auth_status: 'scraper_blinded',
          }),
          { status: 200, headers: responseHeaders }
        );
      }

      const payload = {
        ...cached.data,
        predictions: applyPaywallRedaction(cached.data.predictions, authStatus),
        auth_status: authStatus,
      };
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

    if (isBot) {
      return new Response(
        JSON.stringify({
          success: true,
          predictions: applyScraperBlinding(rawFeed.predictions),
          leagues: rawFeed.leagues,
          cached_at: rawFeed.cached_at,
          auth_status: 'scraper_blinded',
        }),
        { status: 200, headers: responseHeaders }
      );
    }

    const payload = {
      ...rawFeed,
      predictions: applyPaywallRedaction(rawFeed.predictions, authStatus),
      auth_status: authStatus,
    };

    return new Response(
      JSON.stringify({ success: true, ...payload }),
      { status: 200, headers: responseHeaders }
    );
  } catch (err: any) {
    // Fallback: If upstream errors but we have stale cache, serve stale cache
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      if (isBot) {
        return new Response(
          JSON.stringify({
            success: true,
            predictions: applyScraperBlinding(cached.data.predictions),
            leagues: cached.data.leagues,
            cached_at: cached.data.cached_at,
            auth_status: 'scraper_blinded',
            stale: true,
          }),
          { status: 200, headers: responseHeaders }
        );
      }

      const paywalledData = {
        ...cached.data,
        predictions: applyPaywallRedaction(cached.data.predictions, authStatus),
        auth_status: authStatus,
      };
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
