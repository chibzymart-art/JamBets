import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { StandaloneGoalCard, GoalPredictionItem, formatClubName } from '../components/GoalCard';
import { FavoritePredictionItem } from '../components/FavoritesDrawer';
import { updatePageSeo } from '../lib/seo';
import { AdBannerSlot } from '../components/AdBannerSlot';
import { recordSportsSearch } from '../lib/sportsIntentTracker';
import { trackSportsSearchEvent } from '../lib/pixelTracker';
import '../goals.css';

interface GoalsPageProps {
  currentUser: any;
  userRole?: string;
  isAdmin: boolean;
  onOpenAuth: (mode: 'signin' | 'register') => void;
  onOpenSubscription: () => void;
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  isFavoriteItem?: (fixtureId: string, market: string, pick: string) => boolean;
  onOpenFavoritesDrawer?: () => void;
}

import { getTodayIsoDate, getYesterdayIsoDate, getTomorrowIsoDate } from '../lib/dateUtils';

export const GoalsPage: React.FC<GoalsPageProps> = ({
  currentUser,
  userRole,
  isAdmin,
  onOpenAuth,
  onOpenSubscription,
  favoriteItems = [],
  onToggleFavoriteItem,
  isFavoriteItem,
  onOpenFavoritesDrawer,
}) => {
  const [rawPredictions, setRawPredictions] = useState<GoalPredictionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Market filter: 'all' (split view), 'over_2.5_goals' (left only), 'ht_over_0.5_goals' (right only), 'settled'
  const [marketFilter, setMarketFilter] = useState<'all' | 'over_2.5_goals' | 'ht_over_0.5_goals' | 'settled'>('all');

  // Mobile-specific tab switcher when in split/all view
  const [mobileActiveMarket, setMobileActiveMarket] = useState<'over_2.5_goals' | 'ht_over_0.5_goals'>('over_2.5_goals');

  // Status filter: all, won only, lost only, pending only
  const [statusFilter, setStatusFilter] = useState<'all' | 'won' | 'lost' | 'pending'>('all');

  // Default view is always Current Day ("Today")
  const [dateFilter, setDateFilter] = useState<string>(getTodayIsoDate);
  const [searchQuery, setSearchQuery] = useState('');

  // Check if current user has authoritative paid access
  const isPaidUser = useMemo(() => {
    if (isAdmin) return true;
    if (userRole === 'admin' || userRole === 'standard' || userRole === 'bigbang') return true;
    return false;
  }, [isAdmin, userRole]);

  // Fetch Goals Specialist Data
  const fetchGoalsData = async () => {
    try {
      setLoading(true);
      setError(null);

      let data: GoalPredictionItem[] = [];
      // 1. Attempt Edge API first with user auth token
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/goals-feed', { headers });
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const json = await res.json();
            if (json.success && Array.isArray(json.predictions) && json.predictions.length > 0) {
              data = json.predictions;
            }
          }
        }
      } catch {
        // Fallback to direct query
      }

      // 2. Direct Supabase Query Fallback
      if (data.length === 0) {
        const selectQuery = `
          id, fixture_id, market, predicted_outcome, probability, confidence_tier,
          xg_combined, home_over25_rate, away_over25_rate, h2h_over25_rate,
          ht_goal_frequency, avg_first_goal_minute, target_kickoff_at, settlement_status,
          settled_at, actual_score, ht_score, settlement_notes, is_locked, metadata,
          fixture:football_fixtures!inner(
            id, target_kickoff_at, status, period, match_minute,
            home_score, away_score, half_time_home_score, half_time_away_score,
            league:football_leagues!inner(id, name, code, country),
            home_team:football_teams!football_fixtures_home_team_id_fkey(id, name, short_name),
            away_team:football_teams!football_fixtures_away_team_id_fkey(id, name, short_name)
          )
        `;
        const { data: dbData, error: dbErr } = await supabase
          .from('goals_predictions_paywall')
          .select(selectQuery)
          .order('probability', { ascending: false })
          .limit(1000);

        if (dbErr) throw dbErr;
        data = (dbData as any[]) || [];
      }

      setRawPredictions(data);
    } catch (err: any) {
      console.error('Error fetching goals predictions:', err);
      setError(err.message || 'Failed to load goals feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGoalsData();
  }, [isPaidUser]);

  // Dynamic SEO & Structured Data updates based on live predictions
  useEffect(() => {
    if (rawPredictions.length > 0) {
      const o25Count = rawPredictions.filter((p) => p.market === 'over_2.5_goals').length;
      const ht05Count = rawPredictions.filter((p) => p.market === 'ht_over_0.5_goals').length;

      const sampleEvents = rawPredictions.slice(0, 10).map((p) => ({
        homeTeam: formatClubName(p.fixture?.home_team?.short_name || p.fixture?.home_team?.name || p.metadata?.home_team || 'Home'),
        awayTeam: formatClubName(p.fixture?.away_team?.short_name || p.fixture?.away_team?.name || p.metadata?.away_team || 'Away'),
        league: p.fixture?.league?.name || p.metadata?.league || 'Football League',
        kickoff: p.target_kickoff_at || p.fixture?.target_kickoff_at || new Date().toISOString(),
        predictionMarket: p.market === 'over_2.5_goals' ? 'Over 2.5 Goals' : '1st Half Over 0.5 Goals',
        probability: Math.round((p.probability || 0.75) * 100)
      }));

      updatePageSeo({
        title: `🔥 Today's Goals Predictions (${o25Count} Over 2.5 • ${ht05Count} 1H Blitz) — Oddsbanta`,
        description: `Calibrated Over 2.5 Goals & First Half Over 0.5 Blitz predictions for ${rawPredictions.length} matches. Backed by Bayesian Poisson modeling and AI tactical scouting.`,
        canonicalPath: '/goals',
        sportsEvents: sampleEvents
      });
    }
  }, [rawPredictions]);

  // Distinct date list extracted dynamically from actual predictions
  const dynamicDateOptions = useMemo(() => {
    const todayStr = getTodayIsoDate();
    const yesterdayStr = getYesterdayIsoDate();
    const tomorrowStr = getTomorrowIsoDate();

    const dateCounts: Record<string, number> = {};
    for (const p of rawPredictions) {
      const kAt = p.target_kickoff_at || p.fixture?.target_kickoff_at;
      if (!kAt) continue;
      try {
        const dStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Lagos',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(kAt));
        dateCounts[dStr] = (dateCounts[dStr] || 0) + 1;
      } catch {}
    }

    if (!(todayStr in dateCounts)) dateCounts[todayStr] = 0;
    if (!(tomorrowStr in dateCounts)) dateCounts[tomorrowStr] = 0;

    const allDates = Object.keys(dateCounts).sort();
    return allDates.map((isoDate) => {
      let label = isoDate;
      if (isoDate === todayStr) label = 'Today';
      else if (isoDate === tomorrowStr) label = 'Tomorrow';
      else if (isoDate === yesterdayStr) label = 'Yesterday';
      else {
        try {
          const d = new Date(isoDate + 'T12:00:00Z');
          label = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Africa/Lagos',
            weekday: 'short',
            month: 'short',
            day: 'numeric'
          }).format(d);
        } catch {}
      }
      return {
        key: isoDate,
        label,
        count: dateCounts[isoDate] || 0,
        isPast: isoDate < todayStr,
        isToday: isoDate === todayStr,
        isFuture: isoDate > todayStr,
      };
    });
  }, [rawPredictions]);

  // Status statistics for the currently selected date (or all dates)
  const statusStats = useMemo(() => {
    const activePredictions = rawPredictions.filter((p) => {
      if (dateFilter === 'all') return true;
      try {
        const dStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Lagos',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(p.target_kickoff_at || p.fixture?.target_kickoff_at || ''));
        return dStr === dateFilter;
      } catch {
        return false;
      }
    });

    let won = 0;
    let lost = 0;
    let pending = 0;

    for (const p of activePredictions) {
      if (p.settlement_status === 'won') won++;
      else if (p.settlement_status === 'lost') lost++;
      else pending++;
    }

    return {
      total: activePredictions.length,
      won,
      lost,
      pending
    };
  }, [rawPredictions, dateFilter]);

  // Helper filter function
  const filterPredictionItem = (p: GoalPredictionItem): boolean => {
    // 1. Date Filter
    if (dateFilter !== 'all') {
      try {
        const mLagosDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Lagos',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(new Date(p.target_kickoff_at || p.fixture?.target_kickoff_at || ''));
        if (mLagosDate !== dateFilter) return false;
      } catch {
        return false;
      }
    }

    // 2. Status Filter
    if (statusFilter === 'won' && p.settlement_status !== 'won') return false;
    if (statusFilter === 'lost' && p.settlement_status !== 'lost') return false;
    if (statusFilter === 'pending' && p.settlement_status !== 'pending') return false;
    if (marketFilter === 'settled' && p.settlement_status === 'pending') return false;

    // 3. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const f = p.fixture;
      const h = formatClubName(f?.home_team?.short_name || f?.home_team?.name || p.metadata?.home_team || '').toLowerCase();
      const a = formatClubName(f?.away_team?.short_name || f?.away_team?.name || p.metadata?.away_team || '').toLowerCase();
      const l = (f?.league?.name || p.metadata?.league || '').toLowerCase();
      if (!h.includes(q) && !a.includes(q) && !l.includes(q)) return false;
    }

    return true;
  };

  // INDEPENDENT STREAM 1: Over 2.5 Goals (Left Side Column)
  const filteredOver25 = useMemo(() => {
    return rawPredictions
      .filter((p) => p.market === 'over_2.5_goals')
      .filter(filterPredictionItem)
      .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
  }, [rawPredictions, dateFilter, statusFilter, marketFilter, searchQuery]);

  // INDEPENDENT STREAM 2: 1st Half Over 0.5 Goals (Right Side Column)
  const filteredHt05 = useMemo(() => {
    return rawPredictions
      .filter((p) => p.market === 'ht_over_0.5_goals')
      .filter(filterPredictionItem)
      .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
  }, [rawPredictions, dateFilter, statusFilter, marketFilter, searchQuery]);

  const totalFilteredCount = filteredOver25.length + filteredHt05.length;

  return (
    <div className="goals-page-container">
      {/* UNIFIED 2-TIER COMMAND ISLAND */}
      <div className="goals-command-island">
        {/* TIER 1: Market Selector + Search + Acca Slip Launcher */}
        <div className="command-tier-primary">
          <div className="goals-market-segmented-pill" role="tablist">
            <button
              type="button"
              className={`segmented-market-btn ${marketFilter === 'all' ? 'active' : ''}`}
              onClick={() => setMarketFilter('all')}
            >
              🔥 Split View <span className="market-count-tag">{totalFilteredCount}</span>
            </button>
            <button
              type="button"
              className={`segmented-market-btn o25 ${marketFilter === 'over_2.5_goals' ? 'active' : ''}`}
              onClick={() => setMarketFilter('over_2.5_goals')}
            >
              🎯 Over 2.5 <span className="market-count-tag">{filteredOver25.length}</span>
            </button>
            <button
              type="button"
              className={`segmented-market-btn ht05 ${marketFilter === 'ht_over_0.5_goals' ? 'active' : ''}`}
              onClick={() => setMarketFilter('ht_over_0.5_goals')}
            >
              ⏱️ 1H Blitz <span className="market-count-tag">{filteredHt05.length}</span>
            </button>
            <button
              type="button"
              className={`segmented-market-btn ${marketFilter === 'settled' ? 'active' : ''}`}
              onClick={() => setMarketFilter('settled')}
            >
              ✓ Settled
            </button>
          </div>

          <div className="command-tier-primary-right">
            <div className="goals-compact-search">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search club or league..."
                value={searchQuery}
                onChange={(e) => {
                  const q = e.target.value;
                  setSearchQuery(q);
                  if (q.trim().length >= 3) {
                    recordSportsSearch(q);
                    trackSportsSearchEvent(q, filteredOver25.length + filteredHt05.length);
                  }
                }}
                className="compact-search-input"
              />
              {searchQuery && (
                <button className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
              )}
            </div>

            {onOpenFavoritesDrawer && (
              <button
                type="button"
                className={`goals-acca-slip-launcher-btn ${favoriteItems.length > 0 ? 'has-items' : ''}`}
                onClick={onOpenFavoritesDrawer}
              >
                <span className="slip-icon">📋</span>
                <span className="slip-title">ACCA SLIP</span>
                <span className="slip-badge">{favoriteItems.length}</span>
              </button>
            )}
          </div>
        </div>

        {/* TIER 2: Calendar Ribbon + Inline Status Scorecard Pills */}
        <div className="command-tier-secondary">
          <div className="calendar-ribbon">
            <button
              type="button"
              className={`cal-pill ${dateFilter === getTodayIsoDate() ? 'active' : ''}`}
              onClick={() => setDateFilter(getTodayIsoDate())}
            >
              📍 Today
            </button>
            <button
              type="button"
              className={`cal-pill ${dateFilter === getTomorrowIsoDate() ? 'active' : ''}`}
              onClick={() => setDateFilter(getTomorrowIsoDate())}
            >
              ⏩ Tomorrow
            </button>
            <button
              type="button"
              className={`cal-pill ${dateFilter === getYesterdayIsoDate() ? 'active' : ''}`}
              onClick={() => setDateFilter(getYesterdayIsoDate())}
            >
              ⏪ Yesterday
            </button>
            <button
              type="button"
              className={`cal-pill ${dateFilter === 'all' ? 'active' : ''}`}
              onClick={() => setDateFilter('all')}
            >
              🌐 All Dates
            </button>

            <div className="cal-dropdown-wrap">
              <select
                className="cal-date-select"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              >
                <option value="all">📅 Date Filter... ({totalFilteredCount} signals)</option>
                <optgroup label="Core Days">
                  <option value={getTodayIsoDate()}>📍 Today</option>
                  <option value={getTomorrowIsoDate()}>⏩ Tomorrow</option>
                  <option value={getYesterdayIsoDate()}>⏪ Yesterday</option>
                </optgroup>
                <optgroup label="Available Matchdays">
                  {dynamicDateOptions.map((opt) => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label} ({opt.count} signals)
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          <div className="status-scorecard-ribbon">
            <button
              type="button"
              className={`scorecard-pill ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All ({statusStats.total})
            </button>
            <button
              type="button"
              className={`scorecard-pill won ${statusFilter === 'won' ? 'active' : ''}`}
              onClick={() => setStatusFilter('won')}
            >
              Won ✅ ({statusStats.won})
            </button>
            <button
              type="button"
              className={`scorecard-pill lost ${statusFilter === 'lost' ? 'active' : ''}`}
              onClick={() => setStatusFilter('lost')}
            >
              Lost ❌ ({statusStats.lost})
            </button>
            <button
              type="button"
              className={`scorecard-pill pending ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              Pending ⏳ ({statusStats.pending})
            </button>
          </div>
        </div>
      </div>

      {/* Mobile-Only Segmented Market Switcher */}
      {marketFilter === 'all' && (
        <div className="mobile-market-tab-bar">
          <button
            type="button"
            className={`mobile-tab-btn ${mobileActiveMarket === 'over_2.5_goals' ? 'active o25' : ''}`}
            onClick={() => setMobileActiveMarket('over_2.5_goals')}
          >
            🎯 Over 2.5 Specialist ({filteredOver25.length})
          </button>
          <button
            type="button"
            className={`mobile-tab-btn ${mobileActiveMarket === 'ht_over_0.5_goals' ? 'active ht05' : ''}`}
            onClick={() => setMobileActiveMarket('ht_over_0.5_goals')}
          >
            ⏱️ 1H Blitz Specialist ({filteredHt05.length})
          </button>
        </div>
      )}

      {/* Split Columns Section: Left = Over 2.5, Right = 1H Over 0.5 */}
      <section className="goals-cards-section">
        {loading ? (
          <div className="goals-loading-state">
            <div className="goals-spinner" />
            <p>Loading Calibrated Goals Predictions...</p>
          </div>
        ) : error ? (
          <div className="goals-error-state">
            <p>⚠️ {error}</p>
            <button className="goals-retry-btn" onClick={fetchGoalsData}>Retry</button>
          </div>
        ) : (filteredOver25.length === 0 && filteredHt05.length === 0) ? (
          <div className="goals-empty-state">
            <span className="empty-icon">⚽</span>
            <h3>No Matches Found</h3>
            <p>No games matched your current filters. Try selecting "All Dates" or resetting filters.</p>
            <button
              className="reset-filter-btn"
              onClick={() => {
                setMarketFilter('all');
                setStatusFilter('all');
                setDateFilter('all');
                setSearchQuery('');
              }}
            >
              Reset Filters (View All)
            </button>
          </div>
        ) : (
          <div className={`goals-split-layout ${marketFilter !== 'all' && marketFilter !== 'settled' ? 'single-column-mode' : ''}`}>
            {/* LEFT COLUMN: OVER 2.5 GOALS SPECIALIST FEED */}
            {(marketFilter === 'all' || marketFilter === 'settled' || marketFilter === 'over_2.5_goals') && (
              <div className={`goals-column-pane over25-column ${marketFilter === 'all' && mobileActiveMarket !== 'over_2.5_goals' ? 'mobile-hidden' : ''}`}>
                <div className="goals-column-header over25-header">
                  <div className="col-header-left">
                    <span className="col-header-icon">🎯</span>
                    <h3 className="col-header-title">Over 2.5 Goals Specialist</h3>
                  </div>
                  <span className="col-header-badge over25-pill">
                    {filteredOver25.length} Signals
                  </span>
                </div>

                <div className="goals-column-cards">
                  {filteredOver25.length === 0 ? (
                    <div className="column-empty-notice">
                      <p>No Over 2.5 signals found for selected filters.</p>
                    </div>
                  ) : (
                    filteredOver25.map((pred, idx) => (
                      <React.Fragment key={pred.id || `${pred.fixture_id}_o25`}>
                        <StandaloneGoalCard
                          prediction={pred}
                          isPaidUser={isPaidUser || idx < 2}
                          onOpenUpgrade={currentUser ? onOpenSubscription : () => onOpenAuth('signin')}
                          onToggleFavoriteItem={onToggleFavoriteItem}
                          isFavoriteItem={isFavoriteItem}
                        />
                        {idx === 1 && (
                          <AdBannerSlot slotType="native-card" />
                        )}
                      </React.Fragment>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* RIGHT COLUMN: 1ST HALF OVER 0.5 SPECIALIST FEED */}
            {(marketFilter === 'all' || marketFilter === 'settled' || marketFilter === 'ht_over_0.5_goals') && (
              <div className={`goals-column-pane ht05-column ${marketFilter === 'all' && mobileActiveMarket !== 'ht_over_0.5_goals' ? 'mobile-hidden' : ''}`}>
                <div className="goals-column-header ht05-header">
                  <div className="col-header-left">
                    <span className="col-header-icon">⏱️</span>
                    <h3 className="col-header-title">1st Half Over 0.5 Specialist</h3>
                  </div>
                  <span className="col-header-badge ht05-pill">
                    {filteredHt05.length} Signals
                  </span>
                </div>

                <div className="goals-column-cards">
                  {filteredHt05.length === 0 ? (
                    <div className="column-empty-notice">
                      <p>No 1st Half Over 0.5 signals found for selected filters.</p>
                    </div>
                  ) : (
                    filteredHt05.map((pred, idx) => (
                      <React.Fragment key={pred.id || `${pred.fixture_id}_ht05`}>
                        <StandaloneGoalCard
                          prediction={pred}
                          isPaidUser={isPaidUser || idx < 2}
                          onOpenUpgrade={currentUser ? onOpenSubscription : () => onOpenAuth('signin')}
                          onToggleFavoriteItem={onToggleFavoriteItem}
                          isFavoriteItem={isFavoriteItem}
                        />
                        {idx === 2 && (
                          <AdBannerSlot slotType="native-card" />
                        )}
                      </React.Fragment>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
