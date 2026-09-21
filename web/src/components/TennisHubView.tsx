import React, { useState, useEffect, useMemo } from 'react';
import { fetchTennisFeed, TennisFeedResponse } from '../lib/tennisFeedService';
import { TennisPrediction } from '../types/tennis';
import {
  getDateDetailsByOffset,
  getPastDatesList,
  getFixtureWatDate,
} from '../lib/dateUtils';
import { TennisPredictionCard } from './TennisPredictionCard';
import { LeftSidebarAd } from './LeftSidebarAd';
import { WatchlistSidebar } from './WatchlistSidebar';
import { FavoritePredictionItem } from './FavoritesDrawer';

export interface TennisHubViewProps {
  currentUser?: any;
  userRole?: string;
  isAdmin?: boolean;
  canViewPredictions?: boolean;
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  isFavoriteItem?: (fixtureId: string, market: string, pick: string) => boolean;
  onOpenFavoritesDrawer?: () => void;
  onOpenAuth?: (mode: 'signin' | 'register') => void;
  onOpenSubscription?: () => void;
  onBackToFootball?: () => void;
}

export const TennisHubView: React.FC<TennisHubViewProps> = ({
  currentUser: _currentUser = null,
  isAdmin = false,
  canViewPredictions = false,
  favoriteItems = [],
  onToggleFavoriteItem,
  isFavoriteItem,
  onOpenFavoritesDrawer,
  onOpenAuth,
  onOpenSubscription,
  onBackToFootball,
}) => {
  const [selectedTournament, setSelectedTournament] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(() => getDateDetailsByOffset(0).iso);
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'void'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [feedData, setFeedData] = useState<TennisFeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSubscriber = isAdmin || canViewPredictions;

  // Format today's date in Lagos WAT (UTC+1) matching football scorecard
  const watDateStr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Lagos',
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date());
    } catch {
      return 'Today';
    }
  }, []);

  const loadFeed = async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchTennisFeed({
        canViewPredictions: isSubscriber,
        forceRefresh: force,
      });
      setFeedData(res);
      if (!res.success && res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load tennis predictions feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed(false);
  }, [isSubscriber]);

  // Dynamic filter options & predictions list
  const allPredictions = feedData?.predictions || [];
  const tournaments = feedData?.tournaments || [];

  // Dynamic Lagos (WAT / UTC+1) relative calendar dates
  const dynamicDateTabs = useMemo(() => {
    // Map prediction counts by WAT kickoff date
    const fixtureCountByDate = new Map<string, number>();
    allPredictions.forEach((p) => {
      const kickoff = p.target_kickoff_at || p.fixture?.target_kickoff_at;
      const d = getFixtureWatDate(kickoff);
      if (d) {
        fixtureCountByDate.set(d, (fixtureCountByDate.get(d) || 0) + 1);
      }
    });

    const yesterday = getDateDetailsByOffset(-1);
    const today = getDateDetailsByOffset(0);
    const day1 = getDateDetailsByOffset(1);
    const day2 = getDateDetailsByOffset(2);
    const day3 = getDateDetailsByOffset(3);

    // Past dates list (last 30 days plus any fixture dates before today)
    const rawPastDates = getPastDatesList(30, Array.from(fixtureCountByDate.keys()));
    const pastDates = rawPastDates.map((pd) => ({
      ...pd,
      count: fixtureCountByDate.get(pd.iso) || 0,
    }));

    // Count fixtures for current date and future dates (strictly no past dates)
    let currentAndFutureCount = 0;
    allPredictions.forEach((p) => {
      const kickoff = p.target_kickoff_at || p.fixture?.target_kickoff_at;
      const d = getFixtureWatDate(kickoff);
      if (!d || d >= today.iso) currentAndFutureCount++;
    });

    return {
      all: {
        id: 'all',
        label: 'All Dates',
        subLabel: 'Current & Future',
        count: currentAndFutureCount,
      },
      yesterday: {
        ...yesterday,
        id: yesterday.iso,
        count: fixtureCountByDate.get(yesterday.iso) || 0,
      },
      today: {
        ...today,
        id: today.iso,
        count: fixtureCountByDate.get(today.iso) || 0,
      },
      day1: {
        ...day1,
        id: day1.iso,
        count: fixtureCountByDate.get(day1.iso) || 0,
      },
      day2: {
        ...day2,
        id: day2.iso,
        count: fixtureCountByDate.get(day2.iso) || 0,
      },
      day3: {
        ...day3,
        id: day3.iso,
        count: fixtureCountByDate.get(day3.iso) || 0,
      },
      pastDates,
      todayIso: today.iso,
      yesterdayIso: yesterday.iso,
    };
  }, [allPredictions]);

  const isPastDateSelected =
    selectedDate !== 'all' &&
    selectedDate < dynamicDateTabs.todayIso &&
    selectedDate !== dynamicDateTabs.yesterdayIso;

  const selectedPastOption = isPastDateSelected
    ? dynamicDateTabs.pastDates.find((p) => p.iso === selectedDate)
    : null;
  const selectedPastFormatted = selectedPastOption?.shortFormatted || selectedDate;

  // Active predictions matching the selected date
  const dateScopedPredictions = useMemo(() => {
    if (selectedDate === 'all') {
      return allPredictions.filter((p) => {
        const kickoff = p.target_kickoff_at || p.fixture?.target_kickoff_at;
        const d = getFixtureWatDate(kickoff);
        return !d || d >= dynamicDateTabs.todayIso;
      });
    }
    return allPredictions.filter((p) => {
      const kickoff = p.target_kickoff_at || p.fixture?.target_kickoff_at;
      const d = getFixtureWatDate(kickoff);
      return d === selectedDate;
    });
  }, [allPredictions, selectedDate, dynamicDateTabs.todayIso]);

  const filteredPredictions = useMemo(() => {
    let list = dateScopedPredictions;

    // Filter by tournament dropdown
    if (selectedTournament !== 'all') {
      list = list.filter((p) => p.fixture?.tournament_id === selectedTournament || p.fixture?.tournament?.id === selectedTournament);
    }

    // Filter by tier
    if (selectedTier !== 'all') {
      list = list.filter((p) => {
        const tier = (p.confidence_category || '').toUpperCase().replace(/ /g, '_');
        const target = selectedTier.toUpperCase().replace(/ /g, '_');
        return tier === target;
      });
    }

    // Filter by settlement status
    if (settlementFilter !== 'all') {
      list = list.filter((p) => {
        const st = (p.settlement_status || 'pending').toLowerCase();
        return st === settlementFilter.toLowerCase();
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((p) => {
        const tName = p.fixture?.tournament?.name?.toLowerCase() || '';
        const p1 = p.fixture?.player1?.display_name?.toLowerCase() || '';
        const p2 = p.fixture?.player2?.display_name?.toLowerCase() || '';
        return tName.includes(q) || p1.includes(q) || p2.includes(q);
      });
    }

    // UI ORDERING RULE:
    // Make Banger predictions top of the list, then Top Pick, then High Confidence, etc. (highest rating first)
    // Predictions with NO SAFE BANKER (High Volatility) strictly come below them.
    const getConfidenceWeight = (p: TennisPrediction): number => {
      const market = (p.market || '').toUpperCase().replace(/ /g, '_');
      const pred = (p.prediction || '').toUpperCase().replace(/ /g, '_');
      const cat = (p.confidence_category || '').toUpperCase().replace(/ /g, '_');

      // NO SAFE BANKER (High Volatility) strictly sinks to the bottom
      if (cat.includes('NO_SAFE_BANKER') || market.includes('NO_SAFE_BANKER') || pred.includes('NO_SAFE_BANKER')) {
        return -1;
      }
      if (cat.includes('BANGER')) return 6;
      if (cat.includes('TOP_PICK') || cat.includes('TOPPICK')) return 5;
      if (cat.includes('HIGH_CONFIDENCE') || cat.includes('HIGHCONFIDENCE')) return 4;
      if (cat.includes('MID_CONFIDENCE') || cat.includes('MIDCONFIDENCE')) return 3;
      if (cat.includes('LOW_CONFIDENCE') || cat.includes('LOWCONFIDENCE')) return 2;
      if (cat.includes('RISKY')) return 1;

      // Fallbacks for paywall-locked records where category may be masked
      if (market === 'SET_HANDICAP') return 6;
      if (market === 'MATCH_WINNER') return 5;

      return 1;
    };

    return [...list].sort((a, b) => {
      const weightA = getConfidenceWeight(a);
      const weightB = getConfidenceWeight(b);
      if (weightB !== weightA) {
        return weightB - weightA; // higher confidence tier first
      }

      // Secondary: highest rating / probability first
      const probA = a.probability != null ? (a.probability <= 1 ? a.probability * 100 : a.probability) : 0;
      const probB = b.probability != null ? (b.probability <= 1 ? b.probability * 100 : b.probability) : 0;
      if (Math.abs(probB - probA) > 0.01) {
        return probB - probA;
      }

      // Tertiary: earliest kickoff time first
      const timeA = new Date(a.target_kickoff_at || a.fixture?.target_kickoff_at || 0).getTime();
      const timeB = new Date(b.target_kickoff_at || b.fixture?.target_kickoff_at || 0).getTime();
      return timeA - timeB;
    });
  }, [dateScopedPredictions, selectedTournament, selectedTier, settlementFilter, searchQuery]);

  // Compute live scorecard KPI statistics from date-scoped predictions
  const scorecardStats = useMemo(() => {
    let allTotal = dateScopedPredictions.length;
    let allWon = 0;
    let allLost = 0;
    let allVoid = 0;
    let allPending = 0;

    let bangerTotal = 0;
    let bangerWon = 0;
    let bangerLost = 0;

    let topPickTotal = 0;
    let topPickWon = 0;
    let topPickLost = 0;

    let highTotal = 0;
    let highWon = 0;
    let highLost = 0;

    for (const p of dateScopedPredictions) {
      const tier = (p.confidence_category || '').toUpperCase().replace(/ /g, '_');
      const status = (p.settlement_status || 'pending').toLowerCase();

      if (status === 'won') allWon++;
      else if (status === 'lost') allLost++;
      else if (status === 'void' || status === 'voided') allVoid++;
      else allPending++;

      if (tier === 'BANGER') {
        bangerTotal++;
        if (status === 'won') bangerWon++;
        else if (status === 'lost') bangerLost++;
      } else if (tier === 'TOP_PICK' || tier === 'TOP PICK') {
        topPickTotal++;
        if (status === 'won') topPickWon++;
        else if (status === 'lost') topPickLost++;
      } else if (tier === 'HIGH_CONFIDENCE' || tier === 'HIGH CONFIDENCE') {
        highTotal++;
        if (status === 'won') highWon++;
        else if (status === 'lost') highLost++;
      }
    }

    const calcWinRate = (w: number, l: number) => {
      const decisive = w + l;
      return decisive > 0 ? String(Math.round((w / decisive) * 100)) : '0';
    };

    return {
      allTotal,
      allWon,
      allLost,
      allVoid,
      allPending,
      allWinRate: calcWinRate(allWon, allLost),
      bangerTotal,
      bangerWon,
      bangerLost,
      bangerWinRate: calcWinRate(bangerWon, bangerLost),
      topPickTotal,
      topPickWon,
      topPickLost,
      topPickWinRate: calcWinRate(topPickWon, topPickLost),
      highTotal,
      highWon,
      highLost,
      highWinRate: calcWinRate(highWon, highLost),
    };
  }, [dateScopedPredictions]);

  return (
    <div className="tennis-hub-view-wrapper" style={{ width: '100%', maxWidth: '1480px', margin: '0 auto', padding: '0 16px 80px 16px' }}>
      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '12px 16px', borderRadius: '12px', marginBottom: '16px', fontSize: '0.86rem' }}>
          <strong>Notice:</strong> {error}
        </div>
      )}

      {/* 1. DAILY VERIFIED SCORECARD SECTION (REPLICATING FOOTBALL SCORECARD DESIGN EXACTLY) */}
      <section className="daily-scorecard-section" style={{ marginTop: 0 }}>
        {/* Top Date Header: Current Date Display on left, Tournament Selector Dropdown on far right */}
        <div className="scorecard-date-header">
          <div className="current-date-badge">
            <span className="current-date-live-dot" />
            <span className="current-date-val">{watDateStr} • WAT (UTC+1)</span>
          </div>

          <div className="scorecard-league-filter-inline">
            <div className="scorecard-league-select-wrapper">
              <span className="scorecard-league-icon">🏆</span>
              <select
                id="scorecard-league-select"
                className="scorecard-league-select"
                value={selectedTournament}
                onChange={(e) => setSelectedTournament(e.target.value)}
                aria-label="Filter by Tournament"
              >
                <option value="all">All Tournaments ({dateScopedPredictions.length})</option>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.tour} • {t.name}
                  </option>
                ))}
              </select>
              <span className="scorecard-league-arrow">▾</span>
            </div>
          </div>
        </div>

        {/* Date Navigation Pills Bar: Strictly Ordered: Select Date (Drop down) | Yesterday | Today | Day+1 | Day+2 | Day+3 | All Dates */}
        <div className="date-nav-pills-bar">
          {/* Pill 1: Select Date (Drop down of all past dates) */}
          <div
            className={`date-pill-btn date-pill-dropdown-wrap ${isPastDateSelected ? 'active' : ''}`}
          >
            <span className="date-pill-main-row">
              📅 {isPastDateSelected ? selectedPastFormatted : 'Select Date'} ▾
            </span>
            <span className="date-pill-sub-label">
              {isPastDateSelected ? 'Past Archive' : 'All Past Dates'}
            </span>
            <select
              className="date-pill-native-select"
              value={isPastDateSelected ? selectedDate : ''}
              onChange={(e) => {
                if (e.target.value) setSelectedDate(e.target.value);
              }}
              aria-label="Select Past Date"
            >
              <option value="" disabled>Select Past Date...</option>
              {dynamicDateTabs.pastDates.map((pd) => (
                <option key={pd.iso} value={pd.iso}>
                  {pd.formatted}{pd.count ? ` (${pd.count} M)` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Pill 2: Yesterday */}
          <button
            type="button"
            className={`date-pill-btn yesterday-pill ${selectedDate === dynamicDateTabs.yesterday.iso ? 'active' : ''}`}
            onClick={() => setSelectedDate(dynamicDateTabs.yesterday.iso)}
          >
            <span className="date-pill-main-row">
              Yesterday
              <span className="date-pill-winloss">{dynamicDateTabs.yesterday.count} M</span>
            </span>
            <span className="date-pill-sub-label">{dynamicDateTabs.yesterday.dateFormatted}</span>
          </button>

          {/* Pill 3: Today */}
          <button
            type="button"
            className={`date-pill-btn ${selectedDate === dynamicDateTabs.today.iso ? 'active' : ''}`}
            onClick={() => setSelectedDate(dynamicDateTabs.today.iso)}
          >
            <span className="date-pill-main-row">
              Today
              <span className="date-pill-winloss">{dynamicDateTabs.today.count} M</span>
            </span>
            <span className="date-pill-sub-label">{dynamicDateTabs.today.dateFormatted}</span>
          </button>

          {/* Pill 4: Day (with date) - Day + 1 */}
          <button
            type="button"
            className={`date-pill-btn ${selectedDate === dynamicDateTabs.day1.iso ? 'active' : ''}`}
            onClick={() => setSelectedDate(dynamicDateTabs.day1.iso)}
          >
            <span className="date-pill-main-row">
              {dynamicDateTabs.day1.shortDay}
              <span className="date-pill-winloss">{dynamicDateTabs.day1.count} M</span>
            </span>
            <span className="date-pill-sub-label">{dynamicDateTabs.day1.dateFormatted}</span>
          </button>

          {/* Pill 5: Day (with date) - Day + 2 */}
          <button
            type="button"
            className={`date-pill-btn ${selectedDate === dynamicDateTabs.day2.iso ? 'active' : ''}`}
            onClick={() => setSelectedDate(dynamicDateTabs.day2.iso)}
          >
            <span className="date-pill-main-row">
              {dynamicDateTabs.day2.shortDay}
              <span className="date-pill-winloss">{dynamicDateTabs.day2.count} M</span>
            </span>
            <span className="date-pill-sub-label">{dynamicDateTabs.day2.dateFormatted}</span>
          </button>

          {/* Pill 6: Day (with date) - Day + 3 */}
          <button
            type="button"
            className={`date-pill-btn ${selectedDate === dynamicDateTabs.day3.iso ? 'active' : ''}`}
            onClick={() => setSelectedDate(dynamicDateTabs.day3.iso)}
          >
            <span className="date-pill-main-row">
              {dynamicDateTabs.day3.shortDay}
              <span className="date-pill-winloss">{dynamicDateTabs.day3.count} M</span>
            </span>
            <span className="date-pill-sub-label">{dynamicDateTabs.day3.dateFormatted}</span>
          </button>

          {/* Pill 7: All Dates */}
          <button
            type="button"
            className={`date-pill-btn ${selectedDate === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedDate('all')}
          >
            <span className="date-pill-main-row">
              All Dates
              <span className="date-pill-winloss">{dynamicDateTabs.all.count} M</span>
            </span>
            <span className="date-pill-sub-label">{dynamicDateTabs.all.subLabel}</span>
          </button>
        </div>

        {/* 2. DECONGESTED SCORECARD KPI SECTION (SINGLE COMPACT CARD WITH ALL PREDS, BANGERS/TOP PICKS, HIGH CONF, AND WON) */}
        <div className="scorecard-two-cards-row">
          {/* Unified Confidence Tabs & Won Tab inside single-card footprint */}
          <div className="compact-kpi-card winrates-kpi-card tennis-winrates-kpi-card">
            {/* Tab 1: All Predictions */}
            <div
              className={`compact-kpi-segment all-preds-seg ${selectedTier === 'all' && settlementFilter === 'all' ? 'active-seg' : ''}`}
              onClick={() => {
                setSelectedTier('all');
                setSettlementFilter('all');
              }}
              title="Click to reset tier filters and view all tennis predictions"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">All Preds</span>
                <span className="compact-kpi-pill">{scorecardStats.allTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct">{scorecardStats.allWinRate}%</span>
                <span className="compact-kpi-ratio">{scorecardStats.allWon}W • {scorecardStats.allLost}L</span>
              </div>
            </div>

            {/* Tab 2: Bangers & Top Picks Grouped Tab */}
            <div className="compact-kpi-grouped-tab">
              <div
                className={`compact-kpi-subsegment banger-subseg ${selectedTier === 'BANGER' ? 'active-seg' : ''}`}
                onClick={() => setSelectedTier(selectedTier === 'BANGER' ? 'all' : 'BANGER')}
                title="Click to filter by 96%+ Bangers"
              >
                <div className="compact-kpi-header">
                  <span className="compact-kpi-title">⭐ Banger</span>
                  <span className="compact-kpi-pill banger-pill">{scorecardStats.bangerTotal}M</span>
                </div>
                <div className="compact-kpi-val-row">
                  <span className="compact-kpi-pct banger-text">{scorecardStats.bangerWinRate}%</span>
                  <span className="compact-kpi-ratio">{scorecardStats.bangerWon}W • {scorecardStats.bangerLost}L</span>
                </div>
              </div>

              <div className="compact-kpi-inner-divider" />

              <div
                className={`compact-kpi-subsegment toppick-subseg ${selectedTier === 'TOP PICK' ? 'active-seg' : ''}`}
                onClick={() => setSelectedTier(selectedTier === 'TOP PICK' ? 'all' : 'TOP PICK')}
                title="Click to filter by 90%-95% Top Picks"
              >
                <div className="compact-kpi-header">
                  <span className="compact-kpi-title">👑 Top Pick</span>
                  <span className="compact-kpi-pill toppick-pill">{scorecardStats.topPickTotal}M</span>
                </div>
                <div className="compact-kpi-val-row">
                  <span className="compact-kpi-pct toppick-text">{scorecardStats.topPickWinRate}%</span>
                  <span className="compact-kpi-ratio">{scorecardStats.topPickWon}W • {scorecardStats.topPickLost}L</span>
                </div>
              </div>
            </div>

            {/* Tab 3: High Confidence */}
            <div
              className={`compact-kpi-segment high-conf-seg ${selectedTier === 'HIGH CONFIDENCE' ? 'active-seg' : ''}`}
              onClick={() => setSelectedTier(selectedTier === 'HIGH CONFIDENCE' ? 'all' : 'HIGH CONFIDENCE')}
              title="Click to filter by 83%-89% High Confidence"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">High Conf</span>
                <span className="compact-kpi-pill high-pill">{scorecardStats.highTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct high-text">{scorecardStats.highWinRate}%</span>
                <span className="compact-kpi-ratio">{scorecardStats.highWon}W • {scorecardStats.highLost}L</span>
              </div>
            </div>

            {/* Tab 4: Won (Placed on right-hand side after High Confidence) */}
            <div
              className={`compact-kpi-segment won-seg ${settlementFilter === 'won' ? 'active-seg' : ''}`}
              onClick={() => {
                setSettlementFilter(settlementFilter === 'won' ? 'all' : 'won');
                if (settlementFilter !== 'won') {
                  setSelectedTier('all');
                }
              }}
              title="Click to filter Won tennis predictions"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">Won</span>
                <span className="compact-kpi-pill won-pill">{scorecardStats.allWon}</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct won-text">✓ Won</span>
                <span className="compact-kpi-ratio">{scorecardStats.allWon}W • {scorecardStats.allLost}L</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. MAIN DASHBOARD 3-COLUMN GRID (Left Ad Sidebar + Tennis Fixtures Stream + Watchlist Sidebar) */}
      <div className="main-dashboard-grid" style={{ marginTop: 14 }}>
        {/* LEFT SIDEBAR: AD BANNER */}
        <LeftSidebarAd />

        {/* CENTER MAIN STREAM: TENNIS PREDICTIONS STREAM */}
        <div className="fixtures-stream-column">
          {/* SEARCH BAR ROW */}
          <div className="search-filter-row" style={{ marginTop: 0 }}>
            <div className="search-input-wrapper">
              <span className="search-icon">🔍</span>
              <input
                type="text"
                className="search-input"
                placeholder="Search players, tournaments, or tour..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Filter tennis predictions"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setSearchQuery('')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* PREDICTIONS FIXTURES LIST */}
          <div style={{ marginTop: 14 }}>
            {loading && !feedData ? (
              <div
                style={{
                  padding: 40,
                  background: '#ffffff',
                  borderRadius: 16,
                  border: '1px solid var(--border-subtle, #e2e8f0)',
                  textAlign: 'center',
                }}
              >
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-600 mb-3" />
                <div style={{ fontWeight: 800, color: 'var(--text-primary, #0f172a)' }}>
                  Synchronizing Tennis Prediction Queue...
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 4 }}>
                  Fetching verified 250,000 Monte Carlo simulations and ATP/WTA match draws.
                </div>
              </div>
            ) : filteredPredictions.length === 0 ? (
              <div
                style={{
                  padding: 48,
                  background: '#ffffff',
                  borderRadius: 16,
                  border: '1px solid var(--border-subtle, #e2e8f0)',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 32, marginBottom: 8 }}>🎾</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary, #0f172a)' }}>
                  No tennis predictions match your current selection.
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted, #64748b)', marginTop: 4 }}>
                  Try resetting the tournament or date filter, or clearing search keywords.
                </div>
                {onBackToFootball && (
                  <button
                    type="button"
                    className="coming-soon-back-btn"
                    style={{ marginTop: 14 }}
                    onClick={onBackToFootball}
                  >
                    ⚽ Explore Football Predictions
                  </button>
                )}
              </div>
            ) : (
              filteredPredictions.map((prediction) => (
                <TennisPredictionCard
                  key={prediction.id}
                  prediction={prediction}
                  isSubscriber={isSubscriber}
                  isAdmin={isAdmin}
                  canViewPredictions={canViewPredictions}
                  isFavorite={
                    isFavoriteItem
                      ? isFavoriteItem(prediction.fixture_id, 'Match Winner', prediction.prediction)
                      : false
                  }
                  onToggleFavorite={onToggleFavoriteItem}
                  onOpenUpgrade={onOpenSubscription}
                  onOpenAuth={onOpenAuth}
                />
              ))
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR: FAVORITES / WATCHLIST */}
        <WatchlistSidebar
          favoriteItems={favoriteItems}
          onToggleFavoriteItem={onToggleFavoriteItem}
          onOpenFavoritesDrawer={onOpenFavoritesDrawer}
        />
      </div>
    </div>
  );
};
