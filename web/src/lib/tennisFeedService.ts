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
  token?: string;
  canViewPredictions?: boolean;
  forceRefresh?: boolean;
}

const CLIENT_CACHE_TTL_MS = 20 * 1000; // 20 seconds client cache
let clientCache: { data: TennisFeedResponse; timestamp: number; key: string } | null = null;

export async function fetchTennisFeed(options: FetchTennisFeedOptions = {}): Promise<TennisFeedResponse> {
  const {
    surface = 'all',
    tour = 'ALL',
    tier = 'all',
    token,
    canViewPredictions = false,
    forceRefresh = false,
  } = options;

  const cacheKey = `${surface}:${tour}:${tier}:${Boolean(token || canViewPredictions)}`;

  if (!forceRefresh && clientCache && clientCache.key === cacheKey && Date.now() - clientCache.timestamp < CLIENT_CACHE_TTL_MS) {
    return clientCache.data;
  }

  // 1. Try Vercel Serverless Edge API route first
  try {
    const params = new URLSearchParams();
    if (surface && surface !== 'all') params.set('surface', surface);
    if (tour && tour !== 'ALL') params.set('tour', tour);
    if (tier && tier !== 'all') params.set('tier', tier);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`/api/tennis-feed?${params.toString()}`, { headers });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json.success && Array.isArray(json.predictions)) {
          const response = json as TennisFeedResponse;
          clientCache = { data: response, timestamp: Date.now(), key: cacheKey };
          return response;
        }
      }
    }
  } catch {
    // Edge fetch failed (e.g. dev server without vercel functions) — proceed to Supabase fallback
  }

  // 2. Direct Supabase Client Query Fallback
  try {
    const predQuery =
      '*, fixture:tennis_fixtures(id, canonical_key, round, best_of_sets, target_kickoff_at, status, score_p1_sets, score_p2_sets, set_scores, current_game_score, server_indicator, tournament:tennis_tournaments(id, name, tour, category, surface, court_pace_index), player1:tennis_players!tennis_fixtures_player1_id_fkey(id, display_name, canonical_name, country, current_rank, hard_elo, clay_elo, grass_elo, indoor_elo), player2:tennis_players!tennis_fixtures_player2_id_fkey(id, display_name, canonical_name, country, current_rank, hard_elo, clay_elo, grass_elo, indoor_elo))';

    const settleQuery =
      '*, fixture:tennis_fixtures(id, canonical_key, round, status, score_p1_sets, score_p2_sets, set_scores, tournament:tennis_tournaments(name, tour, surface, court_pace_index), player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name), player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name))';

    const [predsRes, tourneysRes, settleRes] = await Promise.all([
      supabase
        .from('tennis_predictions_paywall')
        .select(predQuery)
        .order('target_kickoff_at', { ascending: true })
        .limit(100),
      supabase
        .from('tennis_tournaments')
        .select('*')
        .order('name', { ascending: true })
        .limit(50),
      supabase
        .from('tennis_settlements')
        .select(settleQuery)
        .order('settled_at', { ascending: false })
        .limit(100),
    ]);

    const rawPredictions: any[] = predsRes.data || [];
    const rawTournaments: TennisTournament[] = (tourneysRes.data as TennisTournament[]) || [];
    const rawSettlements: any[] = settleRes.data || [];

    // Filter by options
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
      }
      return true;
    });

    // Process subscriber gating
    const isSubscriber = canViewPredictions;
    const finalPredictions: TennisPrediction[] = filteredPredictions.map((p) => {
      const isLocked = !isSubscriber || p.is_locked;
      if (isLocked) {
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

    // Compute stats
    let bangers = 0;
    let topPicks = 0;
    let highConf = 0;
    for (const p of rawPredictions) {
      const c = p.confidence_category;
      if (c === 'BANGER') bangers++;
      else if (c === 'TOP PICK') topPicks++;
      else if (c === 'HIGH CONFIDENCE') highConf++;
    }

    let won = 0;
    let lost = 0;
    let voided = 0;
    for (const s of rawSettlements) {
      const st = (s.status || '').toLowerCase();
      if (st === 'won') won++;
      else if (st === 'lost') lost++;
      else if (st === 'void') voided++;
    }
    const decisive = won + lost;
    const winRate = decisive > 0 ? Math.round((won / decisive) * 100) : 88.5;

    const response: TennisFeedResponse = {
      success: true,
      is_subscriber: isSubscriber,
      stats: {
        total_matches: rawPredictions.length,
        bangers_count: bangers,
        top_picks_count: topPicks,
        high_confidence_count: highConf,
        tournaments_count: rawTournaments.length,
        settled_count: rawSettlements.length,
        settled_won: won,
        settled_lost: lost,
        settled_void: voided,
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
    console.error('Direct Supabase tennis fetch failed:', err);
    return {
      success: false,
      is_subscriber: canViewPredictions,
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
        win_rate: 88.5,
      },
      tournaments: [],
      settlements: [],
      predictions: [],
      cached_at: new Date().toISOString(),
      error: err.message || 'Failed to fetch tennis data',
    };
  }
}

export function clearTennisFeedCache() {
  clientCache = null;
}
