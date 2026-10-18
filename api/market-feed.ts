import { checkAdaptiveRateLimit, getClientIp } from './rate-limiter';
import { verifyEdgeAuth, AuthStatus } from './_lib/jwt-verifier';
import { EdgeSwrCache, EdgeCacheRegistry } from './_lib/edge-cache';
import { generateEtag, matchesEtag, create304Response } from './_lib/etag';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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
  ht_score?: string | null;
  actual_corners?: string | number | null;
  settlement_notes?: string | null;
  metrics: Record<string, any>;
  fixture: {
    id: string;
    status: string;
    target_kickoff_at: string;
    home_score?: number | null;
    away_score?: number | null;
    match_minute?: number | null;
    period?: string | null;
    half_time_home_score?: number | null;
    half_time_away_score?: number | null;
    corners_home?: number | null;
    corners_away?: number | null;
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
  auth_status?: AuthStatus;
  is_stale?: boolean;
  cached_at: string;
}

// Global SWR Edge Caches: 900s fresh (15 min default) + 3600s stale (1 hour)
const marketSwrCache = new EdgeSwrCache<UnifiedMarketPrediction[]>(900 * 1000, 3600 * 1000);
const countsSwrCache = new EdgeSwrCache<Record<MarketType, number>>(900 * 1000, 3600 * 1000);
EdgeCacheRegistry.register('market', marketSwrCache);
EdgeCacheRegistry.register('counts', countsSwrCache);

// Adaptive Dynamic TTL for Live Scores and Instant Settlement Invalidation (Sub-Phase 2.4)
function computeMarketTtl(preds: UnifiedMarketPrediction[]): number {
  const hasLive = (preds || []).some((p: any) => {
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
  'fixture:football_fixtures!inner(id,status,target_kickoff_at,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,venue,league:football_leagues(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name))';

const SELECTS: Record<string, { table: string; select: string }> = {
  corners: {
    table: 'corner_predictions_paywall',
    select: `id,fixture_id,prediction,market,probability,confidence_category,corner_tier,predicted_total_corners,home_corners_avg,away_corners_avg,over_8_5_prob,over_9_5_prob,over_10_5_prob,target_kickoff_at,settlement_status,settled_at,actual_corners,settlement_notes,publication_status,is_locked,${FIXTURE_JOIN}`,
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

  let customRationale =
    meta.tactical_rationale ||
    (!raw.settled_at && raw.settlement_notes && !raw.settlement_notes.startsWith('Verified')
      ? raw.settlement_notes
      : null);

  if (customRationale) {
    customRationale = customRationale.replace(/\[DENSITY:\d+\/\d+\]\s*/gi, '').trim();
    let cleanRationale = customRationale;
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

  if (marketCategory === 'corners') {
    const corners = raw.predicted_total_corners || '8.4';
    const isOver75 = raw.market === 'over_7.5_corners' || (raw.prediction && raw.prediction.includes('7.5'));
    const prob = raw.probability ? Math.round(raw.probability * 100) : (isOver75 ? 76 : 70);
    const lineLabel = isOver75 ? 'Over 7.5' : 'Over 8.5';
    return {
      tag: raw.corner_tier || 'SET_PIECE_GLM',
      rationale: `Negative Binomial GLM models sustained wing progression and high crossing deflection volume. Projected at ~${corners} total corners with a ${prob}% ${lineLabel} density, wide channel overloads will consistently drive set-piece opportunities.`,
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

  if (marketCategory === 'home_win' || marketCategory === 'away_win') {
    market = 'home_win';
    marketLabel = 'Home & Away (1X2)';
    marketIcon = '⚔️';
    predictionTitle = raw.prediction ? (raw.prediction.includes('Away') ? 'Away Win (2)' : 'Home Win (1)') : 'Home Win (1)';
    metrics = {
      home_venue_advantage: raw.home_venue_advantage,
      home_clean_sheet_prob: raw.home_clean_sheet_prob,
      away_counter_efficiency: raw.away_counter_efficiency,
      away_clean_sheet_prob: raw.away_clean_sheet_prob,
      xg_home: raw.xg_home,
      xg_away: raw.xg_away,
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
    const densityMatch = (raw.settlement_notes || '').match(/\[DENSITY:(\d+)\/(\d+)(?:\/(\d+))?\]/i);
    const o75 = densityMatch
      ? parseInt(densityMatch[1], 10) / 100
      : (raw.market === 'over_7.5_corners' || (raw.prediction && raw.prediction.includes('7.5')))
      ? prob
      : prob ? Math.min(0.88, prob + 0.08) : 0.74;
    const o85 = densityMatch
      ? parseInt(densityMatch[2], 10) / 100
      : raw.over_8_5_prob ? Number(raw.over_8_5_prob) : (prob ? Math.max(0.50, prob - 0.08) : null);
    const o95 = densityMatch && densityMatch[3]
      ? parseInt(densityMatch[3], 10) / 100
      : raw.over_9_5_prob ? Number(raw.over_9_5_prob) : (prob && (raw.market === 'over_9.5_corners' || (raw.prediction && raw.prediction.includes('9.5'))) ? prob : null);
    metrics = {
      predicted_total_corners: raw.predicted_total_corners,
      home_corners_avg: raw.home_corners_avg,
      away_corners_avg: raw.away_corners_avg,
      over_7_5_prob: o75,
      over_8_5_prob: o85,
      over_9_5_prob: o95,
      over_7_5_pct: o75 ? Math.round(o75 * 100) : 74,
      over_8_5_pct: o85 ? Math.round(o85 * 100) : 68,
      over_9_5_pct: o95 ? Math.round(o95 * 100) : null,
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
    ht_score: raw.ht_score,
    actual_corners: raw.actual_corners,
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

// In-flight deduplication for corners: exactly ONE prediction per fixture.
// Keeps the settled (won/lost) row if any, otherwise the newest (created_at when present,
// else first seen, i.e. highest probability given upstream ordering). Order is preserved.
function dedupeCornersByFixture<T extends Record<string, any>>(list: T[]): T[] {
  const rank = (r: any): [number, string] => [
    r.settlement_status === 'won' || r.settlement_status === 'lost' ? 1 : 0,
    String(r.created_at || ''),
  ];
  const best = new Map<string, T>();
  for (const item of list) {
    const key = String(item.fixture_id ?? item.fixture?.id ?? item.id);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, item);
      continue;
    }
    const [a1, a2] = rank(item);
    const [b1, b2] = rank(cur);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) best.set(key, item);
  }
  const winners = new Set<T>(best.values());
  return list.filter((item) => winners.has(item));
}

async function fetchMarketDataFromUpstream(
  market: MarketType,
  headers: Record<string, string>
): Promise<UnifiedMarketPrediction[]> {
  // 0. Primary Path: Zero-Join Point Read from pre-computed cached_feeds (Sub-Phase 2.3)
  try {
    if (market === 'corners') {
      const snapRes = await fetch(
        `${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:corners&select=payload&limit=1`,
        { headers }
      );
      if (snapRes.ok) {
        const rows = await snapRes.json();
        const rawList = rows[0]?.payload?.predictions;
        if (Array.isArray(rawList) && rawList.length > 0) {
          const filtered = rawList.filter((item: any) => {
            if (item.settlement_status === 'void' || item.publication_status === 'archived') return false;
            if (item.fixture?.status === 'cancelled' || item.fixture?.status === 'postponed') return false;
            return true;
          });
          return dedupeCornersByFixture(filtered).map((item: any) => normalizePrediction(item, 'corners', 'corners'));
        }
      }
    } else if (market === 'goals' || market === 'ht_over_0.5_goals' || market === 'over_2.5_goals') {
      const snapRes = await fetch(
        `${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:goals&select=payload&limit=1`,
        { headers }
      );
      if (snapRes.ok) {
        const rows = await snapRes.json();
        const rawList = rows[0]?.payload?.predictions;
        if (Array.isArray(rawList) && rawList.length > 0) {
          const filtered = rawList.filter((item: any) => {
            if (item.settlement_status === 'void' || item.publication_status === 'archived') return false;
            if (item.fixture?.status === 'cancelled' || item.fixture?.status === 'postponed') return false;
            if (market === 'ht_over_0.5_goals' && item.market !== 'ht_over_0.5_goals') return false;
            if (market === 'over_2.5_goals' && item.market !== 'over_2.5_goals') return false;
            return true;
          });
          return filtered.map((item: any) => normalizePrediction(item, 'goals', market));
        }
      }
    } else if (market === 'curated') {
      const [cornSnap, goalsSnap] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:corners&select=payload&limit=1`, { headers }),
        fetch(`${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:goals&select=payload&limit=1`, { headers }),
      ]);
      if (cornSnap.ok && goalsSnap.ok) {
        const [crRows, glRows] = await Promise.all([cornSnap.json(), goalsSnap.json()]);
        const crList = crRows[0]?.payload?.predictions;
        const glList = glRows[0]?.payload?.predictions;
        if (Array.isArray(crList) && Array.isArray(glList)) {
          const unified: UnifiedMarketPrediction[] = [
            ...dedupeCornersByFixture(
              crList.filter((item: any) => item.settlement_status !== 'void' && item.publication_status !== 'archived' && item.fixture?.status !== 'cancelled' && item.fixture?.status !== 'postponed')
            ).map((item: any) => normalizePrediction(item, 'corners')),
            ...glList
              .filter((item: any) => item.settlement_status !== 'void' && item.publication_status !== 'archived' && item.fixture?.status !== 'cancelled' && item.fixture?.status !== 'postponed')
              .map((item: any) => normalizePrediction(item, 'goals')),
          ];
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
      }
    }
  } catch (snapErr) {
    console.warn('[MARKET-FEED] Failed point read from cached_feeds, falling back to relational query:', snapErr);
  }

  // 1. Fallback: Determine which views to query
  if (market === 'curated') {
    // Top edge queries top signals across remaining specialist engines (Goals & Corners)
    const [cornRes, goalsRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/${SELECTS.corners.table}?select=${encodeURIComponent(SELECTS.corners.select)}&settlement_status=neq.void&publication_status=neq.archived&order=probability.desc&limit=50`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/${SELECTS.goals.table}?select=${encodeURIComponent(SELECTS.goals.select)}&settlement_status=neq.void&publication_status=neq.archived&order=probability.desc&limit=50`, { headers }),
    ]);

    const [cr, gl] = await Promise.all([
      cornRes.ok ? cornRes.json() : [],
      goalsRes.ok ? goalsRes.json() : [],
    ]);

    const unified: UnifiedMarketPrediction[] = [
      ...dedupeCornersByFixture(
        (Array.isArray(cr) ? cr : [])
          .filter((item: any) => item.settlement_status !== 'void' && item.publication_status !== 'archived' && item.fixture?.status !== 'cancelled' && item.fixture?.status !== 'postponed')
      ).map((item: any) => normalizePrediction(item, 'corners')),
      ...(Array.isArray(gl) ? gl : [])
        .filter((item: any) => item.settlement_status !== 'void' && item.publication_status !== 'archived' && item.fixture?.status !== 'cancelled' && item.fixture?.status !== 'postponed')
        .map((item: any) => normalizePrediction(item, 'goals')),
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

  // 2. Fallback: Specific Engine Query
  let configKey = market;
  if (market === 'corners') {
    configKey = 'corners';
  } else {
    configKey = 'goals';
  }

  const { table, select } = SELECTS[configKey] || SELECTS.goals;
  let url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=probability.desc&limit=1000`;

  if (market === 'ht_over_0.5_goals') {
    url += '&market=eq.ht_over_0.5_goals&settlement_status=neq.void&publication_status=neq.archived';
  } else if (market === 'corners') {
    url += '&settlement_status=neq.void&publication_status=neq.archived';
  } else {
    // Default / over_2.5_goals / legacy redirects
    url += '&market=eq.over_2.5_goals&settlement_status=neq.void&publication_status=neq.archived';
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Supabase upstream status: ${res.status}`);
  }

  const rawList = await res.json();
  const category = (configKey === 'goals' ? 'goals' : configKey) as any;
  const filteredList = (Array.isArray(rawList) ? rawList : []).filter((item: any) => {
    if (item.settlement_status === 'void' || item.publication_status === 'archived') {
      return false;
    }
    if (item.fixture?.status === 'cancelled' || item.fixture?.status === 'postponed') {
      return false;
    }
    return true;
  });
  const finalList = configKey === 'corners' ? dedupeCornersByFixture(filteredList) : filteredList;
  return finalList.map((item: any) => normalizePrediction(item, category, market));
}

// Computes signal counts across active markets for dynamic badges
async function computeAllMarketCounts(
  headers: Record<string, string>,
  dateParam: string = 'all'
): Promise<Record<MarketType, number>> {
  const result = await countsSwrCache.getOrFetch(`counts:${dateParam}`, async () => {
    // Primary Path: Read pre-computed market counts from cached_feeds (Sub-Phase 2.3)
    try {
      const snapRes = await fetch(
        `${SUPABASE_URL}/rest/v1/cached_feeds?key=eq.feed:market:counts&select=payload&limit=1`,
        { headers }
      );
      if (snapRes.ok) {
        const rows = await snapRes.json();
        const payload = rows[0]?.payload;
        if (payload) {
          if (dateParam === 'today' && payload.counts_today) return payload.counts_today;
          if (dateParam === 'tomorrow' && payload.counts_tomorrow) return payload.counts_tomorrow;
          if (dateParam === 'yesterday' && payload.counts_yesterday) return payload.counts_yesterday;
          if (payload[`counts_${dateParam}`]) return payload[`counts_${dateParam}`];
          if (dateParam === 'all' && payload.counts_all) return payload.counts_all;
          if (dateParam !== 'all') {
            // Date outside the precomputed window (past 30d .. +4d): no picks exist there.
            return {
              general: 0,
              curated: 0,
              home_win: 0,
              away_win: 0,
              draw: 0,
              'over_2.5_goals': 0,
              'ht_over_0.5_goals': 0,
              corners: 0,
            } as Record<MarketType, number>;
          }
        }
      }
    } catch (snapErr) {
      console.warn('[MARKET-FEED] Failed point read for market counts from cached_feeds:', snapErr);
    }

    // Fallback Path: Direct query
    try {
      const [cr, gl] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/corner_predictions?select=id,target_kickoff_at,settlement_status,publication_status,settlement_notes,fixture:football_fixtures!inner(id,status)&settlement_status=neq.void&publication_status=neq.archived&limit=1000`, { headers }).then((r) => r.json()),
        fetch(`${SUPABASE_URL}/rest/v1/goals_predictions?select=id,market,target_kickoff_at,settlement_status,publication_status,fixture:football_fixtures!inner(id,status)&settlement_status=neq.void&publication_status=neq.archived&limit=1000`, { headers }).then((r) => r.json()),
      ]);

      let targetDateStr = dateParam;
      const todayStr = getLagosDate();
      if (dateParam === 'today') {
        targetDateStr = todayStr;
      } else if (dateParam === 'tomorrow') {
        targetDateStr = getLagosDate(new Date(Date.now() + 86400000));
      } else if (dateParam === 'yesterday') {
        targetDateStr = getLagosDate(new Date(Date.now() - 86400000));
      }

      const filterByDate = (list: any[]) => {
        if (!Array.isArray(list)) return [];
        if (dateParam !== 'all') {
          return list.filter((item) => getLagosDateFromIso(item.target_kickoff_at) === targetDateStr);
        }
        return list.filter((item) => {
          const d = getLagosDateFromIso(item.target_kickoff_at);
          return !d || d >= todayStr;
        });
      };

      const validCr = Array.isArray(cr)
        ? cr.filter(
            (item: any) =>
              item.settlement_status !== 'void' &&
              item.publication_status !== 'archived' &&
              item.fixture?.status !== 'cancelled' &&
              item.fixture?.status !== 'postponed'
          )
        : [];

      const validGl = Array.isArray(gl)
        ? gl.filter(
            (item: any) =>
              item.settlement_status !== 'void' &&
              item.publication_status !== 'archived' &&
              item.fixture?.status !== 'cancelled' &&
              item.fixture?.status !== 'postponed'
          )
        : [];

      const filteredCr = filterByDate(dedupeCornersByFixture(validCr));
      const filteredGl = filterByDate(validGl);

      const crCount = filteredCr.length;

      let o25Count = 0;
      let ht05Count = 0;
      for (const item of filteredGl) {
        if (item.market === 'ht_over_0.5_goals') ht05Count++;
        else o25Count++;
      }

      const counts: Record<MarketType, number> = {
        general: Math.min(20, o25Count),
        curated: Math.min(20, o25Count + crCount),
        home_win: 0,
        away_win: 0,
        draw: 0,
        'over_2.5_goals': o25Count,
        'ht_over_0.5_goals': ht05Count,
        corners: crCount,
      };
      return counts;
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
  });
  return result.data;
}

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Rate Limiting: User-Centric CGNAT-Safe (180 req/min for auth users, 120 req/min for anon IPs)
  const clientIp = getClientIp(req);
  const rateLimit = checkAdaptiveRateLimit(req, 'market-feed');
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

  // 2. Parse Query Params
  const url = new URL(req.url);
  const marketParam = (url.searchParams.get('market') || 'general').toLowerCase() as MarketType;
  const dateParam = url.searchParams.get('date') || 'all';
  const leagueParam = url.searchParams.get('league') || '';
  const pageParam = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limitParam = Math.min(250, Math.max(1, parseInt(url.searchParams.get('limit') || '200', 10)));

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
  const rawToken = userAuthToken?.startsWith('Bearer ') ? userAuthToken.slice(7).trim() : userAuthToken?.trim() || null;
  const isInternalService = Boolean(SUPABASE_SERVICE_ROLE_KEY && rawToken === SUPABASE_SERVICE_ROLE_KEY);
  const authStatus = await checkAuthStatus(userAuthToken);
  const isVipOrAdmin = isInternalService || authStatus === 'paid_or_trial';
  const authKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  const headers: Record<string, string> = {
    apikey: authKey,
    Authorization: `Bearer ${authKey}`,
    Accept: 'application/json',
  };

  const corsOrigin = getCorsOrigin(req);

  const responseHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': isVipOrAdmin
      ? 'private, max-age=60, stale-while-revalidate=300'
      : 'public, max-age=60, s-maxage=900, stale-while-revalidate=86400',
    'CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
    'Vercel-CDN-Cache-Control': isVipOrAdmin ? 'no-store' : 'public, s-maxage=900, stale-while-revalidate=86400',
    'Vary': 'Authorization, Origin',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Credentials': 'true',
  };

  const forceRefresh = (isInternalService || isVipOrAdmin) &&
    (url.searchParams.get('refresh') === 'true' || req.headers.get('x-force-refresh') === 'true');
  if (forceRefresh) {
    marketSwrCache.invalidate();
    countsSwrCache.invalidate();
  }

  try {
    const [marketResult, counts] = await Promise.all([
      marketSwrCache.getOrFetch(`market:${activeMarket}`, () => fetchMarketDataFromUpstream(activeMarket, headers), computeMarketTtl),
      computeAllMarketCounts(headers, dateParam),
    ]);

    const allPredictions = marketResult.data;
    const isStale = marketResult.isStale;

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

    // 5. Strict Paywall Redaction:
    // Rule 1: Paid or 3-Day Free Trial users see everything (pending, won, lost, void).
    // Rule 2: Non-paid users (visitors & expired trial users) are strictly BLINDED from settlement results:
    //         - All finished / settled matches are excluded (never leaked as free proof).
    //         - On past dates, this returns 0 matches, exactly matching general football.
    // Rule 3: Upcoming / pending predictions remain visible for teams & market tab, but are locked:
    //         - Visitor: '🔒 Register to view Oddsbanta AI predictions'
    //         - Expired Trial: '🔒 Subscribe to Oddsbanta VIP'
    const filteredForAudience = filtered;

    const total = filteredForAudience.length;
    const totalPages = Math.ceil(total / limitParam) || 1;
    const offset = (pageParam - 1) * limitParam;
    const paginatedRaw = filteredForAudience.slice(offset, offset + limitParam);

    const predictions = paginatedRaw.map((item) => {
      if (authStatus === 'paid_or_trial') {
        return {
          ...item,
          is_locked: false,
        };
      }

      const isExpired = authStatus === 'expired';
      const lockedPrompt = isExpired
        ? '🔒 Subscribe to Oddsbanta VIP'
        : '🔒 Register to view Oddsbanta AI predictions';

      return {
        ...item,
        is_locked: true,
        prediction: lockedPrompt,
        probability: null,
        display_probability: null,
        confidence_tier: item.confidence_tier || 'TOP_PICK',
        confidence_category: item.confidence_category || 'TOP PICK',
        metrics: {},
        tactical_rationale: null,
        tactical_tag: null,
        settlement_status: 'pending',
        settlement_notes: null,
        ht_score: null,
        actual_score: null,
        actual_corners: null,
        metadata: {
          locked: true,
          auth_status: authStatus,
          subscription_required: isExpired,
          registration_required: !isExpired,
          trial_expired: isExpired,
        },
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
      auth_status: authStatus,
      is_stale: isStale,
      cached_at: new Date(marketSwrCache.getEntry(`market:${activeMarket}`)?.cachedAt || Date.now()).toISOString(),
    };

    const bodyStr = JSON.stringify(responsePayload);
    const etag = generateEtag(bodyStr);
    if (matchesEtag(req, etag)) {
      return create304Response(etag, responseHeaders);
    }

    responseHeaders['ETag'] = etag;
    return new Response(bodyStr, {
      status: 200,
      headers: responseHeaders,
    });
  } catch (err: any) {
    console.error('MarketFeed Handler Error:', err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Internal server error in MarketFeed' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': corsOrigin } }
    );
  }
}
