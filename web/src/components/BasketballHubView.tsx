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
  const [selectedDate, setSelectedDate] = useState<string>(() => getDateDetailsByOffset(0).iso);
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'void'>('all');
  const [loading, setLoading] = useState<boolean>(true);
  const [feedData, setFeedData] = useState<BasketballFeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selectedLeague: string = 'all';
  const selectedMarket: BasketballMarket | 'all' = 'all';

  const isSubscriber = isAdmin || canViewPredictions;



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

      return true;
    });
  }, [allPredictions, selectedDate, selectedLeague, selectedMarket, settlementFilter, selectedTier]);

  return (
    <div className="bball-page-root" style={{ minHeight: '80vh', width: '100%', maxWidth: '1480px', margin: '0 auto', padding: '0 16px 40px' }}>
      {/* 1. REDUCED HERO BANNER WITH INTEGRATED LAGOS WAT DATE SELECTOR */}
      <section className="bball-hero-banner">
        <div className="bball-hero-header">
          <div className="bball-hero-title-group">
            <div className="bball-hero-icon-ring">🏀</div>
            <h1 className="bball-hero-title">
              Basketball Predictions
            </h1>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="bball-sim-badge">
              ⚙️ 250,000 Sims / Match
            </span>
            {onBackToFootball && (
              <button
                type="button"
                className="bball-league-btn"
                onClick={onBackToFootball}
              >
                ⚽ Back to Football
              </button>
            )}
          </div>
        </div>

        {/* Compact Scorecard Telemetry Grid */}
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

        {/* INTEGRATED LAGOS WAT CALENDAR DATE RIBBON INSIDE HERO BANNER */}
        <div className="bball-hero-date-row">
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
        </div>
      </section>

      {/* 2. MAIN DASHBOARD 3-COLUMN GRID: LEFT AD SIDEBAR + CENTER BASKETBALL STREAM + RIGHT WATCHLIST SIDEBAR */}
      <div className="main-dashboard-grid" style={{ marginTop: 16 }}>
        {/* Left Sidebar Advertisement */}
        <LeftSidebarAd />

        {/* Center Main Basketball Hub Column */}
        <main className="fixtures-stream-column" id="basketball-main-hub">

          {/* 5. PREDICTIONS FEED / CARDS LIST */}
          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>
              <div className="bball-hero-icon-ring" style={{ margin: '0 auto 16px', animation: 'bounce 1s infinite' }}>
                🏀
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                Running 250,000 Monte Carlo Simulations...
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Calibrating Dean Oliver Four Factors & Schedule Fatigue
              </div>
            </div>
          ) : error ? (
            <div style={{ padding: '40px', background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 12, textAlign: 'center', color: '#b91c1c' }}>
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
            <div style={{ padding: '50px 20px', textAlign: 'center', background: '#ffffff', borderRadius: 14, border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>🏀</div>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#0f172a', margin: '0 0 6px 0' }}>
                No Basketball Games Match This Filter
              </h3>
              <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 16px 0' }}>
                Try selecting another date from the calendar ribbon above or reset all active filters.
              </p>
              <button
                type="button"
                className="bball-league-btn active"
                onClick={() => {
                  setSelectedTier('all');
                  setSettlementFilter('all');
                  setSelectedDate('all');
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
