import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { StandaloneGoalCard, GoalPredictionItem, formatClubName } from '../components/GoalCard';
import { FavoritePredictionItem } from '../components/FavoritesDrawer';
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

export const getTodayIsoDate = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
};

export const getYesterdayIsoDate = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(Date.now() - 86400000));
};

export const getTomorrowIsoDate = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(Date.now() + 86400000));
};

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
      {/* Control Filters Bar */}
      <div className="goals-controls-bar">
        {/* ROW 1: Market Filter Tabs + Favorites Drawer Trigger */}
        <div className="goals-market-tabs-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div className="goals-market-tabs" role="tablist">
            <button
              className={`goals-tab-btn ${marketFilter === 'all' ? 'active' : ''}`}
              onClick={() => setMarketFilter('all')}
            >
              🔥 Split View (Both: {totalFilteredCount})
            </button>
            <button
              className={`goals-tab-btn ${marketFilter === 'over_2.5_goals' ? 'active' : ''}`}
              onClick={() => setMarketFilter('over_2.5_goals')}
            >
              🎯 Over 2.5 Only ({filteredOver25.length})
            </button>
            <button
              className={`goals-tab-btn ${marketFilter === 'ht_over_0.5_goals' ? 'active' : ''}`}
              onClick={() => setMarketFilter('ht_over_0.5_goals')}
            >
              ⏱️ 1H Over 0.5 Only ({filteredHt05.length})
            </button>
            <button
              className={`goals-tab-btn ${marketFilter === 'settled' ? 'active' : ''}`}
              onClick={() => setMarketFilter('settled')}
            >
              ✓ Settled Results
            </button>
          </div>

          {onOpenFavoritesDrawer && (
            <button
              type="button"
              className="goals-fav-drawer-btn"
              onClick={onOpenFavoritesDrawer}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '12px',
                padding: '8px 16px',
                fontSize: '0.84rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(2, 132, 199, 0.25)',
                transition: 'all 0.15s ease'
              }}
            >
              <span>★</span> FAVORITES ({favoriteItems.length})
            </button>
          )}
        </div>

        {/* ROW 2: Date Navigation (Quick Pills + History Dropdown + Search) */}
        <div className="goals-subfilters-row">
          <div className="goals-date-pills">
            <button
              className={`date-pill ${dateFilter === getTodayIsoDate() ? 'active' : ''}`}
              onClick={() => setDateFilter(getTodayIsoDate())}
            >
              📍 Today
            </button>
            <button
              className={`date-pill ${dateFilter === getTomorrowIsoDate() ? 'active' : ''}`}
              onClick={() => setDateFilter(getTomorrowIsoDate())}
            >
              ⏩ Tomorrow
            </button>
            <button
              className={`date-pill ${dateFilter === getYesterdayIsoDate() ? 'active' : ''}`}
              onClick={() => setDateFilter(getYesterdayIsoDate())}
            >
              ⏪ Yesterday
            </button>
            <button
              className={`date-pill ${dateFilter === 'all' ? 'active' : ''}`}
              onClick={() => setDateFilter('all')}
            >
              🌐 All Dates
            </button>

            {/* Comprehensive Date Dropdown including past history and future days */}
            <div className="goals-date-dropdown-box" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <select
                className="goals-date-select"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                style={{
                  background: '#ffffff',
                  border: '1px solid #cbd5e1',
                  borderRadius: '9999px',
                  padding: '5px 12px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  color: '#0f172a',
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="all">📅 Select Date... (All Matches)</option>
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

          <div className="goals-search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search club or league..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="goals-search-input"
            />
            {searchQuery && (
              <button className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>

        {/* ROW 3: Current Day Win / Loss Scorecard Filter Bar */}
        <div className="goals-status-filter-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Result Filter:
          </span>
          <button
            className={`status-pill ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
            style={{
              padding: '4px 12px',
              borderRadius: '8px',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: statusFilter === 'all' ? '1px solid #0f172a' : '1px solid #e2e8f0',
              background: statusFilter === 'all' ? '#0f172a' : '#ffffff',
              color: statusFilter === 'all' ? '#ffffff' : '#334155'
            }}
          >
            All Signals ({statusStats.total})
          </button>
          <button
            className={`status-pill ${statusFilter === 'won' ? 'active' : ''}`}
            onClick={() => setStatusFilter('won')}
            style={{
              padding: '4px 12px',
              borderRadius: '8px',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: statusFilter === 'won' ? '1px solid #059669' : '1px solid #a7f3d0',
              background: statusFilter === 'won' ? '#059669' : '#ecfdf5',
              color: statusFilter === 'won' ? '#ffffff' : '#047857'
            }}
          >
            Won ✅ ({statusStats.won})
          </button>
          <button
            className={`status-pill ${statusFilter === 'lost' ? 'active' : ''}`}
            onClick={() => setStatusFilter('lost')}
            style={{
              padding: '4px 12px',
              borderRadius: '8px',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: statusFilter === 'lost' ? '1px solid #dc2626' : '1px solid #fecaca',
              background: statusFilter === 'lost' ? '#dc2626' : '#fef2f2',
              color: statusFilter === 'lost' ? '#ffffff' : '#b91c1c'
            }}
          >
            Lost ❌ ({statusStats.lost})
          </button>
          <button
            className={`status-pill ${statusFilter === 'pending' ? 'active' : ''}`}
            onClick={() => setStatusFilter('pending')}
            style={{
              padding: '4px 12px',
              borderRadius: '8px',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
              border: statusFilter === 'pending' ? '1px solid #0284c7' : '1px solid #bae6fd',
              background: statusFilter === 'pending' ? '#0284c7' : '#f0f9ff',
              color: statusFilter === 'pending' ? '#ffffff' : '#0369a1'
            }}
          >
            Pending ⏳ ({statusStats.pending})
          </button>
        </div>
      </div>

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
              <div className="goals-column-pane over25-column">
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
                      <StandaloneGoalCard
                        key={pred.id || `${pred.fixture_id}_o25`}
                        prediction={pred}
                        isPaidUser={isPaidUser || idx < 2}
                        onOpenUpgrade={currentUser ? onOpenSubscription : () => onOpenAuth('signin')}
                        onToggleFavoriteItem={onToggleFavoriteItem}
                        isFavoriteItem={isFavoriteItem}
                      />
                    ))
                  )}
                </div>
              </div>
            )}

            {/* RIGHT COLUMN: 1ST HALF OVER 0.5 SPECIALIST FEED */}
            {(marketFilter === 'all' || marketFilter === 'settled' || marketFilter === 'ht_over_0.5_goals') && (
              <div className="goals-column-pane ht05-column">
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
                      <StandaloneGoalCard
                        key={pred.id || `${pred.fixture_id}_ht05`}
                        prediction={pred}
                        isPaidUser={isPaidUser || idx < 2}
                        onOpenUpgrade={currentUser ? onOpenSubscription : () => onOpenAuth('signin')}
                        onToggleFavoriteItem={onToggleFavoriteItem}
                        isFavoriteItem={isFavoriteItem}
                      />
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
