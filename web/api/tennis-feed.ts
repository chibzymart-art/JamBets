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

interface MemoryCacheEntry {
  data: TennisFeedData;
  expiresAt: number;
}

let memoryCache: MemoryCacheEntry | null = null;
let inflightPromise: Promise<TennisFeedData> | null = null;
const CACHE_TTL_MS = 120 * 1000; // 120 seconds memory cache (reduces Supabase upstream load)

// In-memory cache for user auth verification
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

    // Subscriptions: Only BigBang VIP & Admin have access to multi-sport (Tennis)
    if (subRes.ok) {
      const subData = await subRes.json();
      if (Array.isArray(subData) && subData.length > 0) {
        const tier = (subData[0].tier || '').toLowerCase();
        if (['bigbang', 'vip', 'admin'].includes(tier)) {
          isPaid = true;
        }
      }
    }

    // Entitlements: Must be BigBang, VIP, Admin, or have multi-sport/tennis features
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
            feats.tennis === true
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
    console.error('Cryptographic auth check failed in tennis feed:', err);
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

  // Join query for tennis predictions paywall view
  const predSelect = encodeURIComponent(
    '*,fixture:tennis_fixtures(id,canonical_key,round,best_of_sets,target_kickoff_at,status,score_p1_sets,score_p2_sets,set_scores,current_game_score,server_indicator,tournament:tennis_tournaments(id,name,tour,category,surface,court_pace_index),player1:tennis_players!tennis_fixtures_player1_id_fkey(id,display_name,canonical_name,country,current_rank,hard_elo,clay_elo,grass_elo,indoor_elo),player2:tennis_players!tennis_fixtures_player2_id_fkey(id,display_name,canonical_name,country,current_rank,hard_elo,clay_elo,grass_elo,indoor_elo))'
  );

  const settleSelect = encodeURIComponent(
    '*,fixture:tennis_fixtures(id,canonical_key,round,status,score_p1_sets,score_p2_sets,set_scores,tournament:tennis_tournaments(name,tour,surface,court_pace_index),player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name),player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name))'
  );

  const now = new Date();
  const minDate = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const maxDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();

  const [predsRes, tourneysRes, settleRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/tennis_predictions_paywall?select=${predSelect}&target_kickoff_at=gte.${minDate}&target_kickoff_at=lte.${maxDate}&order=target_kickoff_at.asc&limit=1000`,
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
  const winRate = finishedDecisive > 0 ? Math.round((settledWon / finishedDecisive) * 100) : 88.5;

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
  const isAllowed = checkRateLimit(clientIp);
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
      status: 429,
      headers: corsHeaders,
    });
  }

  const authHeader = req.headers.get('Authorization');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim() || null;
  const isPaidOrAdmin = await checkIsPaidOrAdmin(rawToken);

  try {
    let feedData: TennisFeedData;

    // Check shared cache
    const now = Date.now();
    if (memoryCache && now < memoryCache.expiresAt) {
      feedData = memoryCache.data;
    } else {
      if (!inflightPromise) {
        inflightPromise = fetchTennisDataFromUpstream(SUPABASE_SERVICE_ROLE_KEY || null)
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

        // Strict Paywall: Non-paid users ONLY see won games for finished fixtures (never lost, void, or un-won)
        if (!isPaidOrAdmin) {
          const status = (p.settlement_status || '').toLowerCase();
          const isFinished = p.fixture?.status === 'finished' || p.fixture?.status === 'retired' || Boolean(p.settled_at);
          if (status === 'lost' || status === 'void' || status === 'voided' || (isFinished && status !== 'won')) {
            return false;
          }
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

        // Free users & visitors see WON matches unlocked as proof
        const isWon = (p.settlement_status || '').toLowerCase() === 'won';
        if (isWon) {
          return {
            ...p,
            is_locked: false,
          };
        }

        // Masked for Free / Unauthenticated tier
        return {
          ...p,
          prediction: '🔒 Subscriber Only',
          probability: null,
          confidence_category: p.confidence_category === 'BANGER' ? 'BANGER' : 'TOP PICK',
          secondary_predictions: [],
          metadata: {
            ...p.metadata,
            ai_tactical_analysis: '🔒 Upgrade to Oddsbanta VIP to unlock comprehensive 250,000 Monte Carlo simulation distributions and AI tactical breakdown.',
            markov: undefined,
          },
          is_locked: true,
        };
      });

    const sanitizedStats = isPaidOrAdmin ? feedData.stats : {
      ...feedData.stats,
      settled_count: feedData.stats.settled_won,
      settled_lost: 0,
      settled_void: 0,
      win_rate: feedData.stats.settled_won > 0 ? 100 : 0,
    };

    return new Response(
      JSON.stringify({
        success: true,
        is_subscriber: isPaidOrAdmin,
        stats: sanitizedStats,
        tournaments: feedData.tournaments,
        settlements: isPaidOrAdmin ? feedData.settlements : feedData.settlements.filter((s: any) => (s.status || '').toLowerCase() === 'won'),
        predictions: processedPredictions,
        cached_at: feedData.cached_at,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Cache-Control': isPaidOrAdmin
            ? 'private, no-cache, no-store, must-revalidate'
            : 'public, s-maxage=60, stale-while-revalidate=300',
          'CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=60',
          'Vercel-CDN-Cache-Control': isPaidOrAdmin ? 'no-store' : 'public, s-maxage=60',
          'Vary': 'Authorization, Origin',
        },
      }
    );
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
