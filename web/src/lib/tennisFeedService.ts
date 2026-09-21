import { supabase } from './supabase';
import {
  TennisPrediction,
  TennisTournament,
  TennisSettlement,
  TennisSurface,
  TennisTour,
  TennisConfidenceTier,
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

const CLIENT_CACHE_TTL_MS = 15 * 1000; // 15 seconds memory cache
let clientCache: { data: TennisFeedResponse; timestamp: number; key: string } | null = null;

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

  if (!forceRefresh && clientCache && clientCache.key === cacheKey && Date.now() - clientCache.timestamp < CLIENT_CACHE_TTL_MS) {
    return clientCache.data;
  }

  try {
    // 1. Direct Cloud Supabase Query: Choose table based on user entitlement
    // Subscribed users/Admins query tennis_predictions for full unredacted predictions.
    // Anonymous/Free visitors query tennis_predictions_paywall for safe masked teasers.
    let rawPredictions: any[] = [];
    let isUnlocked = Boolean(canViewPredictions);

    if (isUnlocked) {
      const { data, error } = await supabase
        .from('tennis_predictions')
        .select(PRED_SELECT)
        .order('target_kickoff_at', { ascending: true })
        .limit(200);

      if (!error && Array.isArray(data) && data.length > 0) {
        rawPredictions = data;
      } else {
        // Fallback to paywall view if direct query returned empty due to session sync
        const fallbackRes = await supabase
          .from('tennis_predictions_paywall')
          .select(PRED_SELECT)
          .order('target_kickoff_at', { ascending: true })
          .limit(200);
        rawPredictions = fallbackRes.data || [];
      }
    } else {
      const { data, error } = await supabase
        .from('tennis_predictions_paywall')
        .select(PRED_SELECT)
        .order('target_kickoff_at', { ascending: true })
        .limit(200);

      if (error) {
        console.warn('Error querying tennis_predictions_paywall:', error.message);
      }
      rawPredictions = data || [];
    }

    // 2. Query Tournaments & Settlements directly from Cloud Supabase
    const [tourneysRes, settleRes] = await Promise.all([
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

    const rawTournaments: TennisTournament[] = (tourneysRes.data as TennisTournament[]) || [];
    const rawSettlements: any[] = settleRes.data || [];

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
      const isRecordLocked = !isUnlocked && (p.is_locked !== false && p.prediction === 'LOCKED');

      if (isRecordLocked) {
        return {
          ...p,
          prediction: '🔒 Subscriber Only',
          probability: null,
          confidence_category: (p.confidence_category === 'BANGER' ? 'BANGER' : 'TOP PICK') as TennisConfidenceTier,
          secondary_predictions: [],
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

    clientCache = { data: response, timestamp: Date.now(), key: cacheKey };
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
  }
}

export function clearTennisFeedCache() {
  clientCache = null;
}
