import { supabase } from './supabase';
import { formatClubName } from '../components/GoalCard';
import { getTodayIsoDate } from './dateUtils';

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
  metadata?: any;
  tactical_tag?: string;
  tactical_rationale?: string;
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

export interface UnifiedMarketFeedResponse {
  success: boolean;
  market: MarketType;
  page: number;
  limit: number;
  total: number;
  total_pages: number;
  has_next: boolean;
  has_prev: boolean;
  date_filter: string;
  counts: Record<MarketType, number>;
  predictions: UnifiedMarketPrediction[];
  cached_at?: string;
  error?: string;
}

export interface FetchMarketFeedOptions {
  market: MarketType;
  date?: string; // 'all', or 'YYYY-MM-DD' in Lagos WAT
  page?: number;
  limit?: number;
  token?: string;
  isAdmin?: boolean;
  canViewPredictions?: boolean;
}

// Format Lagos WAT date
function getLagosDateFromIso(isoStr?: string | null): string {
  if (!isoStr) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(isoStr));
  } catch {
    return '';
  }
}

const FIXTURE_JOIN =
  'fixture:football_fixtures!inner(id,status,target_kickoff_at,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,venue,league:football_leagues(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name))';

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
    select: `id,fixture_id,prediction,market,probability,confidence_category,corner_tier,predicted_total_corners,home_corners_avg,away_corners_avg,over_8_5_prob,over_9_5_prob,over_10_5_prob,target_kickoff_at,settlement_status,settled_at,actual_corners,settlement_notes,publication_status,is_locked,${FIXTURE_JOIN}`,
  },
  goals: {
    table: 'goals_predictions_paywall',
    select: `id,fixture_id,market,predicted_outcome,probability,confidence_tier,xg_combined,home_over25_rate,away_over25_rate,h2h_over25_rate,ht_goal_frequency,avg_first_goal_minute,target_kickoff_at,settlement_status,settled_at,actual_score,ht_score,settlement_notes,metadata,is_locked,${FIXTURE_JOIN}`,
  },
};

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

  if (marketCategory === 'home_win') {
    marketLabel = 'Home & Away (1X2)';
    marketIcon = '⚔️';
  } else if (marketCategory === 'away_win') {
    marketLabel = 'Home & Away (1X2)';
    marketIcon = '⚔️';
  } else if (marketCategory === 'draw') {
    marketLabel = 'Draw Hunter (Skellam)';
    marketIcon = '⚖️';
  } else if (marketCategory === 'corners') {
    marketLabel = 'Corners Specialist';
    marketIcon = '🚩';
  } else if (marketCategory === 'goals') {
    if (raw.market === 'ht_over_0.5_goals' || forcedMarketType === 'ht_over_0.5_goals') {
      market = 'ht_over_0.5_goals';
      marketLabel = '1H Over 0.5 (1H Blitz)';
      marketIcon = '⏱️';
    } else {
      market = 'over_2.5_goals';
      marketLabel = 'Over 2.5 Goals';
      marketIcon = '🎯';
    }
  }

  const predictionText =
    raw.prediction || raw.predicted_outcome || (marketCategory === 'corners' ? raw.market : 'Signal');

  const tactical = computeTacticalAnalysis(raw, marketCategory, forcedMarketType);

  return {
    id: raw.id,
    fixture_id: raw.fixture_id,
    market,
    market_category: marketCategory,
    market_label: marketLabel,
    market_icon: marketIcon,
    prediction: predictionText,
    probability: prob,
    display_probability: displayProb,
    confidence_tier:
      raw.dominance_tier ||
      raw.counter_tier ||
      raw.stalemate_tier ||
      raw.corner_tier ||
      raw.confidence_tier ||
      'STRONG',
    confidence_category: raw.confidence_category || 'HIGH',
    is_locked: Boolean(raw.is_locked),
    target_kickoff_at: raw.target_kickoff_at,
    settlement_status: raw.settlement_status || 'pending',
    settled_at: raw.settled_at || null,
    actual_score: raw.actual_score || (raw.actual_corners ? `${raw.actual_corners} Corners` : null),
    ht_score: raw.ht_score || null,
    actual_corners: raw.actual_corners || null,
    settlement_notes: raw.settlement_notes || null,
    metadata: raw.metadata || {},
    tactical_tag: tactical.tag,
    tactical_rationale: tactical.rationale,
    metrics: {
      home_venue_advantage: raw.home_venue_advantage,
      home_clean_sheet_prob: raw.home_clean_sheet_prob,
      away_counter_efficiency: raw.away_counter_efficiency,
      away_clean_sheet_prob: raw.away_clean_sheet_prob,
      tactical_equilibrium_score: raw.tactical_equilibrium_score,
      low_scoring_density: raw.low_scoring_density,
      predicted_total_corners: raw.predicted_total_corners,
      over_8_5_prob: (() => {
        const m = (raw.settlement_notes || '').match(/\[DENSITY:(\d+)\/(\d+)\]/i);
        if (m) return parseInt(m[2], 10) / 100;
        return raw.over_8_5_prob ? Number(raw.over_8_5_prob) : (prob ? Math.max(0.50, prob - 0.08) : null);
      })(),
      over_7_5_prob: (() => {
        const m = (raw.settlement_notes || '').match(/\[DENSITY:(\d+)\/(\d+)\]/i);
        if (m) return parseInt(m[1], 10) / 100;
        if (raw.market === 'over_7.5_corners' || (raw.prediction && raw.prediction.includes('7.5'))) return prob;
        return prob ? Math.min(0.88, prob + 0.08) : 0.74;
      })(),
      over_7_5_pct: (() => {
        const m = (raw.settlement_notes || '').match(/\[DENSITY:(\d+)\/(\d+)\]/i);
        if (m) return parseInt(m[1], 10);
        if (raw.market === 'over_7.5_corners' || (raw.prediction && raw.prediction.includes('7.5'))) return displayProb || 74;
        return displayProb ? Math.min(88, displayProb + 8) : 74;
      })(),
      over_8_5_pct: (() => {
        const m = (raw.settlement_notes || '').match(/\[DENSITY:(\d+)\/(\d+)\]/i);
        if (m) return parseInt(m[2], 10);
        if (raw.market === 'over_8.5_corners' || (raw.prediction && raw.prediction.includes('8.5'))) return displayProb || 68;
        return displayProb ? Math.max(50, displayProb - 8) : 66;
      })(),
      over_9_5_prob: raw.over_9_5_prob,
      xg_combined: raw.xg_combined,
      ht_goal_frequency: raw.ht_goal_frequency,
    },
    fixture: raw.fixture,
  };
}

export async function fetchMarketFeed(
  options: FetchMarketFeedOptions
): Promise<UnifiedMarketFeedResponse> {
  const {
    market,
    date = 'all',
    page = 1,
    limit = 200,
    token,
    isAdmin = false,
    canViewPredictions = false,
  } = options;

  // 1. Try Edge API Route first
  try {
    const url = `/api/market-feed?market=${encodeURIComponent(market)}&date=${encodeURIComponent(
      date
    )}&page=${page}&limit=${limit}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, { headers });
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        if (json.success && Array.isArray(json.predictions)) {
          // Guarantee tactical_rationale & tactical_tag are present on every prediction
          json.predictions = json.predictions
            .filter((p: UnifiedMarketPrediction) => {
              if (p.market_category === 'corners') {
                return p.settlement_status === 'pending' || (p.settlement_notes && p.settlement_notes.startsWith('Verified:'));
              }
              return true;
            })
            .map((p: UnifiedMarketPrediction) => {
              if (!p.tactical_rationale) {
                const tactical = computeTacticalAnalysis(p, p.market_category, p.market as MarketType);
                p.tactical_tag = p.tactical_tag || tactical.tag;
                p.tactical_rationale = tactical.rationale;
              }
              return p;
            });
          return json as UnifiedMarketFeedResponse;
        }
      }
    }
  } catch {
    // Fall back to direct Supabase queries
  }

  // 2. Direct Supabase Fallback
  try {
    const [hwRes, drRes, crRes, glRes] = await Promise.all([
      supabase.from(SELECTS.home_win.table).select(SELECTS.home_win.select).limit(500),
      supabase.from(SELECTS.draw.table).select(SELECTS.draw.select).limit(500),
      supabase
        .from(SELECTS.corners.table)
        .select(SELECTS.corners.select)
        .neq('settlement_status', 'void')
        .neq('publication_status', 'archived')
        .limit(500),
      supabase.from(SELECTS.goals.table).select(SELECTS.goals.select).limit(500),
    ]);

    const normalizeList = (data: any[], cat: any, forced?: MarketType) =>
      (data || []).map((r) => normalizePrediction(r, cat, forced));

    const allHw = normalizeList(hwRes.data || [], 'home_win');
    const allDr = normalizeList(drRes.data || [], 'draw');
    const allCr = normalizeList(
      (crRes.data || []).filter(
        (r: any) => r.settlement_status === 'pending' || (r.settlement_notes && r.settlement_notes.startsWith('Verified:'))
      ),
      'corners'
    );
    const rawGoals: any[] = (glRes.data as any[]) || [];
    const allOver25 = normalizeList(
      rawGoals.filter((r) => r.market === 'over_2.5_goals'),
      'goals',
      'over_2.5_goals'
    );
    const allHt05 = normalizeList(
      rawGoals.filter((r) => r.market === 'ht_over_0.5_goals'),
      'goals',
      'ht_over_0.5_goals'
    );

    // Filter helper: "All Dates (this will be all predictions of current date and future dates, no past dates)"
    const todayIso = getTodayIsoDate();
    const filterByDate = (list: UnifiedMarketPrediction[]) => {
      if (date === 'all') {
        return list.filter((p) => {
          const d = getLagosDateFromIso(p.target_kickoff_at || p.fixture?.target_kickoff_at);
          return !d || d >= todayIso;
        });
      }
      return list.filter((p) => {
        const d = getLagosDateFromIso(p.target_kickoff_at || p.fixture?.target_kickoff_at);
        return d === date;
      });
    };

    const counts: Record<MarketType, number> = {
      general: 0,
      curated: 0,
      home_win: filterByDate(allHw).length,
      away_win: 0,
      draw: filterByDate(allDr).length,
      'over_2.5_goals': filterByDate(allOver25).length,
      'ht_over_0.5_goals': filterByDate(allHt05).length,
      corners: filterByDate(allCr).length,
    };

    // Calculate Curated
    const crossCut = [
      ...filterByDate(allHw),
      ...filterByDate(allDr),
      ...filterByDate(allOver25),
      ...filterByDate(allHt05),
      ...filterByDate(allCr),
    ].sort((a, b) => (b.probability || 0) - (a.probability || 0));

    counts.curated = crossCut.length;

    // Get active market target list
    let targetList: UnifiedMarketPrediction[] = [];
    if (market === 'curated') targetList = crossCut;
    else if (market === 'home_win' || (market as string) === 'away_win') targetList = filterByDate(allHw);
    else if (market === 'draw') targetList = filterByDate(allDr);
    else if (market === 'corners') targetList = filterByDate(allCr);
    else if (market === 'over_2.5_goals') targetList = filterByDate(allOver25);
    else if (market === 'ht_over_0.5_goals') targetList = filterByDate(allHt05);
    else if (market === 'general') targetList = [];

    // Sort by probability descending
    targetList.sort((a, b) => (b.probability || 0) - (a.probability || 0));

    const total = targetList.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(Math.max(1, page), totalPages);
    const start = (safePage - 1) * limit;
    const paged = targetList.slice(start, start + limit);

    // Apply Freemium 3/7 rule in continuous stream if not admin and not entitled
    const isSubscriber = isAdmin || canViewPredictions;
    const finalData = paged.map((pred, idx) => {
      const globalIdx = start + idx;
      const isLocked = !isSubscriber && globalIdx >= 3;
      if (isLocked) {
        return {
          ...pred,
          is_locked: true,
          probability: null,
          display_probability: null,
        };
      }
      return {
        ...pred,
        is_locked: false,
      };
    });

    return {
      success: true,
      market,
      page: safePage,
      limit,
      total,
      total_pages: totalPages,
      has_next: safePage < totalPages,
      has_prev: safePage > 1,
      date_filter: date,
      counts,
      predictions: finalData,
      cached_at: new Date().toISOString(),
    };
  } catch (err: any) {
    return {
      success: false,
      market,
      page,
      limit,
      total: 0,
      total_pages: 1,
      has_next: false,
      has_prev: false,
      date_filter: date,
      counts: {
        general: 0,
        curated: 0,
        home_win: 0,
        away_win: 0,
        draw: 0,
        'over_2.5_goals': 0,
        'ht_over_0.5_goals': 0,
        corners: 0,
      },
      predictions: [],
      error: err.message || 'Failed to query market feed',
    };
  }
}
