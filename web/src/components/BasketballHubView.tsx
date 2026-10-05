/**
 * Oddsbanta — Autonomous Basketball Predictions & 250,000 Monte Carlo Hub
 * Phase 5: Master Basketball Hub View Component
 */
import React, { useState, useEffect, useMemo } from 'react';
import { fetchBasketballFeed, BasketballFeedResponse } from '../lib/basketballFeedService';
import { BasketballMarket, BasketballPrediction } from '../types/basketball';
import {
  getDateDetailsByOffset,
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
  userRole,
  isAdmin = false,
  canViewPredictions = false,
  favoriteItems = [],
  onToggleFavoriteItem,
  isFavoriteItem,
  onOpenFavoritesDrawer,
  onOpenAuth,
  onOpenSubscription,
  onBackToFootball: _onBackToFootball,
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

    return futureDates;
  }, [allPredictions]);

  // Date-scoped predictions for calculating daily scorecard metrics
  const dateScopedPredictions = useMemo(() => {
    return allPredictions.filter((p) => {
      if (selectedDate === 'all') return true;
      const kickoff = p.target_kickoff_at || p.fixture?.target_kickoff_at;
      const d = getFixtureWatDate(kickoff);
      return d === selectedDate;
    });
  }, [allPredictions, selectedDate]);

  // Helper to determine if a basketball prediction is free/unlocked for guests (all basketball predictions are locked VIP teasers)
  const isFreeAccessible = (_p: BasketballPrediction): boolean => {
    return false;
  };

  // Filtered Predictions
  const filteredPredictions = useMemo(() => {
    const list = allPredictions.filter((p) => {

      // 1. Date Filter (ignore if viewing past results or all dates)
      if (selectedDate !== 'all' && settlementFilter === 'all') {
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
        if (!isSubscriber && (settlementFilter === 'lost' || settlementFilter === 'void')) return false;
      }

      // 5. Tier Filter
      if (selectedTier !== 'all') {
        const tier = (p.confidence_category || '').toUpperCase().replace(/ /g, '_');
        const target = selectedTier.toUpperCase().replace(/ /g, '_');
        if (target === 'NO_SAFE_BANKER') {
          const m = (p.market || '').toUpperCase().replace(/ /g, '_');
          const pred = (p.prediction || '').toUpperCase().replace(/ /g, '_');
          if (!tier.includes('NO_SAFE_BANKER') && !m.includes('NO_SAFE_BANKER') && !pred.includes('NO_SAFE_BANKER')) {
            return false;
          }
        } else if (target === 'BANGER' || target === 'BANGERS') {
          if (tier !== 'BANGER') return false;
        } else if (target === 'TOP_PICK' || target === 'TOP_PICKS') {
          if (tier !== 'TOP_PICK' && tier !== 'TOP PICK') return false;
        } else if (target === 'HIGH_CONFIDENCE') {
          if (tier !== 'HIGH_CONFIDENCE' && tier !== 'HIGH CONFIDENCE') return false;
        } else if (target === 'MID_CONFIDENCE') {
          if (tier !== 'MID_CONFIDENCE' && tier !== 'MID CONFIDENCE') return false;
        } else if (tier !== target) {
          return false;
        }
      }

      return true;
    });

    const getConfidenceWeight = (p: BasketballPrediction): number => {
      const market = (p.market || '').toUpperCase().replace(/ /g, '_');
      const pred = (p.prediction || '').toUpperCase().replace(/ /g, '_');
      const cat = (p.confidence_category || '').toUpperCase().replace(/ /g, '_');

      // NO SAFE BANKER (High Volatility) sinks to bottom
      if (cat.includes('NO_SAFE_BANKER') || market.includes('NO_SAFE_BANKER') || pred.includes('NO_SAFE_BANKER')) {
        return -1;
      }

      // For free visitors/non-subscribers: Keep high-conviction VIP conversion teasers at top
      if (!isSubscriber) {
        if (cat.includes('BANGER')) return 6;
        if (cat.includes('TOP_PICK') || cat.includes('TOPPICK')) return 5;
        if (cat.includes('HIGH_CONFIDENCE') || cat.includes('HIGHCONFIDENCE')) return 4;
        if (cat.includes('MID_CONFIDENCE') || cat.includes('MIDCONFIDENCE') || cat === 'MID') return 3;
        if (cat.includes('LOW_CONFIDENCE') || cat.includes('LOWCONFIDENCE') || cat === 'LOW') return 2;
        return 1;
      }

      // Paying subscribers: Standard VIP priority (highest confidence first)
      if (cat.includes('BANGER')) return 6;
      if (cat.includes('TOP_PICK') || cat.includes('TOPPICK')) return 5;
      if (cat.includes('HIGH_CONFIDENCE') || cat.includes('HIGHCONFIDENCE')) return 4;
      if (cat.includes('MID_CONFIDENCE') || cat.includes('MIDCONFIDENCE')) return 3;
      if (cat.includes('LOW_CONFIDENCE') || cat.includes('LOWCONFIDENCE')) return 2;
      return 1;
    };

    return [...list].sort((a, b) => {
      const weightA = getConfidenceWeight(a);
      const weightB = getConfidenceWeight(b);
      if (weightB !== weightA) {
        return weightB - weightA;
      }
      const probA = a.probability != null ? (a.probability <= 1 ? a.probability * 100 : a.probability) : 0;
      const probB = b.probability != null ? (b.probability <= 1 ? b.probability * 100 : b.probability) : 0;
      if (Math.abs(probB - probA) > 0.01) {
        return probB - probA;
      }
      const timeA = new Date(a.target_kickoff_at || a.fixture?.target_kickoff_at || 0).getTime();
      const timeB = new Date(b.target_kickoff_at || b.fixture?.target_kickoff_at || 0).getTime();
      return timeA - timeB;
    });
  }, [allPredictions, selectedDate, selectedLeague, selectedMarket, settlementFilter, selectedTier, isSubscriber]);

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

    let midTotal = 0;
    let midWon = 0;
    let midLost = 0;

    let noSafeTotal = 0;
    let noSafeWon = 0;
    let noSafeLost = 0;

    for (const p of dateScopedPredictions) {
      const tier = (p.confidence_category || '').toUpperCase().replace(/ /g, '_');
      const market = (p.market || '').toUpperCase().replace(/ /g, '_');
      const pred = (p.prediction || '').toUpperCase().replace(/ /g, '_');
      const status = (p.settlement_status || 'pending').toLowerCase();

      if (!isSubscriber) {
        allPending++;
      } else {
        if (status === 'won' || status === 'half_won') allWon++;
        else if (status === 'lost' || status === 'half_lost') allLost++;
        else if (status === 'void' || status === 'voided') allVoid++;
        else allPending++;
      }

      const isNoSafe = tier.includes('NO_SAFE_BANKER') || market.includes('NO_SAFE_BANKER') || pred.includes('NO_SAFE_BANKER');

      if (isNoSafe) {
        noSafeTotal++;
        if (isSubscriber) {
          if (status === 'won' || status === 'half_won') noSafeWon++;
          else if (status === 'lost' || status === 'half_lost') noSafeLost++;
        }
      } else if (tier === 'BANGER') {
        bangerTotal++;
        if (isSubscriber) {
          if (status === 'won' || status === 'half_won') bangerWon++;
          else if (status === 'lost' || status === 'half_lost') bangerLost++;
        }
      } else if (tier === 'TOP_PICK' || tier === 'TOP PICK') {
        topPickTotal++;
        if (isSubscriber) {
          if (status === 'won' || status === 'half_won') topPickWon++;
          else if (status === 'lost' || status === 'half_lost') topPickLost++;
        }
      } else if (tier === 'HIGH_CONFIDENCE' || tier === 'HIGH CONFIDENCE') {
        highTotal++;
        if (isSubscriber) {
          if (status === 'won' || status === 'half_won') highWon++;
          else if (status === 'lost' || status === 'half_lost') highLost++;
        }
      } else if (tier === 'MID_CONFIDENCE' || tier === 'MID CONFIDENCE') {
        midTotal++;
        if (isSubscriber) {
          if (status === 'won' || status === 'half_won') midWon++;
          else if (status === 'lost' || status === 'half_lost') midLost++;
        }
      }
    }

    const calcWinRate = (w: number, l: number) => {
      if (!isSubscriber) return '🔒';
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
      midTotal,
      midWon,
      midLost,
      midWinRate: calcWinRate(midWon, midLost),
      noSafeTotal,
      noSafeWon,
      noSafeLost,
      noSafeWinRate: calcWinRate(noSafeWon, noSafeLost),
    };
  }, [dateScopedPredictions, isSubscriber]);

  return (
    <div className="bball-page-root">
      {/* 1. REDUCED HERO BANNER WITH INTEGRATED LAGOS WAT DATE SELECTOR */}
      <section className="bball-hero-banner">
        <div className="bball-hero-header">
          <div className="bball-hero-title-group">
            <div className="bball-hero-icon-ring">🏀</div>
            <h1 className="bball-hero-title">
              Basketball Predictions
            </h1>
          </div>

          {/* LAGOS WAT CALENDAR DATE DROPDOWN ON THE SAME LINE */}
          <div className="bball-date-dropdown-wrap">
            <span className="bball-date-dropdown-icon" aria-hidden="true">📅</span>
            <select
              id="bball-date-select"
              aria-label="Filter Basketball Matches by Date"
              className="bball-date-select"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setSettlementFilter('all');
              }}
            >
              <option value="all">
                All Dates ({allPredictions.length} {allPredictions.length === 1 ? 'game' : 'games'})
              </option>
              {dynamicDateTabs.map((tab) => {
                const label = tab.dayLabel === 'Past'
                  ? `Past (${tab.dateSub})`
                  : tab.dayLabel === 'Today' || tab.dayLabel === 'Tomorrow'
                    ? `${tab.dayLabel}, ${tab.dateSub}`
                    : `${tab.dayLabel}, ${tab.dateSub}`;
                return (
                  <option key={tab.iso} value={tab.iso}>
                    {label} ({tab.count} {tab.count === 1 ? 'game' : 'games'})
                  </option>
                );
              })}
            </select>
            <span className="bball-date-dropdown-arrow" aria-hidden="true">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 1L5 5L9 1" stroke="#ea580c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </span>
          </div>
        </div>

        {/* 2. DECONGESTED SCORECARD KPI SECTION (REFLECTING ALL PREDICTION TYPES AND WINS/LOSSES JUST LIKE TENNIS) */}
        <div className="scorecard-two-cards-row" style={{ marginTop: '10px', marginBottom: '10px' }}>
          {/* Unified Confidence Tabs & Won Tab inside single-card footprint */}
          <div className="compact-kpi-card winrates-kpi-card tennis-winrates-kpi-card">
            {/* Tab 1: All Predictions */}
            <div
              className={`compact-kpi-segment all-preds-seg ${selectedTier === 'all' && settlementFilter === 'all' ? 'active-seg' : ''}`}
              onClick={() => {
                setSelectedTier('all');
                setSettlementFilter('all');
              }}
              title="Click to view all basketball predictions"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">All</span>
                <span className="compact-kpi-pill">{scorecardStats.allTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct">{isSubscriber ? `${scorecardStats.allWinRate}%` : '🔒 VIP'}</span>
                <span className="compact-kpi-ratio">{isSubscriber ? `${scorecardStats.allWon}W • ${scorecardStats.allLost}L` : 'VIP Only'}</span>
              </div>
            </div>

            {/* Tab 2: Banger */}
            <div
              className={`compact-kpi-segment banger-subseg ${selectedTier === 'BANGER' ? 'active-seg' : ''}`}
              onClick={() => {
                setSettlementFilter('all');
                setSelectedTier(selectedTier === 'BANGER' ? 'all' : 'BANGER');
              }}
              title="Click to filter by 96%+ Bangers"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">⭐ Banger</span>
                <span className="compact-kpi-pill banger-pill">{scorecardStats.bangerTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct banger-text">{isSubscriber ? `${scorecardStats.bangerWinRate}%` : '🔒 VIP'}</span>
                <span className="compact-kpi-ratio">{isSubscriber ? `${scorecardStats.bangerWon}W • ${scorecardStats.bangerLost}L` : 'VIP Only'}</span>
              </div>
            </div>

            {/* Tab 3: Top Pick */}
            <div
              className={`compact-kpi-segment toppick-subseg ${selectedTier === 'TOP PICK' ? 'active-seg' : ''}`}
              onClick={() => {
                setSettlementFilter('all');
                setSelectedTier(selectedTier === 'TOP PICK' ? 'all' : 'TOP PICK');
              }}
              title="Click to filter by 90%-95% Top Picks"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">👑 Top Pick</span>
                <span className="compact-kpi-pill toppick-pill">{scorecardStats.topPickTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct toppick-text">{isSubscriber ? `${scorecardStats.topPickWinRate}%` : '🔒 VIP'}</span>
                <span className="compact-kpi-ratio">{isSubscriber ? `${scorecardStats.topPickWon}W • ${scorecardStats.topPickLost}L` : 'VIP Only'}</span>
              </div>
            </div>

            {/* Tab 4: High Confidence */}
            <div
              className={`compact-kpi-segment high-subseg ${selectedTier === 'HIGH CONFIDENCE' ? 'active-seg' : ''}`}
              onClick={() => {
                setSettlementFilter('all');
                setSelectedTier(selectedTier === 'HIGH CONFIDENCE' ? 'all' : 'HIGH CONFIDENCE');
              }}
              title="Click to filter by 83%-89% High Confidence"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">⚡ High</span>
                <span className="compact-kpi-pill high-pill">{scorecardStats.highTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct high-text">{isSubscriber ? `${scorecardStats.highWinRate}%` : '🔒 VIP'}</span>
                <span className="compact-kpi-ratio">{isSubscriber ? `${scorecardStats.highWon}W • ${scorecardStats.highLost}L` : 'VIP Only'}</span>
              </div>
            </div>

            {/* Tab 5: Mid Confidence */}
            <div
              className={`compact-kpi-segment mid-subseg ${selectedTier === 'MID CONFIDENCE' ? 'active-seg' : ''}`}
              onClick={() => {
                setSettlementFilter('all');
                setSelectedTier(selectedTier === 'MID CONFIDENCE' ? 'all' : 'MID CONFIDENCE');
              }}
              title="Click to filter by 75%-82% Mid Confidence"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">🛡️ Mid</span>
                <span className="compact-kpi-pill mid-pill">{scorecardStats.midTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct mid-text">{isSubscriber ? `${scorecardStats.midWinRate}%` : '🔒 VIP'}</span>
                <span className="compact-kpi-ratio">{isSubscriber ? `${scorecardStats.midWon}W • ${scorecardStats.midLost}L` : 'VIP Only'}</span>
              </div>
            </div>

            {/* Tab 6: No Safe Banker (High Volatility) */}
            <div
              className={`compact-kpi-segment nosafe-subseg ${selectedTier === 'NO_SAFE_BANKER' ? 'active-seg' : ''}`}
              onClick={() => {
                setSettlementFilter('all');
                setSelectedTier(selectedTier === 'NO_SAFE_BANKER' ? 'all' : 'NO_SAFE_BANKER');
              }}
              title="Click to filter High Volatility / No Safe Banker predictions"
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">⚠️ No Safe</span>
                <span className="compact-kpi-pill nosafe-pill">{scorecardStats.noSafeTotal}M</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct nosafe-text">{isSubscriber ? `${scorecardStats.noSafeWinRate}%` : '🔒 VIP'}</span>
                <span className="compact-kpi-ratio">{isSubscriber ? `${scorecardStats.noSafeWon}W • ${scorecardStats.noSafeLost}L` : 'VIP Only'}</span>
              </div>
            </div>

            {/* Tab 7: Won */}
            <div
              className={`compact-kpi-segment won-seg ${settlementFilter === 'won' ? 'active-seg' : ''}`}
              onClick={() => {
                if (!isSubscriber) {
                  if (onOpenSubscription) onOpenSubscription();
                  return;
                }
                const nextState = settlementFilter === 'won' ? 'all' : 'won';
                setSettlementFilter(nextState);
                if (nextState === 'won') {
                  setSelectedTier('all');
                }
              }}
              title={isSubscriber ? "Click to filter Won basketball predictions" : "Unlock VIP to view settled results"}
            >
              <div className="compact-kpi-header">
                <span className="compact-kpi-title">✓ Won</span>
                <span className="compact-kpi-pill won-pill">{isSubscriber ? scorecardStats.allWon : '🔒'}</span>
              </div>
              <div className="compact-kpi-val-row">
                <span className="compact-kpi-pct won-text">{isSubscriber ? `${scorecardStats.allWon}W` : '🔒 VIP'}</span>
                <span className="compact-kpi-ratio">{isSubscriber ? `${scorecardStats.allLost} Lost` : 'VIP Results'}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. MAIN DASHBOARD 3-COLUMN GRID: LEFT AD SIDEBAR + CENTER BASKETBALL STREAM + RIGHT WATCHLIST SIDEBAR */}
      <div className="main-dashboard-grid" style={{ marginTop: 16 }}>
        {/* Left Sidebar Advertisement */}
        <LeftSidebarAd />

        {/* Center Main Basketball Hub Column */}
        <main className="fixtures-stream-column" id="basketball-main-hub">

          {/* NON-SUBSCRIBER BASKETBALL VIP NOTICE */}
          {!isSubscriber && (
            <div
              style={{
                marginBottom: 16,
                padding: '14px 18px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                boxShadow: '0 4px 14px rgba(49, 46, 129, 0.18)',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '260px', flex: 1 }}>
                <span style={{ fontSize: '24px' }}>🏀</span>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '13px', letterSpacing: '-0.01em', color: '#fbbf24' }}>
                    {userRole === 'standard' ? 'Standard Plan Active — Upgrade to BigBang VIP' : 'Oddsbanta BigBang VIP Basketball Analytics'}
                  </div>
                  <div style={{ fontSize: '12px', color: '#c7d2fe', marginTop: '2px', lineHeight: 1.4 }}>
                    {userRole === 'standard'
                      ? 'Your Standard Plan includes full Football coverage. Basketball predictions, Dean Oliver Four Factors, point spreads & game totals are unlocked with BigBang VIP (₦10,000/mo).'
                      : 'Basketball match predictions, Dean Oliver Four Factors, point spreads, game totals, and 250,000 Monte Carlo simulations are reserved for BigBang VIP members.'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenSubscription}
                style={{
                  background: '#f59e0b',
                  color: '#0f172a',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  fontWeight: 800,
                  fontSize: '12px',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {userRole === 'standard' ? 'Upgrade to BigBang VIP (₦10,000/mo) →' : 'Unlock BigBang VIP (₦10,000/mo) →'}
              </button>
            </div>
          )}

          {/* 5. PREDICTIONS FEED / CARDS LIST */}
          {loading ? (
            <div style={{ padding: '60px 0', textAlign: 'center', color: '#64748b' }}>
              <div className="bball-hero-icon-ring" style={{ margin: '0 auto 16px', animation: 'bounce 1s infinite' }}>
                🏀
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                Calibrating Basketball Prediction Models...
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
              {filteredPredictions.map((pred, idx) => {
                const standardMarket = (() => {
                  const s = (pred.market || '').toLowerCase();
                  if (s.includes('spread')) return 'Point Spread';
                  if (s.includes('total') || s.includes('over') || s.includes('under')) return 'Game Totals';
                  return 'Moneyline';
                })();

                const prevPred = idx > 0 ? filteredPredictions[idx - 1] : null;
                const isTransitionToLocked = !isSubscriber && prevPred &&
                  isFreeAccessible(prevPred) && !isFreeAccessible(pred);

                return (
                  <React.Fragment key={pred.id}>
                    {isTransitionToLocked && (
                      <div
                        className="bball-vip-banner-card"
                        style={{
                          gridColumn: '1 / -1',
                          background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
                          border: '1px solid rgba(245, 158, 11, 0.4)',
                          borderRadius: '14px',
                          padding: '20px 24px',
                          margin: '10px 0 16px 0',
                          color: '#ffffff',
                          boxShadow: '0 8px 24px rgba(30, 27, 75, 0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '16px',
                          flexWrap: 'wrap'
                        }}
                      >
                        <div style={{ flex: '1 1 300px' }}>
                          <div style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: 'rgba(245, 158, 11, 0.2)',
                            color: '#fbbf24',
                            fontSize: '11px',
                            fontWeight: 800,
                            padding: '4px 10px',
                            borderRadius: '6px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                            marginBottom: '8px'
                          }}>
                            👑 VIP Basketball Vault
                          </div>
                          <h4 style={{ margin: '0 0 6px 0', fontSize: '17px', fontWeight: 800, color: '#ffffff' }}>
                            Want 85%+ High-Confidence Basketball Picks?
                          </h4>
                          <p style={{ margin: 0, fontSize: '13px', color: '#c7d2fe', lineHeight: 1.5 }}>
                            You've tested our free Mid-Confidence simulations above. Unlock today's highest-conviction <strong>Bangers</strong>, <strong>Top Picks</strong>, and Dean Oliver Four Factors models with VIP access.
                          </p>
                        </div>
                        {onOpenSubscription && (
                          <button
                            type="button"
                            onClick={onOpenSubscription}
                            style={{
                              background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                              color: '#0f172a',
                              border: 'none',
                              borderRadius: '10px',
                              padding: '12px 22px',
                              fontWeight: 800,
                              fontSize: '13px',
                              cursor: 'pointer',
                              boxShadow: '0 4px 14px rgba(245, 158, 11, 0.4)',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            ⚡ Unlock All VIP Picks Now →
                          </button>
                        )}
                      </div>
                    )}
                    <BasketballPredictionCard
                      prediction={pred}
                      isSubscriber={isSubscriber}
                      isAdmin={isAdmin}
                      canViewPredictions={canViewPredictions}
                      isFavorite={isFavoriteItem ? isFavoriteItem(pred.fixture_id, standardMarket, pred.prediction) : false}
                      isFavoriteItem={isFavoriteItem}
                      onToggleFavorite={onToggleFavoriteItem}
                      onOpenUpgrade={onOpenSubscription}
                      onOpenAuth={onOpenAuth}
                    />
                  </React.Fragment>
                );
              })}
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
