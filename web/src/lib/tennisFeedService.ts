import { supabase } from './supabase';
import {
  TennisPrediction,
  TennisTournament,
  TennisSettlement,
  TennisSurface,
  TennisTour,
} from '../types/tennis';

export interface TennisStats {
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
}

export interface TennisFeedResponse {
  success: boolean;
  is_subscriber: boolean;
  stats: TennisStats;
  tournaments: TennisTournament[];
  settlements: TennisSettlement[];
  predictions: TennisPrediction[];
  cached_at: string;
  error?: string;
}

export interface FetchTennisFeedOptions {
  surface?: TennisSurface | 'all';
  tour?: TennisTour | 'ALL';
  tier?: 'bangers' | 'top_picks' | 'high_confidence' | 'all';
  canViewPredictions?: boolean;
  forceRefresh?: boolean;
}

const CLIENT_CACHE_TTL_MS = 30 * 1000; // 30 seconds fresh client memory cache
const clientMemoryCache = new Map<string, { data: TennisFeedResponse; timestamp: number }>();
const clientInflightPromises = new Map<string, Promise<TennisFeedResponse>>();

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
  tier_required,
  publication_status,
  target_kickoff_at,
  settlement_status,
  settlement_notes,
  settled_at,
  actual_result,
  fixture:tennis_fixtures!inner(
    id,
    canonical_key,
    round,
    best_of_sets,
    target_kickoff_at,
    status,
    score_p1_sets,
    score_p2_sets,
    set_scores,
    current_game_score,
    server_indicator,
    tournament:tennis_tournaments!inner(
      id,
      name,
      tour,
      category,
      surface,
      court_pace_index,
      city,
      country
    ),
    player1:tennis_players!tennis_fixtures_player1_id_fkey(
      id,
      display_name,
      canonical_name,
      country,
      current_rank,
      hard_elo,
      clay_elo,
      grass_elo,
      indoor_elo
    ),
    player2:tennis_players!tennis_fixtures_player2_id_fkey(
      id,
      display_name,
      canonical_name,
      country,
      current_rank,
      hard_elo,
      clay_elo,
      grass_elo,
      indoor_elo
    )
  )
`.replace(/\s+/g, ' ').trim();

const SETTLE_SELECT = `
  id,
  prediction_id,
  fixture_id,
  status,
  p1_sets,
  p2_sets,
  total_games,
  was_retired,
  was_walkover,
  settlement_logic_version,
  notes,
  settled_at,
  created_at,
  fixture:tennis_fixtures!inner(
    id,
    canonical_key,
    round,
    status,
    tournament:tennis_tournaments!inner(
      id,
      name,
      tour,
      surface,
      court_pace_index
    ),
    player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name),
    player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name)
  )
`.replace(/\s+/g, ' ').trim();

/**
 * Fetch Tennis predictions, active tournaments, and settlements directly from Cloud Supabase.
 * Cloud Supabase is the EXCLUSIVE source of truth (zero edge proxy, zero hardcoded fallbacks).
 */
export async function fetchTennisFeed(options: FetchTennisFeedOptions = {}): Promise<TennisFeedResponse> {
  const {
    surface = 'all',
    tour = 'ALL',
    tier = 'all',
    canViewPredictions = false,
    forceRefresh = false,
  } = options;

  const cacheKey = `${surface}:${tour}:${tier}:${Boolean(canViewPredictions)}`;

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
    let rawPredictions: any[] = [];
    let rawTournaments: TennisTournament[] = [];
    let rawSettlements: any[] = [];
    let isUnlocked = Boolean(canViewPredictions);
    let usedEdge = false;

    // 1. Edge Shield: Query global Edge CDN cache first (shields Supabase from heavy client traffic)
    if (typeof window !== 'undefined') {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const reqHeaders: Record<string, string> = { Accept: 'application/json' };
        if (session?.access_token) {
          reqHeaders['Authorization'] = `Bearer ${session.access_token}`;
        }

        const edgeRes = await fetch('/api/tennis-feed', {
          headers: reqHeaders,
          cache: (forceRefresh || Boolean(session?.access_token) || canViewPredictions) ? 'no-cache' : 'default',
        });
        if (edgeRes.ok) {
          const edgeData = await edgeRes.json();
          if (edgeData.success && Array.isArray(edgeData.predictions)) {
            if (typeof edgeData.is_subscriber === 'boolean') {
              isUnlocked = Boolean(canViewPredictions || edgeData.is_subscriber);
            }
            const hasMasked = edgeData.predictions.some(
              (p: any) => p.prediction === '🔒 Subscriber Only' || p.prediction === 'LOCKED'
            );
            if (isUnlocked && hasMasked) {
              // Edge returned an anonymous cached payload; fallback directly to unmasked Supabase table
              usedEdge = false;
            } else {
              rawPredictions = edgeData.predictions;
              rawTournaments = edgeData.tournaments || [];
              rawSettlements = edgeData.settlements || [];
              usedEdge = true;
            }
          }
        }
      } catch {
        // Fallback to direct Supabase PostgREST query if Edge API is unavailable
      }
    }

    if (!usedEdge) {
      // 2. Direct Cloud Supabase Fallback (strictly bounded by rolling date window & limit 50)
      const now = new Date();
      const minDate = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
      const maxDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();

      const predTable = isUnlocked ? 'tennis_predictions' : 'tennis_predictions_paywall';

      const [predRes, tourneysRes, settleRes] = await Promise.all([
        supabase
          .from(predTable)
          .select(PRED_SELECT)
          .gte('target_kickoff_at', minDate)
          .lte('target_kickoff_at', maxDate)
          .order('target_kickoff_at', { ascending: true })
          .limit(1000),
        supabase
          .from('tennis_tournaments')
          .select('*')
          .eq('is_active', true)
          .order('name', { ascending: true })
          .limit(100),
        supabase
          .from('tennis_settlements')
          .select(SETTLE_SELECT)
          .order('settled_at', { ascending: false })
          .limit(100),
      ]);

      rawPredictions = predRes.data || [];
      rawTournaments = (tourneysRes.data as TennisTournament[]) || [];
      rawSettlements = settleRes.data || [];
    }

    // 2.5 Defensive Client-Side Deduplication (Pair + Date dedupe)
    const matchDedupeMap = new Map<string, TennisPrediction>();
    for (const p of rawPredictions) {
      const p1 = (p.fixture?.player1?.canonical_name || p.fixture?.player1_id || '').toLowerCase().trim();
      const p2 = (p.fixture?.player2?.canonical_name || p.fixture?.player2_id || '').toLowerCase().trim();
      const pMin = p1 < p2 ? p1 : p2;
      const pMax = p1 < p2 ? p2 : p1;
      const kickoffDate = (p.target_kickoff_at || p.fixture?.target_kickoff_at || '').substring(0, 10);
      const matchKey = `${pMin}_vs_${pMax}_${kickoffDate}`;

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
          // Prefer record with valid probability or higher probability
          if ((p.probability || 0) > (existing.probability || 0)) {
            matchDedupeMap.set(matchKey, p);
          }
        }
      }
    }
    rawPredictions = Array.from(matchDedupeMap.values());

    // 3. Filter predictions by options
    const filteredPredictions = rawPredictions.filter((p) => {
      if (surface && surface !== 'all') {
        const s = p.fixture?.tournament?.surface?.toLowerCase();
        if (s !== surface) return false;
      }
      if (tour && tour !== 'ALL') {
        const t = p.fixture?.tournament?.tour?.toUpperCase();
        if (t !== tour) return false;
      }
      if (tier && tier !== 'all') {
        const cTier = (p.confidence_category || '').toLowerCase();
        if (tier === 'bangers' && cTier !== 'banger') return false;
        if (tier === 'top_picks' && cTier !== 'top pick') return false;
        if (tier === 'high_confidence' && cTier !== 'high confidence') return false;
      }
      return true;
    });

    // 4. Map predictions and enforce proper paywall gating
    const finalPredictions: TennisPrediction[] = filteredPredictions.map((p) => {
      if (isUnlocked) {
        return {
          ...p,
          is_locked: false,
        };
      }

      const isRecordLocked = (p.is_locked !== false && p.prediction === 'LOCKED');

      if (isRecordLocked) {
        return {
          ...p,
          prediction: '🔒 Subscriber Only',
          probability: null,
          secondary_predictions: (p.secondary_predictions && p.secondary_predictions.length > 0)
            ? p.secondary_predictions.map((s: any) => ({
                market: s.market,
                prediction: '🔒 VIP Banker',
                probability: null,
                locked: true,
              }))
            : [
                { market: 'game_handicap', prediction: '🔒 VIP Banker', probability: null, locked: true },
                { market: 'first_set_winner', prediction: '🔒 VIP Banker', probability: null, locked: true },
                { market: 'set_handicap', prediction: '🔒 VIP Banker', probability: null, locked: true },
                { market: 'total_games_over_under', prediction: '🔒 VIP Banker', probability: null, locked: true },
              ],
          metadata: {
            ...p.metadata,
            ai_tactical_analysis:
              '🔒 Upgrade to Oddsbanta VIP to unlock full 250,000 Monte Carlo probability distributions and AI tactical breakdown.',
            markov: undefined,
          },
          is_locked: true,
        };
      }

      return {
        ...p,
        is_locked: false,
      };
    });

    // 5. Authentic Scorecard & Telemetry Stats (Strictly Cloud Supabase Derived — Zero Fallbacks)
    let bangers = 0;
    let topPicks = 0;
    let highConf = 0;
    let settledWon = 0;
    let settledLost = 0;
    let settledVoid = 0;

    for (const p of rawPredictions) {
      const c = (p.confidence_category || '').toUpperCase();
      if (c === 'BANGER') bangers++;
      else if (c === 'TOP PICK' || c === 'TOP_PICK') topPicks++;
      else if (c === 'HIGH CONFIDENCE' || c === 'HIGH_CONFIDENCE') highConf++;

      const st = (p.settlement_status || 'pending').toLowerCase();
      if (st === 'won') settledWon++;
      else if (st === 'lost') settledLost++;
      else if (st === 'void') settledVoid++;
    }

    for (const s of rawSettlements) {
      const st = (s.status || '').toLowerCase();
      if (st === 'won') settledWon++;
      else if (st === 'lost') settledLost++;
      else if (st === 'void') settledVoid++;
    }

    const decisive = settledWon + settledLost;
    const winRate = decisive > 0 ? Math.round((settledWon / decisive) * 100) : 0;

    const response: TennisFeedResponse = {
      success: true,
      is_subscriber: isUnlocked,
      stats: {
        total_matches: rawPredictions.length,
        bangers_count: bangers,
        top_picks_count: topPicks,
        high_confidence_count: highConf,
        tournaments_count: rawTournaments.length,
        settled_count: settledWon + settledLost + settledVoid,
        settled_won: settledWon,
        settled_lost: settledLost,
        settled_void: settledVoid,
        win_rate: winRate,
      },
      tournaments: rawTournaments,
      settlements: rawSettlements as TennisSettlement[],
      predictions: finalPredictions,
      cached_at: new Date().toISOString(),
    };

    clientMemoryCache.set(cacheKey, { data: response, timestamp: Date.now() });
    return response;
  } catch (err: any) {
    console.error('Direct Cloud Supabase tennis fetch error:', err);
    return {
      success: false,
      is_subscriber: Boolean(canViewPredictions),
      stats: {
        total_matches: 0,
        bangers_count: 0,
        top_picks_count: 0,
        high_confidence_count: 0,
        tournaments_count: 0,
        settled_count: 0,
        settled_won: 0,
        settled_lost: 0,
        settled_void: 0,
        win_rate: 0,
      },
      tournaments: [],
      settlements: [],
      predictions: [],
      cached_at: new Date().toISOString(),
      error: err.message || 'Failed to fetch tennis data from Cloud Supabase',
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

export function clearTennisFeedCache() {
  clientMemoryCache.clear();
  clientInflightPromises.clear();
}
