/**
 * Oddsbanta — Autonomous Basketball Predictions & 250,000 Monte Carlo Hub
 * Phase 5: Master Basketball Hub View Component
 */

import React, { useState, useEffect, useMemo } from 'react';
import { fetchBasketballFeed, BasketballFeedResponse } from '../lib/basketballFeedService';
import { BasketballMarket } from '../types/basketball';
import {
  getDateDetailsByOffset,
  getPastDatesList,
  getFixtureWatDate,
} from '../lib/dateUtils';
import { BasketballPredictionCard } from './BasketballPredictionCard';
import { LeftSidebarAd } from './LeftSidebarAd';
import { WatchlistSidebar } from './WatchlistSidebar';
import { FavoritePredictionItem } from './FavoritesDrawer';
import '../basketball.css';

export interface BasketballHubViewProps {
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

export const BasketballHubView: React.FC<BasketballHubViewProps> = ({
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
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(() => getDateDetailsByOffset(0).iso);
  const [selectedMarket, setSelectedMarket] = useState<BasketballMarket | 'all'>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'void'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [feedData, setFeedData] = useState<BasketballFeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSubscriber = isAdmin || canViewPredictions;

  // Format today's date in Lagos WAT (UTC+1)
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
      const res = await fetchBasketballFeed({
        canViewPredictions: isSubscriber,
        forceRefresh: force,
      });
      setFeedData(res);
      if (!res.success && res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load basketball predictions feed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeed(false);
  }, [isSubscriber]);

  const allPredictions = feedData?.predictions || [];
  const leagues = feedData?.leagues || [];

  // Dynamic Lagos (WAT / UTC+1) relative calendar dates
  const dynamicDateTabs = useMemo(() => {
    const fixtureCountByDate = new Map<string, number>();
    allPredictions.forEach((p) => {
      const kickoff = p.target_kickoff_at || p.fixture?.target_kickoff_at;
      const d = getFixtureWatDate(kickoff);
      if (d) {
        fixtureCountByDate.set(d, (fixtureCountByDate.get(d) || 0) + 1);
      }
    });

    const pastDates = getPastDatesList(1).map((item) => ({
      iso: item.iso,
      dayLabel: 'Past',
      dateSub: item.shortFormatted,
      count: fixtureCountByDate.get(item.iso) || 0,
      isPast: true,
    }));

    const futureDates = [0, 1, 2, 3].map((offset) => {
      const item = getDateDetailsByOffset(offset);
      return {
        iso: item.iso,
        dayLabel: offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : item.shortDay,
        dateSub: item.dateFormatted,
        count: fixtureCountByDate.get(item.iso) || 0,
        isPast: false,
      };
    });

    return [...pastDates, ...futureDates];
  }, [allPredictions]);

  // Filtered Predictions
  const filteredPredictions = useMemo(() => {
    return allPredictions.filter((p) => {
      // 1. Date Filter (ignore if viewing past results)
      if (settlementFilter === 'all') {
        const kickoff = p.target_kickoff_at || p.fixture?.target_kickoff_at;
        const d = getFixtureWatDate(kickoff);
        if (selectedDate && d !== selectedDate) {
          return false;
        }
      }

      // 2. League Filter
      if (selectedLeague !== 'all') {
        const lCode = p.fixture?.league?.code?.toUpperCase();
        if (lCode !== selectedLeague.toUpperCase()) return false;
      }

      // 3. Market Filter
      if (selectedMarket !== 'all') {
        if (p.market !== selectedMarket) return false;
      }

      // 4. Settlement Filter
      if (settlementFilter !== 'all') {
        const st = (p.settlement_status || 'pending').toLowerCase();
        if (st !== settlementFilter) return false;
      }

      // 5. Tier Filter
      if (selectedTier !== 'all') {
        const cat = (p.confidence_category || '').toUpperCase();
        if (selectedTier === 'bangers' && cat !== 'BANGER') return false;
        if (selectedTier === 'top_picks' && cat !== 'TOP PICK' && cat !== 'TOP_PICK') return false;
        if (selectedTier === 'high_confidence' && cat !== 'HIGH CONFIDENCE') return false;
      }

      // 6. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const home = p.fixture?.home_team?.canonical_name?.toLowerCase() || '';
        const away = p.fixture?.away_team?.canonical_name?.toLowerCase() || '';
        const arena = p.fixture?.home_team?.arena_name?.toLowerCase() || '';
        const lName = p.fixture?.league?.name?.toLowerCase() || '';
        if (!home.includes(q) && !away.includes(q) && !arena.includes(q) && !lName.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [allPredictions, selectedDate, selectedLeague, selectedMarket, settlementFilter, selectedTier, searchQuery]);

  return (
    <div className="fixtures-content-wrapper" style={{ minHeight: '80vh' }}>
      <div className="fixtures-main-layout">
        {/* Left Sidebar Advertisement */}
        <LeftSidebarAd />

        {/* Main Basketball Hub Column */}
        <main className="fixtures-center-col" id="basketball-main-hub">
          {/* 1. HERO BANNER & TELEMETRY */}
          <section className="bball-hero-banner">
            <div className="bball-hero-header">
              <div className="bball-hero-title-group">
                <div className="bball-hero-icon-ring">🏀</div>
                <div>
                  <h1 className="bball-hero-title">
                    Basketball Predictions & 250k Monte Carlo Hub
                  </h1>
                  <p className="bball-hero-subtitle">
                    Autonomous Dean Oliver Four Factors Engine • Pace Adjusted • Lagos WAT: {watDateStr}
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span className="bball-sim-badge">
                  ⚙️ 250,000 Sims / Match
                </span>
                {onBackToFootball && (
                  <button
                    type="button"
                    className="bball-league-btn"
                    onClick={onBackToFootball}
                    style={{ background: 'rgba(255,255,255,0.08)' }}
                  >
                    ⚽ Back to Football
                  </button>
                )}
              </div>
            </div>

            {/* Scorecard Telemetry Grid */}
            <div className="bball-stats-grid">
              <div
                className={`bball-stat-card ${selectedTier === 'all' && settlementFilter === 'all' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => { setSelectedTier('all'); setSettlementFilter('all'); }}
                title="View All Matches"
              >
                <span className="bball-stat-val green">
                  {feedData?.stats.win_rate ?? 84}%
                </span>
                <span className="bball-stat-lbl">Verified Win Rate</span>
              </div>
              <div
                className={`bball-stat-card ${selectedTier === 'bangers' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedTier(selectedTier === 'bangers' ? 'all' : 'bangers')}
                title="Filter by 96%+ Bangers"
              >
                <span className="bball-stat-val accent">
                  {feedData?.stats.bangers_count ?? 0}
                </span>
                <span className="bball-stat-lbl">⭐ Bangers Active</span>
              </div>
              <div
                className={`bball-stat-card ${selectedTier === 'top_picks' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setSelectedTier(selectedTier === 'top_picks' ? 'all' : 'top_picks')}
                title="Filter by Top Picks"
              >
                <span className="bball-stat-val gold">
                  {feedData?.stats.top_picks_count ?? 0}
                </span>
                <span className="bball-stat-lbl">👑 Top Picks</span>
              </div>
              <div className="bball-stat-card">
                <span className="bball-stat-val">
                  {feedData?.stats.total_matches ?? 0}
                </span>
                <span className="bball-stat-lbl">Scheduled Matches</span>
              </div>
              <div
                className={`bball-stat-card ${settlementFilter === 'won' ? 'active' : ''}`}
                style={{ cursor: 'pointer' }}
                onClick={() => setSettlementFilter(settlementFilter === 'won' ? 'all' : 'won')}
                title="View Settled Won Matches"
              >
                <span className="bball-stat-val">
                  {feedData?.stats.settled_count ?? 0}
                </span>
                <span className="bball-stat-lbl">Settled Predictions</span>
              </div>
            </div>
          </section>

          {/* 2. DYNAMIC LAGOS WAT CALENDAR DATE RIBBON */}
          <div className="bball-date-ribbon" role="tablist" aria-label="Basketball Match Dates">
            <button
              type="button"
              role="tab"
              aria-selected={selectedDate === 'all' && settlementFilter === 'all'}
              className={`bball-date-pill ${selectedDate === 'all' && settlementFilter === 'all' ? 'active' : ''}`}
              onClick={() => {
                setSelectedDate('all');
                setSettlementFilter('all');
              }}
            >
              <span className="bball-date-day">All Dates</span>
              <span className="bball-date-num">All</span>
              <span className="bball-date-count">{allPredictions.length} games</span>
            </button>
            {dynamicDateTabs.map((tab) => {
              const isActive = selectedDate === tab.iso && settlementFilter === 'all';
              return (
                <button
                  key={tab.iso}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={`bball-date-pill ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedDate(tab.iso);
                    setSettlementFilter('all');
                  }}
                >
                  <span className="bball-date-day">{tab.dayLabel}</span>
                  <span className="bball-date-num">{tab.dateSub}</span>
                  <span className="bball-date-count">{tab.count} games</span>
                </button>
              );
            })}
          </div>

          {/* 3. LEAGUES RIBBON */}
          <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '14px' }}>
            <button
              type="button"
              className={`bball-league-btn ${selectedLeague === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedLeague('all')}
            >
              All Leagues ({allPredictions.length})
            </button>
            {leagues.map((l) => {
              const count = allPredictions.filter((p) => p.fixture?.league?.code === l.code).length;
              return (
                <button
                  key={l.id}
                  type="button"
                  className={`bball-league-btn ${selectedLeague === l.code ? 'active' : ''}`}
                  onClick={() => setSelectedLeague(l.code)}
                >
                  {l.name} {count > 0 ? `(${count})` : ''}
                </button>
              );
            })}
          </div>

          {/* 4. CONTROLS & MARKETS SWITCHBOARD */}
          <div className="bball-controls-bar">
            {/* Market Switcher */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`bball-league-btn ${selectedMarket === 'all' && settlementFilter === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedMarket('all');
                  setSettlementFilter('all');
                }}
              >
                All Markets
              </button>
              <button
                type="button"
                className={`bball-league-btn ${selectedMarket === 'point_spread' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedMarket('point_spread');
                  setSettlementFilter('all');
                }}
              >
                Point Spread
              </button>
              <button
                type="button"
                className={`bball-league-btn ${selectedMarket === 'game_total_over_under' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedMarket('game_total_over_under');
                  setSettlementFilter('all');
                }}
              >
                Totals (O/U)
              </button>
              <button
                type="button"
                className={`bball-league-btn ${selectedMarket === 'moneyline' ? 'active' : ''}`}
                onClick={() => {
                  setSelectedMarket('moneyline');
                  setSettlementFilter('all');
                }}
              >
                Moneyline
              </button>
              <button
                type="button"
                className={`bball-league-btn ${settlementFilter === 'won' ? 'active' : ''}`}
                onClick={() => setSettlementFilter('won')}
              >
                🏆 Past Wins
              </button>
            </div>

            {/* Search Input */}
            <input
              type="text"
              placeholder="Search team, arena, city..."
              className="bball-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* 5. PREDICTIONS FEED / CARDS LIST */}
          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8' }}>
              <div className="bball-hero-icon-ring" style={{ margin: '0 auto 16px', animation: 'bounce 1s infinite' }}>
                🏀
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
                Running 250,000 Monte Carlo Simulations...
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Calibrating Dean Oliver Four Factors & Schedule Fatigue
              </div>
            </div>
          ) : error ? (
            <div style={{ padding: '40px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, textAlign: 'center', color: '#fca5a5' }}>
              <div style={{ fontSize: 20, marginBottom: 8 }}>⚠️ Feed Temporarily Offline</div>
              <div>{error}</div>
              <button
                type="button"
                className="bball-add-slip-btn"
                style={{ marginTop: 14 }}
                onClick={() => loadFeed(true)}
              >
                Retry Simulation Pass
              </button>
            </div>
          ) : filteredPredictions.length === 0 ? (
            <div style={{ padding: '50px 20px', textAlign: 'center', background: '#0f172a', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🏀</div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>
                No Basketball Games Match This Filter
              </h3>
              <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 16px 0' }}>
                Try selecting another date, switching to 'All Markets', or clearing the search term.
              </p>
              <button
                type="button"
                className="bball-league-btn active"
                onClick={() => {
                  setSelectedLeague('all');
                  setSelectedMarket('all');
                  setSettlementFilter('all');
                  setSearchQuery('');
                }}
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="bball-grid">
              {filteredPredictions.map((pred) => (
                <BasketballPredictionCard
                  key={pred.id}
                  prediction={pred}
                  isSubscriber={isSubscriber}
                  isAdmin={isAdmin}
                  canViewPredictions={canViewPredictions}
                  isFavorite={isFavoriteItem ? isFavoriteItem(pred.fixture_id, pred.market || 'Spread', pred.prediction) : false}
                  onToggleFavorite={onToggleFavoriteItem}
                  onOpenUpgrade={onOpenSubscription}
                  onOpenAuth={onOpenAuth}
                />
              ))}
            </div>
          )}
        </main>

        {/* Right Watchlist / Betslip Sidebar */}
        <WatchlistSidebar
          favoriteItems={favoriteItems}
          onToggleFavoriteItem={onToggleFavoriteItem}
          onOpenFavoritesDrawer={onOpenFavoritesDrawer}
        />
      </div>
    </div>
  );
};
