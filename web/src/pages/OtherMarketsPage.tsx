import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { MarketSwitchboardNav } from '../components/MarketSwitchboardNav';
import { SpecialistMarketCard } from '../components/SpecialistMarketCard';
import { AdBannerSlot } from '../components/AdBannerSlot';
import { FavoritePredictionItem } from '../components/FavoritesDrawer';
import { fetchMarketFeed, MarketType, UnifiedMarketPrediction } from '../lib/marketFeedService';
import { updatePageSeo } from '../lib/seo';
import { recordSportsSearch } from '../lib/sportsIntentTracker';
import { trackSportsSearchEvent } from '../lib/pixelTracker';
import { DesktopSidebarLayout } from '../components/DesktopSidebarLayout';
import {
  getTodayIsoDate,
  getDateDetailsByOffset,
  getPastDatesList
} from '../lib/dateUtils';
import '../goals.css';

export interface OtherMarketsPageProps {
  currentUser: any;
  userRole?: string;
  isAdmin: boolean;
  onOpenAuth: (mode: 'signin' | 'register') => void;
  onOpenSubscription: () => void;
  favoriteItems?: FavoritePredictionItem[];
  onToggleFavoriteItem?: (item: FavoritePredictionItem) => void;
  isFavoriteItem?: (fixtureId: string, market: string, pick: string) => boolean;
  onOpenFavoritesDrawer?: () => void;
  initialMarket?: MarketType;
}

export const OtherMarketsPage: React.FC<OtherMarketsPageProps> = ({
  currentUser: _currentUser,
  userRole,
  isAdmin,
  onOpenAuth: _onOpenAuth,
  onOpenSubscription,
  favoriteItems = [],
  onToggleFavoriteItem,
  isFavoriteItem,
  onOpenFavoritesDrawer,
  initialMarket = 'over_2.5_goals',
}) => {
  const [activeMarket, setActiveMarket] = useState<MarketType>(
    initialMarket === 'general' ? 'over_2.5_goals' : initialMarket
  );
  const [dateFilter, setDateFilter] = useState<string>(getTodayIsoDate());
  const [statusFilter, setStatusFilter] = useState<'all' | 'won' | 'lost' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dynamic deterministic relative dates: Yesterday, Today, Day+1, Day+2, Day+3, Past Dates
  const dateTabs = useMemo(() => {
    const yesterday = getDateDetailsByOffset(-1);
    const today = getDateDetailsByOffset(0);
    const day1 = getDateDetailsByOffset(1);
    const day2 = getDateDetailsByOffset(2);
    const day3 = getDateDetailsByOffset(3);
    const pastDates = getPastDatesList(30);

    return { yesterday, today, day1, day2, day3, pastDates };
  }, []);

  const isPastDateSelected =
    dateFilter !== 'all' &&
    dateFilter < dateTabs.today.iso &&
    dateFilter !== dateTabs.yesterday.iso;

  const selectedPastOption = isPastDateSelected
    ? dateTabs.pastDates.find((p) => p.iso === dateFilter)
    : null;
  const selectedPastFormatted = selectedPastOption?.shortFormatted || dateFilter;

  const [predictions, setPredictions] = useState<UnifiedMarketPrediction[]>([]);
  const [marketCounts, setMarketCounts] = useState<Record<MarketType, number>>({
    general: 0,
    curated: 0,
    home_win: 0,
    away_win: 0,
    draw: 0,
    'over_2.5_goals': 0,
    'ht_over_0.5_goals': 0,
    corners: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Determine paid user status
  const isPaidUser = useMemo(() => {
    if (isAdmin) return true;
    if (userRole === 'admin' || userRole === 'standard' || userRole === 'bigbang') return true;
    return false;
  }, [isAdmin, userRole]);

  // Load predictions for current market and filters (Continuous scroll: limit 200)
  const loadMarketData = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetchMarketFeed({
        market: activeMarket,
        date: dateFilter,
        page: 1,
        limit: 200,
        token,
        isAdmin,
        canViewPredictions: isPaidUser,
      });

      if (res.success) {
        setPredictions(res.predictions || []);
        if (res.counts) setMarketCounts(res.counts);
      } else {
        setError(res.error || 'Failed to fetch market predictions');
      }
    } catch (err: any) {
      console.error('Error in OtherMarketsPage loadMarketData:', err);
      setError(err.message || 'Network error fetching specialist predictions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMarketData();
  }, [activeMarket, dateFilter, isPaidUser]);

  // SEO Update
  useEffect(() => {
    const marketLabels: Record<string, string> = {
      'over_2.5_goals': 'Over 2.5 Goals',
      'ht_over_0.5_goals': '1st Half Over 0.5 Blitz',
      home_win: 'Home Win Dominance',
      away_win: 'Away Win Counter',
      draw: 'Draw Hunter Equilibrium',
      corners: 'Corners Specialist',
    };
    const currentMarketName = marketLabels[activeMarket] || 'Other Markets';

    updatePageSeo({
      title: `${currentMarketName} Specialist Predictions — Oddsbanta AI`,
      description: `Mathematical models for ${currentMarketName} across 30 world football leagues. High-confidence Poisson, HVDI, CARE, Skellam, and NB GLM models.`,
      canonicalPath: '/other-markets',
    });
  }, [activeMarket]);

  // Client-side search & status filtering on the loaded batch
  const filteredPredictions = useMemo(() => {
    return predictions.filter((p) => {
      // Status filter
      if (statusFilter === 'won' && p.settlement_status !== 'won') return false;
      if (statusFilter === 'lost' && p.settlement_status !== 'lost') return false;
      if (statusFilter === 'pending' && p.settlement_status !== 'pending') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const home = (p.fixture?.home_team?.short_name || p.fixture?.home_team?.name || '').toLowerCase();
        const away = (p.fixture?.away_team?.short_name || p.fixture?.away_team?.name || '').toLowerCase();
        const league = (p.fixture?.league?.name || p.fixture?.league?.code || '').toLowerCase();
        if (!home.includes(q) && !away.includes(q) && !league.includes(q)) return false;
      }

      return true;
    });
  }, [predictions, statusFilter, searchQuery]);

  // Summary counts for current batch
  const statusStats = useMemo(() => {
    let won = 0;
    let lost = 0;
    let pending = 0;
    for (const p of predictions) {
      if (p.settlement_status === 'won') won++;
      else if (p.settlement_status === 'lost') lost++;
      else pending++;
    }
    return { total: predictions.length, won, lost, pending };
  }, [predictions]);

  // Synchronize active market count with actual predictions loaded for 100% badge-to-card harmony
  const displayCounts = useMemo(() => {
    return {
      ...marketCounts,
      [activeMarket]: predictions.length,
    };
  }, [marketCounts, activeMarket, predictions.length]);

  return (
    <DesktopSidebarLayout
      favoriteItems={favoriteItems}
      onToggleFavoriteItem={onToggleFavoriteItem}
      onOpenFavoritesDrawer={onOpenFavoritesDrawer}
    >
      <div className="goals-page-container" id="other-markets-top" style={{ maxWidth: '100%', padding: '0 0 80px 0' }}>
        {/* 1. SPECIALIST MARKET SWITCHBOARD (Positioned First directly below Header/Ad Banner) */}
      <MarketSwitchboardNav
        activeMarket={activeMarket}
        onSelectMarket={(m) => {
          setActiveMarket(m);
        }}
        counts={displayCounts}
        loading={loading}
        hideGeneral={true}
        title="MARKETS"
      />

      {/* 2. COMMAND ISLAND (Dates Selector + Status Scorecard Pills) */}
      <div className="goals-command-island">
        {/* TIER 1: Search (Hidden on Mobile) */}
        <div className="command-tier-primary search-only">
          <div className="goals-compact-search full-width">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search club, league, or competition..."
              value={searchQuery}
              onChange={(e) => {
                const q = e.target.value;
                setSearchQuery(q);
                if (q.trim().length >= 3) {
                  recordSportsSearch(q);
                  trackSportsSearchEvent(q, filteredPredictions.length);
                }
              }}
              className="compact-search-input"
            />
            {searchQuery && (
              <button className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>

        {/* TIER 2: Calendar Ribbon + Inline Status Scorecard Pills */}
        <div className="command-tier-secondary">
          <div className="calendar-ribbon">
            {/* 1. Select Date (Drop down of all past dates) */}
            <div className={`cal-pill cal-pill-dropdown-wrap ${isPastDateSelected ? 'active' : ''}`}>
              <span className="cal-pill-text-desktop">📅 {isPastDateSelected ? selectedPastFormatted : 'Select Date'} ▾</span>
              <span className="cal-pill-text-mobile">📅 {isPastDateSelected ? selectedPastFormatted : 'Date'} ▾</span>
              <select
                className="cal-date-native-select"
                value={isPastDateSelected ? dateFilter : ''}
                onChange={(e) => {
                  if (e.target.value) {
                    setDateFilter(e.target.value);
                  }
                }}
                aria-label="Select Past Date"
              >
                <option value="" disabled>Select Past Date...</option>
                {dateTabs.pastDates.map((pd) => (
                  <option key={pd.iso} value={pd.iso}>
                    {pd.formatted}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Yesterday */}
            <button
              type="button"
              className={`cal-pill ${dateFilter === dateTabs.yesterday.iso ? 'active' : ''}`}
              onClick={() => { setDateFilter(dateTabs.yesterday.iso); }}
            >
              <span className="cal-pill-text-desktop">⏪ Yesterday</span>
              <span className="cal-pill-text-mobile">Yesterday</span>
            </button>

            {/* 3. Today */}
            <button
              type="button"
              className={`cal-pill ${dateFilter === dateTabs.today.iso ? 'active' : ''}`}
              onClick={() => { setDateFilter(dateTabs.today.iso); }}
            >
              <span className="cal-pill-text-desktop">📍 Today</span>
              <span className="cal-pill-text-mobile">Today</span>
            </button>

            {/* 4. Day (with date) - Day + 1 */}
            <button
              type="button"
              className={`cal-pill ${dateFilter === dateTabs.day1.iso ? 'active' : ''}`}
              onClick={() => { setDateFilter(dateTabs.day1.iso); }}
            >
              <span className="cal-pill-text-desktop">{dateTabs.day1.fullLabel}</span>
              <span className="cal-pill-text-mobile">{dateTabs.day1.shortDay} {dateTabs.day1.iso.slice(8)}</span>
            </button>

            {/* 5. Day (with date) - Day + 2 */}
            <button
              type="button"
              className={`cal-pill ${dateFilter === dateTabs.day2.iso ? 'active' : ''}`}
              onClick={() => { setDateFilter(dateTabs.day2.iso); }}
            >
              <span className="cal-pill-text-desktop">{dateTabs.day2.fullLabel}</span>
              <span className="cal-pill-text-mobile">{dateTabs.day2.shortDay} {dateTabs.day2.iso.slice(8)}</span>
            </button>

            {/* 6. Day (with date) - Day + 3 */}
            <button
              type="button"
              className={`cal-pill ${dateFilter === dateTabs.day3.iso ? 'active' : ''}`}
              onClick={() => { setDateFilter(dateTabs.day3.iso); }}
            >
              <span className="cal-pill-text-desktop">{dateTabs.day3.fullLabel}</span>
              <span className="cal-pill-text-mobile">{dateTabs.day3.shortDay} {dateTabs.day3.iso.slice(8)}</span>
            </button>

            {/* 7. All Dates (current and future dates only) */}
            <button
              type="button"
              className={`cal-pill ${dateFilter === 'all' ? 'active' : ''}`}
              onClick={() => { setDateFilter('all'); }}
            >
              <span className="cal-pill-text-desktop">🌐 All Dates</span>
              <span className="cal-pill-text-mobile">All</span>
            </button>
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
              <span className="scorecard-text-desktop">Won ✅ ({statusStats.won})</span>
              <span className="scorecard-text-mobile">Won ({statusStats.won})</span>
            </button>
            <button
              type="button"
              className={`scorecard-pill lost ${statusFilter === 'lost' ? 'active' : ''}`}
              onClick={() => setStatusFilter('lost')}
            >
              <span className="scorecard-text-desktop">Lost ❌ ({statusStats.lost})</span>
              <span className="scorecard-text-mobile">Lost ({statusStats.lost})</span>
            </button>
            <button
              type="button"
              className={`scorecard-pill pending ${statusFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setStatusFilter('pending')}
            >
              <span className="scorecard-text-desktop">Pending ⏳ ({statusStats.pending})</span>
              <span className="scorecard-text-mobile">Pending ({statusStats.pending})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active Market Cards Stream (Continuous Vertical Scroll) */}
      <section className="other-markets-cards-section" style={{ marginTop: 14 }}>
        {loading ? (
          <div className="goals-loading-state" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div className="goals-spinner" />
            <p style={{ marginTop: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
              Calibrating {activeMarket.replace(/_/g, ' ').toUpperCase()} models...
            </p>
          </div>
        ) : error ? (
          <div className="goals-error-state" style={{ textAlign: 'center', padding: '30px 20px' }}>
            <p>⚠️ {error}</p>
            <button className="goals-retry-btn" onClick={loadMarketData}>
              Retry
            </button>
          </div>
        ) : filteredPredictions.length === 0 ? (
          <div className="goals-empty-state" style={{ textAlign: 'center', padding: '40px 20px', background: '#fff', borderRadius: 14, border: '1px solid #e2e8f0' }}>
            <span className="empty-icon" style={{ fontSize: '2rem' }}>⚽</span>
            <h3 style={{ margin: '10px 0 6px', fontWeight: 800 }}>No Signals in this Market</h3>
            <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: 14 }}>
              No matches found for the selected date or filter. Try switching dates or clearing filters.
            </p>
            <button
              className="reset-filter-btn"
              style={{
                background: '#0f172a',
                color: '#fff',
                padding: '8px 18px',
                borderRadius: 8,
                border: 'none',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              onClick={() => {
                setDateFilter('all');
                setStatusFilter('all');
                setSearchQuery('');
              }}
            >
              Reset Filters (View All Dates)
            </button>
          </div>
        ) : (
          <div className="specialist-cards-grid" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredPredictions.map((prediction, idx) => (
              <React.Fragment key={prediction.id || `${prediction.fixture_id}_${prediction.market}`}>
                <SpecialistMarketCard
                  prediction={prediction}
                  isFavorite={
                    isFavoriteItem
                      ? isFavoriteItem(prediction.fixture_id, prediction.market_label, prediction.prediction)
                      : false
                  }
                  onToggleFavorite={onToggleFavoriteItem}
                  onOpenUpgrade={onOpenSubscription}
                  isAdmin={isAdmin}
                />
                {(idx === 2 || idx === 6) && (
                  <div style={{ margin: '8px 0' }}>
                    <AdBannerSlot slotType="native-card" />
                  </div>
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </section>
    </div>
  </DesktopSidebarLayout>
);
};

export default OtherMarketsPage;
