import { checkRateLimit, getClientIp } from './rate-limiter';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';

export type MarketType =
  | 'general'
  | 'curated'
  | 'home_win'
  | 'away_win'
  | 'draw'
  | 'over_2.5_goals'
  | 'ht_over_0.5_goals'
  | 'corners';

export interface UnifiedMarketPrediction {
  id: string;
  fixture_id: string;
  market: string;
  market_category: 'home_win' | 'away_win' | 'draw' | 'goals' | 'corners';
  market_label: string;
  market_icon: string;
  prediction: string;
  probability: number | null;
  display_probability: number | null;
  confidence_tier: string;
  confidence_category: string;
  is_locked: boolean;
  target_kickoff_at: string;
  settlement_status: string;
  settled_at?: string | null;
  actual_score?: string | null;
  settlement_notes?: string | null;
  metrics: Record<string, any>;
  fixture: {
    id: string;
    status: string;
    target_kickoff_at: string;
    home_score?: number | null;
    away_score?: number | null;
    venue?: string | null;
    league?: {
      id?: string;
      name: string;
      code: string;
      country?: string;
    };
    home_team?: {
      id?: string;
      name: string;
      short_name?: string;
    };
    away_team?: {
      id?: string;
      name: string;
      short_name?: string;
    };
  };
}

interface MarketFeedResponse {
  success: boolean;
  market: string;
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  date_filter: string;
  counts: Record<MarketType, number>;
  leagues: Array<{ code: string; name: string }>;
  predictions: UnifiedMarketPrediction[];
  cached_at: string;
}

// In-memory cache for ultra-low latency (< 5ms on cache hit)
interface CacheEntry {
  data: MarketFeedResponse;
  expiresAt: number;
}

const memoryCache = new Map<string, CacheEntry>();
const inflightPromises = new Map<string, Promise<MarketFeedResponse>>();
const CACHE_TTL_MS = 25 * 1000; // 25s edge cache

// Lagos WAT (UTC+1) date helpers
function getLagosDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function getLagosDateFromIso(isoStr?: string | null): string {
  if (!isoStr) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoStr));
}

// Select query fragments for each paywall view
const FIXTURE_JOIN =
  'fixture:football_fixtures!inner(id,status,target_kickoff_at,home_score,away_score,venue,league:football_leagues(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name))';

const SELECTS: Record<string, { table: string; select: string }> = {
  home_win: {
    table: 'home_win_predictions_paywall',
    select: `id,fixture_id,prediction,probability,confidence_category,dominance_tier,home_venue_advantage,home_clean_sheet_prob,xg_home,xg_away,target_kickoff_at,settlement_status,settled_at,actual_score,settlement_notes,is_locked,${FIXTURE_JOIN}`,
  },
  away_win: {
    table: 'away_win_predictions_paywall',
    select: `id,fixture_id,prediction,probability,confidence_category,counter_tier,away_counter_efficiency,away_clean_sheet_prob,target_kickoff_at,settlement_status,settled_at,actual_score,settlement_notes,is_locked,${FIXTURE_JOIN}`,
  },
  draw: {
    table: 'draw_predictions_paywall',
    select: `id,fixture_id,prediction,probability,confidence_category,stalemate_tier,tactical_equilibrium_score,low_scoring_density,target_kickoff_at,settlement_status,settled_at,actual_score,settlement_notes,is_locked,${FIXTURE_JOIN}`,
  },
  corners: {
    table: 'corner_predictions_paywall',
    select: `id,fixture_id,prediction,market,probability,confidence_category,corner_tier,predicted_total_corners,home_corners_avg,away_corners_avg,over_8_5_prob,over_9_5_prob,over_10_5_prob,target_kickoff_at,settlement_status,settled_at,actual_corners,settlement_notes,is_locked,${FIXTURE_JOIN}`,
  },
  goals: {
    table: 'goals_predictions_paywall',
    select: `id,fixture_id,market,predicted_outcome,probability,confidence_tier,xg_combined,home_over25_rate,away_over25_rate,h2h_over25_rate,ht_goal_frequency,avg_first_goal_minute,target_kickoff_at,settlement_status,settled_at,actual_score,ht_score,settlement_notes,metadata,is_locked,${FIXTURE_JOIN}`,
  },
};

function formatClubName(name?: string | null): string {
  if (!name) return 'Club';
  return name.replace(/\b(FC|CF|SC|AC|FK|SK|CD)\b/gi, '').trim() || name;
}

function computeTacticalAnalysis(
  raw: any,
  marketCategory: 'home_win' | 'away_win' | 'draw' | 'goals' | 'corners',
  forcedMarketType?: MarketType
): { tag: string; rationale: string } {
  const meta = raw.metadata || {};
  const rawHome = raw.fixture?.home_team?.short_name || raw.fixture?.home_team?.name || 'Home Club';
  const rawAway = raw.fixture?.away_team?.short_name || raw.fixture?.away_team?.name || 'Away Club';
  const home = formatClubName(rawHome);
  const away = formatClubName(rawAway);

  if (meta.tactical_rationale) {
    let cleanRationale = meta.tactical_rationale.trim();
    if (cleanRationale.length > 0) {
      cleanRationale = cleanRationale.charAt(0).toUpperCase() + cleanRationale.slice(1);
    }
    return {
      tag: meta.goal_tempo || raw.dominance_tier || raw.counter_tier || raw.stalemate_tier || raw.corner_tier || 'TACTICAL SCOUT',
      rationale: cleanRationale,
    };
  }

  if (marketCategory === 'goals') {
    if (raw.market === 'ht_over_0.5_goals' || forcedMarketType === 'ht_over_0.5_goals') {
      const freq = raw.ht_goal_frequency ? Math.round(raw.ht_goal_frequency) : 76;
      return {
        tag: freq >= 80 ? 'EARLY_STRIKE' : 'HIGH_TEMPO',
        rationale: `Aggressive first-half pressing frequency with a ${freq}% historical opening-half strike rate. Both ${home} and ${away} push high numbers into the final third early, creating prime conditions for an initial breakthrough before the 35th minute.`,
      };
    } else {
      const xg = raw.xg_combined ? raw.xg_combined.toFixed(2) : '2.85';
      return {
        tag: Number(xg) >= 3.0 ? 'GOAL_MACHINE' : 'HIGH_TEMPO',
        rationale: `${home} and ${away} exhibit open attacking profiles with ${xg} combined expected goals. Both sides feature proactive transition play and defensive vulnerabilities that strongly favor a high-scoring contest exceeding 2.5 goals.`,
      };
    }
  }

  if (marketCategory === 'home_win') {
    const adv = raw.home_venue_advantage ? Math.round(raw.home_venue_advantage * 100) : 28;
    const cs = raw.home_clean_sheet_prob ? Math.round(raw.home_clean_sheet_prob * 100) : 46;
    return {
      tag: raw.dominance_tier || 'FORTRESS_DOMINANCE',
      rationale: `${home} commands an authoritative venue rating with a +${adv}% Fortress advantage and ${cs}% clean-sheet expectation. ${away}'s defensive transitions struggle under sustained home territory pressure, establishing high home victory conviction.`,
    };
  }

  if (marketCategory === 'away_win') {
    const eff = raw.away_counter_efficiency ? Math.round(raw.away_counter_efficiency * 100) : 34;
    return {
      tag: raw.counter_tier || 'ROAD_COUNTER_CARE',
      rationale: `${away} demonstrates elite transition pace with a +${eff}% road counter efficiency rating against high pressing lines. ${home}'s over-commitment in possession leaves vulnerable space behind, creating clinical counter-attacking opportunities for an away win.`,
    };
  }

  if (marketCategory === 'draw') {
    const eq = raw.tactical_equilibrium_score ? Math.round(raw.tactical_equilibrium_score * 100) : 78;
    const dens = raw.low_scoring_density ? Math.round(raw.low_scoring_density * 100) : 44;
    return {
      tag: raw.stalemate_tier || 'SKELLAM_EQUILIBRIUM',
      rationale: `Zero-Inflated Skellam model identifies intense tactical parity (${eq}% equilibrium) between ${home} and ${away}. Heavy joint density on 0-0 and 1-1 scorelines (${dens}%) confirms low-risk tactical management favoring a shared-points stalemate.`,
    };
  }

  if (marketCategory === 'corners') {
    const corners = raw.predicted_total_corners || '10.2';
    const o85 = raw.over_8_5_prob ? Math.round(raw.over_8_5_prob * 100) : 76;
    return {
      tag: raw.corner_tier || 'SET_PIECE_GLM',
      rationale: `Negative Binomial GLM models sustained wing progression and high crossing deflection volume. Projected at ~${corners} total corners with a ${o85}% Over 8.5 density, wide channel overloads will consistently drive set-piece opportunities.`,
    };
  }

  return {
    tag: 'MODEL_CONSENSUS',
    rationale: `Mathematical distribution models calibrated high edge probability exceeding standard bookmaker variance.`,
  };
}

// Normalizes an engine raw record into the UnifiedMarketPrediction format
function normalizePrediction(
  raw: any,
  marketCategory: 'home_win' | 'away_win' | 'draw' | 'goals' | 'corners',
  forcedMarketType?: MarketType
): UnifiedMarketPrediction {
  const prob = typeof raw.probability === 'number' ? raw.probability : null;
  const displayProb = prob !== null ? Math.round(prob * 100) : null;

  let market = forcedMarketType || marketCategory;
  let marketLabel = 'Specialist Market';
  let marketIcon = '⚡';
  let predictionTitle = raw.prediction || raw.predicted_outcome || 'Prediction';
  let confidenceTier = raw.dominance_tier || raw.counter_tier || raw.stalemate_tier || raw.corner_tier || raw.confidence_tier || 'TOP_PICK';
  let metrics: Record<string, any> = {};

  if (marketCategory === 'home_win') {
    market = 'home_win';
    marketLabel = 'Home Win Dominance';
    marketIcon = '🏠';
    predictionTitle = 'Home Win (1)';
    metrics = {
      home_venue_advantage: raw.home_venue_advantage,
      home_clean_sheet_prob: raw.home_clean_sheet_prob,
      xg_home: raw.xg_home,
      xg_away: raw.xg_away,
    };
  } else if (marketCategory === 'away_win') {
    market = 'away_win';
    marketLabel = 'Away Win Specialist';
    marketIcon = '✈️';
    predictionTitle = 'Away Win (2)';
    metrics = {
      away_counter_efficiency: raw.away_counter_efficiency,
      away_clean_sheet_prob: raw.away_clean_sheet_prob,
    };
  } else if (marketCategory === 'draw') {
    market = 'draw';
    marketLabel = 'Draw Hunter';
    marketIcon = '⚖️';
    predictionTitle = 'Draw (X)';
    metrics = {
      tactical_equilibrium_score: raw.tactical_equilibrium_score,
      low_scoring_density: raw.low_scoring_density,
    };
  } else if (marketCategory === 'corners') {
    market = 'corners';
    marketLabel = 'Corners Specialist';
    marketIcon = '🚩';
    predictionTitle = raw.prediction || 'Over 8.5 Corners';
    metrics = {
      predicted_total_corners: raw.predicted_total_corners,
      home_corners_avg: raw.home_corners_avg,
      away_corners_avg: raw.away_corners_avg,
      over_8_5_prob: raw.over_8_5_prob,
      over_9_5_prob: raw.over_9_5_prob,
      over_10_5_prob: raw.over_10_5_prob,
    };
  } else if (marketCategory === 'goals') {
    if (raw.market === 'ht_over_0.5_goals') {
      market = 'ht_over_0.5_goals';
      marketLabel = '1H Blitz (Over 0.5)';
      marketIcon = '⏱️';
      predictionTitle = '1H Over 0.5 Goals';
    } else {
      market = 'over_2.5_goals';
      marketLabel = 'Over 2.5 Goals';
      marketIcon = '🎯';
      predictionTitle = 'Over 2.5 Goals';
    }
    metrics = {
      xg_combined: raw.xg_combined,
      home_over25_rate: raw.home_over25_rate,
      away_over25_rate: raw.away_over25_rate,
      ht_goal_frequency: raw.ht_goal_frequency,
      avg_first_goal_minute: raw.avg_first_goal_minute,
    };
  }

  const tactical = computeTacticalAnalysis(raw, marketCategory, forcedMarketType);

  return {
    id: raw.id,
    fixture_id: raw.fixture_id,
    market,
    market_category: marketCategory,
    market_label: marketLabel,
    market_icon: marketIcon,
    prediction: predictionTitle,
    probability: prob,
    display_probability: displayProb,
    confidence_tier: confidenceTier,
    confidence_category: (raw.confidence_category || raw.confidence_tier || 'TOP PICK').replace(/_/g, ' '),
    is_locked: Boolean(raw.is_locked),
    target_kickoff_at: raw.target_kickoff_at || raw.fixture?.target_kickoff_at,
    settlement_status: raw.settlement_status || 'pending',
    settled_at: raw.settled_at,
    actual_score: raw.actual_score,
    settlement_notes: raw.settlement_notes,
    metrics,
    tactical_tag: tactical.tag,
    tactical_rationale: tactical.rationale,
    fixture: raw.fixture || {
      id: raw.fixture_id,
      status: 'scheduled',
      target_kickoff_at: raw.target_kickoff_at,
    },
  };
}

async function fetchMarketDataFromUpstream(
  market: MarketType,
  headers: Record<string, string>
): Promise<UnifiedMarketPrediction[]> {
  // 1. Determine which views to query
  if (market === 'curated') {
    // Top edge queries top signals across all 5 engines
    const [hwRes, awRes, drawRes, cornRes, goalsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/${SELECTS.home_win.table}?select=${encodeURIComponent(SELECTS.home_win.select)}&order=probability.desc&limit=25`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/${SELECTS.away_win.table}?select=${encodeURIComponent(SELECTS.away_win.select)}&order=probability.desc&limit=25`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/${SELECTS.draw.table}?select=${encodeURIComponent(SELECTS.draw.select)}&order=probability.desc&limit=25`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/${SELECTS.corners.table}?select=${encodeURIComponent(SELECTS.corners.select)}&order=probability.desc&limit=25`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/${SELECTS.goals.table}?select=${encodeURIComponent(SELECTS.goals.select)}&order=probability.desc&limit=35`, { headers }),
    ]);

    const [hw, aw, dr, cr, gl] = await Promise.all([
      hwRes.ok ? hwRes.json() : [],
      awRes.ok ? awRes.json() : [],
      drawRes.ok ? drawRes.json() : [],
      cornRes.ok ? cornRes.json() : [],
      goalsRes.ok ? goalsRes.json() : [],
    ]);

    const unified: UnifiedMarketPrediction[] = [
      ...hw.map((item: any) => normalizePrediction(item, 'home_win')),
      ...aw.map((item: any) => normalizePrediction(item, 'away_win')),
      ...dr.map((item: any) => normalizePrediction(item, 'draw')),
      ...cr.map((item: any) => normalizePrediction(item, 'corners')),
      ...gl.map((item: any) => normalizePrediction(item, 'goals')),
    ];

    // Deduplicate by fixture_id (keeping highest probability signal per fixture)
    const seenFixtures = new Set<string>();
    const curated: UnifiedMarketPrediction[] = [];
    unified.sort((a, b) => (b.probability || 0) - (a.probability || 0));

    for (const item of unified) {
      if (!seenFixtures.has(item.fixture_id)) {
        seenFixtures.add(item.fixture_id);
        curated.push(item);
      }
    }
    return curated;
  }

  // 2. Specific Engine Query
  let configKey = market;
  if (market === 'over_2.5_goals' || market === 'ht_over_0.5_goals') {
    configKey = 'goals';
  }

  const { table, select } = SELECTS[configKey] || SELECTS.home_win;
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=probability.desc&limit=500`;

  if (market === 'over_2.5_goals') {
    url += '&market=eq.over_2.5_goals';
  } else if (market === 'ht_over_0.5_goals') {
    url += '&market=eq.ht_over_0.5_goals';
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Supabase upstream status: ${res.status}`);
  }

  const rawList = await res.json();
  const category = (configKey === 'goals' ? 'goals' : configKey) as any;
  return rawList.map((item: any) => normalizePrediction(item, category, market));
}

// Computes signal counts across all 6 markets for dynamic badges
async function computeAllMarketCounts(headers: Record<string, string>): Promise<Record<MarketType, number>> {
  try {
    const [hw, aw, dr, cr, gl] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/home_win_predictions?select=id&limit=1000`, { headers }).then((r) => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/away_win_predictions?select=id&limit=1000`, { headers }).then((r) => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/draw_predictions?select=id&limit=1000`, { headers }).then((r) => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/corner_predictions?select=id&limit=1000`, { headers }).then((r) => r.json()),
      fetch(`${SUPABASE_URL}/rest/v1/goals_predictions?select=id,market&limit=1000`, { headers }).then((r) => r.json()),
    ]);

    const hwCount = Array.isArray(hw) ? hw.length : 0;
    const awCount = Array.isArray(aw) ? aw.length : 0;
    const drCount = Array.isArray(dr) ? dr.length : 0;
    const crCount = Array.isArray(cr) ? cr.length : 0;

    let o25Count = 0;
    let ht05Count = 0;
    if (Array.isArray(gl)) {
      for (const item of gl) {
        if (item.market === 'ht_over_0.5_goals') ht05Count++;
        else o25Count++;
      }
    }

    return {
      general: Math.min(20, hwCount + awCount + o25Count),
      curated: Math.min(20, hwCount + awCount + o25Count),
      home_win: hwCount,
      away_win: awCount,
      draw: drCount,
      'over_2.5_goals': o25Count,
      'ht_over_0.5_goals': ht05Count,
      corners: crCount,
    };
  } catch (err) {
    return {
      general: 0,
      curated: 0,
      home_win: 0,
      away_win: 0,
      draw: 0,
      'over_2.5_goals': 0,
      'ht_over_0.5_goals': 0,
      corners: 0,
    };
  }
}

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Rate Limiting: 60 req/min per IP
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`market-feed:${clientIp}`, 60, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': String(rateLimit.resetSec),
        },
      }
    );
  }

  // 2. Parse Query Params
  const url = new URL(req.url);
  const marketParam = (url.searchParams.get('market') || 'general').toLowerCase() as MarketType;
  const dateParam = url.searchParams.get('date') || 'all';
  const leagueParam = url.searchParams.get('league') || '';
  const pageParam = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limitParam = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10)));

  const validMarkets: MarketType[] = [
    'general',
    'curated',
    'home_win',
    'away_win',
    'draw',
    'over_2.5_goals',
    'ht_over_0.5_goals',
    'corners',
  ];
  const activeMarket = validMarkets.includes(marketParam) ? marketParam : 'general';

  const userAuthToken = req.headers.get('Authorization');
  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: userAuthToken || `Bearer ${SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
  };

  const responseHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'public, s-maxage=25, stale-while-revalidate=50',
    'CDN-Cache-Control': 'public, s-maxage=25',
    'Access-Control-Allow-Origin': '*',
  };

  const cacheKey = `${activeMarket}:${dateParam}:${leagueParam}:${pageParam}:${limitParam}:${Boolean(userAuthToken)}`;

  try {
    const now = Date.now();

    // Check memory cache for guest / unauthenticated requests
    if (!userAuthToken) {
      const cached = memoryCache.get(cacheKey);
      if (cached && now < cached.expiresAt) {
        return new Response(JSON.stringify(cached.data), {
          status: 200,
          headers: responseHeaders,
        });
      }
    }

    // 3. Fetch predictions & counts
    let fetchPromise = inflightPromises.get(cacheKey);
    if (!fetchPromise) {
      fetchPromise = (async () => {
        const [allPredictions, counts] = await Promise.all([
          fetchMarketDataFromUpstream(activeMarket, headers),
          computeAllMarketCounts(headers),
        ]);

        // 4. In-Memory Date & League Filtering
        let filtered = allPredictions;

        if (dateParam !== 'all') {
          let targetDateStr = dateParam;
          const todayStr = getLagosDate();
          if (dateParam === 'today') {
            targetDateStr = todayStr;
          } else if (dateParam === 'tomorrow') {
            targetDateStr = getLagosDate(new Date(Date.now() + 86400000));
          } else if (dateParam === 'yesterday') {
            targetDateStr = getLagosDate(new Date(Date.now() - 86400000));
          }

          filtered = filtered.filter((p) => {
            const pDate = getLagosDateFromIso(p.target_kickoff_at);
            return pDate === targetDateStr;
          });
        } else {
          // All dates: current date and future dates, no past dates
          const todayStr = getLagosDate();
          filtered = filtered.filter((p) => {
            const pDate = getLagosDateFromIso(p.target_kickoff_at);
            return !pDate || pDate >= todayStr;
          });
        }

        if (leagueParam) {
          filtered = filtered.filter((p) => {
            const lCode = (p.fixture?.league?.code || '').toLowerCase();
            return lCode === leagueParam.toLowerCase();
          });
        }

        // Collect available leagues
        const leagueMap = new Map<string, string>();
        for (const p of allPredictions) {
          const code = p.fixture?.league?.code;
          const name = p.fixture?.league?.name;
          if (code && name && !leagueMap.has(code)) {
            leagueMap.set(code, name);
          }
        }
        const leagues = Array.from(leagueMap.entries()).map(([code, name]) => ({ code, name }));

        const total = filtered.length;
        const totalPages = Math.ceil(total / limitParam) || 1;
        const offset = (pageParam - 1) * limitParam;
        const paginatedRaw = filtered.slice(offset, offset + limitParam);

        // 5. Apply Freemium 3/7 Redaction Rule for non-VIP visitors
        // On Page 1: picks 0..2 are free & unlocked. Picks 3..9 are locked teaser cards.
        const isVipOrAdmin = Boolean(userAuthToken); // Database view also enforces RLS
        const predictions = paginatedRaw.map((item, idx) => {
          const globalIdx = offset + idx;
          const isSettled = ['won', 'lost', 'void'].includes(item.settlement_status);

          // If paid/admin or settled, always unlocked
          if (isVipOrAdmin || isSettled) {
            return item;
          }

          // Freemium 3/7 Rule: First 3 picks free on page 1
          if (pageParam === 1 && globalIdx < 3) {
            return {
              ...item,
              is_locked: false,
            };
          }

          // Remaining picks are locked teasers
          return {
            ...item,
            is_locked: true,
            prediction: 'LOCKED',
            probability: null,
            display_probability: null,
            confidence_tier: 'LOCKED',
            metrics: {},
          };
        });

        const responsePayload: MarketFeedResponse = {
          success: true,
          market: activeMarket,
          page: pageParam,
          limit: limitParam,
          total,
          total_pages: totalPages,
          has_next: pageParam < totalPages,
          has_prev: pageParam > 1,
          date_filter: dateParam,
          counts,
          leagues,
          predictions,
          cached_at: new Date().toISOString(),
        };

        if (!userAuthToken) {
          memoryCache.set(cacheKey, { data: responsePayload, expiresAt: Date.now() + CACHE_TTL_MS });
        }

        return responsePayload;
      })();

      inflightPromises.set(cacheKey, fetchPromise);
    }

    const data = await fetchPromise;
    inflightPromises.delete(cacheKey);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err: any) {
    inflightPromises.delete(cacheKey);
    console.error('MarketFeed Handler Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal server error in MarketFeed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
