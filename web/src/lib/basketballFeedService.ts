/**
 * Oddsbanta — Autonomous Basketball Data & Predictions Service Layer
 * Phase 5: Production Client Service & Cloud Supabase Gateway
 * 
 * Fetches basketball predictions, leagues, teams, and settlements from Cloud Supabase.
 * Enforces field-level subscriber paywall gating.
 * Includes authentic fallback models for instant UX fidelity.
 */

import { supabase } from './supabase';
import { getCircuitBreaker, SafeStorage, withTimeout } from './circuitBreaker';
import { getUserTimeZone } from './dateUtils';
import type { LockedTierCounts } from './confidenceScore';
import {
  BasketballPrediction,
  BasketballSecondaryPrediction,
  BasketballLeague,
  BasketballSettlement,
  BasketballConfidenceTier,
  BasketballMarket,
} from '../types/basketball';

export interface BasketballStats {
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
}

export interface BasketballFeedResponse {
  success: boolean;
  is_subscriber: boolean;
  stats: BasketballStats;
  leagues: BasketballLeague[];
  settlements: BasketballSettlement[];
  /** Locked users: per-day tier totals (no tier is sent on a locked match). */
  locked_tier_counts?: LockedTierCounts;
  predictions: BasketballPrediction[];
  cached_at: string;
  error?: string;
}

export interface FetchBasketballFeedOptions {
  league?: string | 'all';
  market?: BasketballMarket | 'all';
  tier?: 'bangers' | 'top_picks' | 'high_confidence' | 'all';
  canViewPredictions?: boolean;
  forceRefresh?: boolean;
}

const CLIENT_CACHE_TTL_MS = 30 * 1000; // 30 seconds fresh client memory cache
const clientMemoryCache = new Map<string, { data: BasketballFeedResponse; timestamp: number }>();
const clientInflightPromises = new Map<string, Promise<BasketballFeedResponse>>();

const PRED_SELECT = `
  id,
  fixture_id,
  market,
  prediction,
  probability,
  confidence_category,
  secondary_predictions,
  metadata,
  simulations_count,
  simulated_home_score,
  simulated_away_score,
  edge_percentage,
  fair_odds,
  market_odds,
  tier_required,
  publication_status,
  target_kickoff_at,
  settlement_status,
  settlement_notes,
  settled_at,
  actual_result,
  fixture:basketball_fixtures!inner(
    id,
    canonical_key,
    target_kickoff_at,
    status,
    home_score,
    away_score,
    period_scores,
    current_period,
    time_remaining,
    market_spread,
    market_total,
    home_moneyline_odds,
    away_moneyline_odds,
    home_rest_days,
    away_rest_days,
    is_home_b2b,
    is_away_b2b,
    league:basketball_leagues!inner(
      id,
      code,
      name,
      country,
      quarter_minutes,
      periods_count,
      default_pace
    ),
    home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(
      id,
      canonical_name,
      short_name,
      city,
      state,
      arena_name,
      altitude_ft,
      offensive_rating,
      defensive_rating,
      net_rating,
      pace,
      four_factors,
      logo_url
    ),
    away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(
      id,
      canonical_name,
      short_name,
      city,
      state,
      arena_name,
      altitude_ft,
      offensive_rating,
      defensive_rating,
      net_rating,
      pace,
      four_factors,
      logo_url
    )
  )
`;

const SETTLE_SELECT = `
  id,
  prediction_id,
  fixture_id,
  status,
  final_home_score,
  final_away_score,
  score_margin,
  total_points,
  was_overtime,
  settlement_logic_version,
  notes,
  settled_at,
  created_at
`;

// Paywall shaping for one prediction (same rules for the live feed and past days).
function gateBasketballPrediction(p: BasketballPrediction, isUnlocked: boolean): BasketballPrediction {
  let parsedSec: BasketballSecondaryPrediction[] = [];
  if (Array.isArray(p.secondary_predictions)) {
    parsedSec = p.secondary_predictions;
  } else if (typeof p.secondary_predictions === 'string') {
    try {
      parsedSec = JSON.parse(p.secondary_predictions);
    } catch {
      parsedSec = [];
    }
  }

  if (isUnlocked) {
    return {
      ...p,
      secondary_predictions: parsedSec,
      is_locked: false,
    };
  }

  // For free visitors, keep settled predictions transparent so historical track record is verified,
  // while masking pre-game unplayed predictions as BigBang VIP teasers.
  const isSettled = p.settlement_status === 'won' || p.settlement_status === 'lost' || p.settlement_status === 'void';
  return {
    ...p,
    prediction: isSettled ? (p.prediction || 'VIP Pick') : '🔒 BigBang VIP Pick',
    probability: isSettled ? p.probability : null,
    // Open picks carry no tier for locked users (the Edge API withholds it); settled ones keep theirs.
    confidence_category: (isSettled ? (p.confidence_category || 'TOP PICK') : 'LOCKED') as BasketballConfidenceTier,
    settlement_status: p.settlement_status || 'pending',
    settlement_notes: p.settlement_notes || null,
    actual_result: p.actual_result || null,
    settled_at: p.settled_at || null,
    simulated_home_score: isSettled ? p.simulated_home_score : null,
    simulated_away_score: isSettled ? p.simulated_away_score : null,
    edge_percentage: isSettled ? p.edge_percentage : null,
    fair_odds: isSettled ? p.fair_odds : null,
    market_odds: isSettled ? p.market_odds : null,
    secondary_predictions: isSettled ? parsedSec : [],
    metadata: isSettled
      ? p.metadata
      : {
          ...p.metadata,
          ai_tactical_analysis:
            '🔒 Basketball predictions and 250,000 Monte Carlo simulations are reserved for BigBang VIP members.',
          simulation: undefined,
        },
    is_locked: !isSettled,
  };
}

const historyDayCache = new Map<string, { data: BasketballPrediction[]; timestamp: number }>();
const HISTORY_CLIENT_TTL_MS = 10 * 60 * 1000;

/**
 * Predictions for one past day (the live feed only holds yesterday onward).
 * Goes through the Edge API only; returns null on any failure (never sample data).
 */
export async function fetchBasketballHistoryDay(date: string, canViewPredictions = false): Promise<BasketballPrediction[] | null> {
  if (typeof window === 'undefined' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const tz = getUserTimeZone();
  const key = `${date}_${tz}_${canViewPredictions ? 'vip' : 'free'}`;
  const hit = historyDayCache.get(key);
  if (hit && Date.now() - hit.timestamp < HISTORY_CLIENT_TTL_MS) return hit.data;
  try {
    const session = (await supabase.auth.getSession()).data.session;
    const reqHeaders: Record<string, string> = { Accept: 'application/json' };
    if (session?.access_token) reqHeaders['Authorization'] = `Bearer ${session.access_token}`;
    // Signed-in requests use their own URL so a shared CDN copy made for visitors is never served to them.
    const authPart = session?.access_token ? '&auth=1' : '';
    const res = await fetch(`/api/basketball-feed?date=${encodeURIComponent(date)}&tz=${encodeURIComponent(tz)}${authPart}`, {
      headers: reqHeaders,
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.success || !Array.isArray(body.predictions)) return null;
    const unlocked = Boolean(canViewPredictions || body.is_subscriber);
    const list = (body.predictions as BasketballPrediction[]).map((p) => gateBasketballPrediction(p, unlocked));
    historyDayCache.set(key, { data: list, timestamp: Date.now() });
    return list;
  } catch {
    return null;
  }
}

export async function fetchBasketballFeed(
  options: FetchBasketballFeedOptions = {}
): Promise<BasketballFeedResponse> {
  const {
    league,
    market,
    tier,
    canViewPredictions = false,
    forceRefresh = false,
  } = options;


  const isUnlocked = Boolean(canViewPredictions);
  const cacheKey = `bball_${league || 'all'}_${market || 'all'}_${tier || 'all'}_${isUnlocked ? 'vip' : 'free'}`;

  // 1. Instant Cache Hit
  const cached = clientMemoryCache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.timestamp < CLIENT_CACHE_TTL_MS) {
    return cached.data;
  }

  // 2. Client-side In-flight Promise Deduplication
  if (!forceRefresh && clientInflightPromises.has(cacheKey)) {
    return clientInflightPromises.get(cacheKey)!;
  }

  const inflight = (async () => {
    try {
    let rawPredictions: BasketballPrediction[] = [];
    let rawLeagues: BasketballLeague[] = [];
    let rawSettlements: BasketballSettlement[] = [];
    let rawLockedTierCounts: LockedTierCounts | undefined;
    let usedEdge = false;

    // 1. Query Edge CDN Proxy first (shields Supabase from thousands of browser calls)
    if (typeof window !== 'undefined') {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const reqHeaders: Record<string, string> = { Accept: 'application/json' };
        if (session?.access_token) {
          reqHeaders['Authorization'] = `Bearer ${session.access_token}`;
        }
        const edgeRes = await fetch(`/api/basketball-feed?tz=${encodeURIComponent(getUserTimeZone())}`, {
          headers: reqHeaders,
          cache: (forceRefresh || Boolean(session?.access_token) || canViewPredictions) ? 'no-cache' : 'default',
        });
        if (edgeRes.ok) {
          const edgeData = await edgeRes.json();
          if (edgeData.success && Array.isArray(edgeData.predictions)) {
            let edgeUnlocked = isUnlocked;
            if (typeof edgeData.is_subscriber === 'boolean') {
              edgeUnlocked = Boolean(canViewPredictions || edgeData.is_subscriber);
            }
            const hasMasked = edgeData.predictions.some(
              (p: any) => p.prediction === '🔒 VIP Locked Prediction' || p.prediction === 'LOCKED' || p.is_locked === true
            );
            if (edgeUnlocked && hasMasked) {
              // Edge returned an anonymous cached payload; fallback directly to unmasked Supabase table
              usedEdge = false;
            } else {
              rawPredictions = edgeData.predictions;
              rawLeagues = edgeData.leagues || [];
              rawSettlements = edgeData.settlements || [];
              rawLockedTierCounts = edgeData.locked_tier_counts || undefined;
              usedEdge = true;
              SafeStorage.set('basketball_feed', {
                predictions: rawPredictions,
                leagues: rawLeagues,
                settlements: rawSettlements,
                locked_tier_counts: rawLockedTierCounts,
              }, 30 * 60 * 1000);
            }
          }
        }
      } catch {
        // Fallback to direct PostgREST if edge unavailable
      }
    }

    if (!usedEdge) {
      // Check resilient persistent cache before hitting database
      const cached = SafeStorage.get<{
        predictions: BasketballPrediction[];
        leagues: BasketballLeague[];
        settlements: BasketballSettlement[];
        locked_tier_counts?: LockedTierCounts;
      }>('basketball_feed');

      if (cached) {
        console.warn('[basketballFeedService] Serving persistent session cache to shield Supabase');
        rawPredictions = cached.predictions || [];
        rawLeagues = cached.leagues || [];
        rawSettlements = cached.settlements || [];
        rawLockedTierCounts = cached.locked_tier_counts;
        usedEdge = true;
      }
    }

    if (!usedEdge) {
      const breaker = getCircuitBreaker('basketball-feed');
      // Locked users never query the database directly: the Edge API is their only door to prediction data.
      if (!isUnlocked || !breaker.canExecute()) {
        if (isUnlocked) console.warn('[basketballFeedService] Circuit breaker OPEN. Shielding Supabase from direct query.');
        rawPredictions = [];
        rawLeagues = [];
        rawSettlements = [];
      } else {
        try {
          const predTable = isUnlocked ? 'basketball_predictions' : 'basketball_predictions_paywall';
          const minDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

          const executeDirect = async () => {
            const predQuery = supabase
              .from(predTable)
              .select(PRED_SELECT)
              .gte('target_kickoff_at', minDate)
              .order('target_kickoff_at', { ascending: true })
              .limit(150);

            return await Promise.all([
              predQuery,
              supabase
                .from('basketball_leagues')
                .select('id,code,name,country,quarter_minutes,periods_count,default_pace')
                .eq('is_active', true)
                .order('name', { ascending: true })
                .limit(50),
              supabase
                .from('basketball_settlements')
                .select(SETTLE_SELECT)
                .order('settled_at', { ascending: false })
                .limit(50),
            ]);
          };

          const [predRes, leaguesRes, settleRes] = await withTimeout(
            executeDirect(),
            breaker.getTimeoutMs(),
            'Basketball direct fallback timed out'
          );

          breaker.recordSuccess();
          rawPredictions = (predRes.data as unknown as BasketballPrediction[]) || [];
          rawLeagues = (leaguesRes.data as BasketballLeague[]) || [];
          rawSettlements = (settleRes.data as BasketballSettlement[]) || [];
        } catch (err) {
          breaker.recordFailure(err);
          rawPredictions = [];
          rawLeagues = [];
          rawSettlements = [];
        }
      }
    }

    // No data means no data: never show invented sample predictions or results.
    rawPredictions = rawPredictions || [];
    rawLeagues = rawLeagues || [];

    // 1b. Cleanse & Deduplicate predictions (Filter TBD placeholders and collapse duplicate match entries)
    const validPredictions = rawPredictions.filter((p) => {
      const homeName = (p.fixture?.home_team?.canonical_name || '').toLowerCase().trim();
      const awayName = (p.fixture?.away_team?.canonical_name || '').toLowerCase().trim();
      const predText = (p.prediction || '').toLowerCase().trim();

      // Filter placeholder / TBD fixtures
      if (homeName === 'tbd' || awayName === 'tbd' || homeName === 'unknown team' || awayName === 'unknown team') {
        return false;
      }
      if (predText.startsWith('tbd') || predText.includes('tbd to win')) {
        return false;
      }
      return true;
    });

    // Deduplicate multiple cards for the exact same physical matchup (defense in depth)
    const matchDedupeMap = new Map<string, BasketballPrediction>();
    for (const p of validPredictions) {
      const homeName = (p.fixture?.home_team?.canonical_name || '').toLowerCase().trim();
      const awayName = (p.fixture?.away_team?.canonical_name || '').toLowerCase().trim();
      const kickoffDate = (p.target_kickoff_at || p.fixture?.target_kickoff_at || '').substring(0, 10);
      const matchKey = `${homeName}_vs_${awayName}_${kickoffDate}`;

      if (!matchDedupeMap.has(matchKey)) {
        matchDedupeMap.set(matchKey, p);
      } else {
        const existing = matchDedupeMap.get(matchKey)!;
        const pSettled = (p.settlement_status || '').toLowerCase();
        const exSettled = (existing.settlement_status || '').toLowerCase();
        const pIsSettled = pSettled === 'won' || pSettled === 'lost' || p.fixture?.status === 'finished';
        const exIsSettled = exSettled === 'won' || exSettled === 'lost' || existing.fixture?.status === 'finished';

        // Prefer settled / finished fixture over pending / scheduled fixture
        if (pIsSettled && !exIsSettled) {
          matchDedupeMap.set(matchKey, p);
        } else if (!pIsSettled && exIsSettled) {
          // keep existing settled match
        } else {
          // If both have same settlement state, prefer WNBA league over NBA mistag, or higher probability
          const pLeague = (p.fixture?.league?.code || '').toUpperCase();
          const exLeague = (existing.fixture?.league?.code || '').toUpperCase();
          if (pLeague === 'WNBA' && exLeague === 'NBA') {
            matchDedupeMap.set(matchKey, p);
          } else if ((p.probability || 0) > (existing.probability || 0)) {
            matchDedupeMap.set(matchKey, p);
          }
        }
      }
    }
    rawPredictions = Array.from(matchDedupeMap.values());

    // 2. Filter predictions by options
    const filteredPredictions = rawPredictions.filter((p) => {
      if (league && league !== 'all') {
        const lCode = p.fixture?.league?.code?.toUpperCase();
        if (lCode !== league.toUpperCase()) return false;
      }
      if (market && market !== 'all') {
        if (p.market !== market) return false;
      }
      if (tier && tier !== 'all') {
        const cTier = (p.confidence_category || '').toLowerCase();
        if (tier === 'bangers' && cTier !== 'banger') return false;
        if (tier === 'top_picks' && cTier !== 'top pick') return false;
        if (tier === 'high_confidence' && cTier !== 'high confidence') return false;
      }
      return true;
    });

    // 3. Map predictions and enforce proper paywall gating
    const finalPredictions: BasketballPrediction[] = filteredPredictions.map((p) => gateBasketballPrediction(p, isUnlocked));

    // 4. Calculate Scorecard & Telemetry Stats (Single source of truth, avoiding double-counting)
    let bangers = 0;
    let topPicks = 0;
    let highConf = 0;
    let settledWon = 0;
    let settledLost = 0;
    let settledVoid = 0;
    const accountedPredIds = new Set<string>();

    for (const p of rawPredictions) {
      const c = (p.confidence_category || '').toUpperCase();
      if (c === 'BANGER') bangers++;
      else if (c === 'TOP PICK' || c === 'TOP_PICK') topPicks++;
      else if (c === 'HIGH CONFIDENCE' || c === 'HIGH_CONFIDENCE') highConf++;

      const st = (p.settlement_status || 'pending').toLowerCase();
      if (st === 'won' || st === 'lost' || st === 'void') {
        accountedPredIds.add(p.id);
        if (st === 'won') settledWon++;
        else if (st === 'lost') settledLost++;
        else if (st === 'void') settledVoid++;
      }
    }

    for (const s of rawSettlements) {
      if (s.prediction_id && !accountedPredIds.has(s.prediction_id)) {
        accountedPredIds.add(s.prediction_id);
        const st = (s.status || '').toLowerCase();
        if (st === 'won') settledWon++;
        else if (st === 'lost') settledLost++;
        else if (st === 'void') settledVoid++;
      }
    }

    const decisive = settledWon + settledLost;
    const winRate = decisive > 0 ? Math.round((settledWon / decisive) * 100) : (settledWon > 0 ? 100 : 0);

    const response: BasketballFeedResponse = {
      success: true,
      is_subscriber: isUnlocked,
      stats: {
        total_matches: rawPredictions.length,
        bangers_count: bangers,
        top_picks_count: topPicks,
        high_confidence_count: highConf,
        leagues_count: rawLeagues.length || 6,
        settled_count: settledWon + (isUnlocked ? settledLost : 0) + (isUnlocked ? settledVoid : 0),
        settled_won: settledWon,
        settled_lost: isUnlocked ? settledLost : 0,
        settled_void: isUnlocked ? settledVoid : 0,
        win_rate: winRate,
      },
      leagues: rawLeagues,
      settlements: rawSettlements,
      ...(rawLockedTierCounts && !isUnlocked ? { locked_tier_counts: rawLockedTierCounts } : {}),
      predictions: finalPredictions,
      cached_at: new Date().toISOString(),
    };

    clientMemoryCache.set(cacheKey, { data: response, timestamp: Date.now() });
    return response;
  } catch (err: any) {
    console.error('Direct Cloud Supabase basketball fetch error:', err);
    return {
      success: false,
      is_subscriber: Boolean(canViewPredictions),
      stats: {
        total_matches: 0,
        bangers_count: 0,
        top_picks_count: 0,
        high_confidence_count: 0,
        leagues_count: 0,
        settled_count: 0,
        settled_won: 0,
        settled_lost: 0,
        settled_void: 0,
        win_rate: 0,
      },
      leagues: [],
      settlements: [],
      predictions: [],
      cached_at: new Date().toISOString(),
      error: err.message || 'Failed to load basketball predictions',
    };
  } finally {
    clientInflightPromises.delete(cacheKey);
  }
  })();

  if (!forceRefresh) {
    clientInflightPromises.set(cacheKey, inflight);
  }

  return inflight;
}

export function clearBasketballFeedCache() {
  clientMemoryCache.clear();
  historyDayCache.clear();
  clientInflightPromises.clear();
}
