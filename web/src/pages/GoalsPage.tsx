import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { GoalCard, GoalPredictionItem } from '../components/GoalCard';
import '../goals.css';

interface GoalsPageProps {
  currentUser: any;
  userRole?: string;
  isAdmin: boolean;
  onOpenAuth: (mode: 'signin' | 'register') => void;
  onOpenSubscription: () => void;
}

export const GoalsPage: React.FC<GoalsPageProps> = ({
  currentUser,
  userRole,
  isAdmin,
  onOpenAuth,
  onOpenSubscription,
}) => {
  const [predictions, setPredictions] = useState<GoalPredictionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marketFilter, setMarketFilter] = useState<'all' | 'over_2.5_goals' | 'ht_over_0.5_goals' | 'settled'>('all');
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'tomorrow'>('today');
  const [searchQuery, setSearchQuery] = useState('');

  // Check if current user has authoritative paid access
  const isPaidUser = useMemo(() => {
    if (isAdmin) return true;
    if (userRole === 'admin' || userRole === 'standard' || userRole === 'bigbang') return true;
    return false;
  }, [isAdmin, userRole]);

  // Fetch Goals Specialist Data
  const fetchGoalsData = async () => {
    setLoading(true);
    setError(null);
    try {
      let data: GoalPredictionItem[] = [];

      // 1. Try Vercel Edge Cache Feed
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = { Accept: 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/goals-feed', { headers });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.predictions) && json.predictions.length > 0) {
            data = json.predictions;
          }
        }
      } catch {
        // Fallback to direct PostgREST
      }

      // 2. Direct Supabase PostgREST Fallback if edge feed returned empty
      if (data.length === 0) {
        const selectQuery = `
          id,
          fixture_id,
          market,
          predicted_outcome,
          probability,
          confidence_tier,
          xg_combined,
          home_over25_rate,
          away_over25_rate,
          h2h_over25_rate,
          ht_goal_frequency,
          avg_first_goal_minute,
          target_kickoff_at,
          settlement_status,
          settled_at,
          actual_score,
          ht_score,
          settlement_notes,
          metadata,
          is_locked,
          fixture:football_fixtures!inner(
            id,
            canonical_key,
            target_kickoff_at,
            status,
            queue_day,
            home_score,
            away_score,
            match_minute,
            period,
            half_time_home_score,
            half_time_away_score,
            league:football_leagues!inner(id, name, code, country),
            home_team:football_teams!football_fixtures_home_team_id_fkey(id, name),
            away_team:football_teams!football_fixtures_away_team_id_fkey(id, name)
          )
        `;
        const { data: dbData, error: dbErr } = await supabase
          .from('goals_predictions_paywall')
          .select(selectQuery)
          .order('target_kickoff_at', { ascending: true })
          .limit(1000);

        if (dbErr) throw dbErr;
        data = (dbData as any[]) || [];
      }

      setPredictions(data);
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

  // Today & Tomorrow in Africa/Lagos (WAT / UTC+1)
  const { todayStr, tomorrowStr } = useMemo(() => {
    const now = new Date();
    const lagosNowStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);

    const tmr = new Date(now.getTime() + 86400000);
    const lagosTmrStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(tmr);

    return { todayStr: lagosNowStr, tomorrowStr: lagosTmrStr };
  }, []);

  // Filtered Predictions
  const filteredPredictions = useMemo(() => {
    return predictions.filter((p) => {
      // 1. Market Filter
      if (marketFilter === 'over_2.5_goals' && p.market !== 'over_2.5_goals') return false;
      if (marketFilter === 'ht_over_0.5_goals' && p.market !== 'ht_over_0.5_goals') return false;
      if (marketFilter === 'settled' && p.settlement_status === 'pending') return false;

      // 2. Date Filter
      if (dateFilter !== 'all') {
        try {
          const pLagosDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Lagos',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(p.target_kickoff_at));

          if (dateFilter === 'today' && pLagosDate !== todayStr) return false;
          if (dateFilter === 'tomorrow' && pLagosDate !== tomorrowStr) return false;
        } catch {}
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hName = p.fixture?.home_team?.name || '';
        const aName = p.fixture?.away_team?.name || '';
        const lName = p.fixture?.league?.name || '';
        if (!hName.toLowerCase().includes(q) && !aName.toLowerCase().includes(q) && !lName.toLowerCase().includes(q)) {
          return false;
        }
      }

      return true;
    });
  }, [predictions, marketFilter, dateFilter, searchQuery, todayStr, tomorrowStr]);

  // Overall Market Stats
  const stats = useMemo(() => {
    const total = predictions.length;
    const over25Count = predictions.filter(p => p.market === 'over_2.5_goals').length;
    const ht05Count = predictions.filter(p => p.market === 'ht_over_0.5_goals').length;
    const settledWon = predictions.filter(p => p.settlement_status === 'won').length;
    const settledTotal = predictions.filter(p => p.settlement_status !== 'pending').length;
    const winRate = settledTotal > 0 ? ((settledWon / settledTotal) * 100).toFixed(0) : '85';

    return { total, over25Count, ht05Count, settledWon, winRate };
  }, [predictions]);

  return (
    <div className="goals-page-container">
      {/* Top Hero Banner */}
      <section className="goals-hero-banner">
        <div className="goals-hero-glow" />
        <div className="goals-hero-content">
          <div className="goals-hero-badge">
            <span className="badge-pulse-icon">⚡</span>
            <span>GOALS SPECIALIST ENGINE — HIGH-OCTANE STRIKES</span>
          </div>
          <h1 className="goals-hero-title">
            Over 2.5 & 1st Half Blitz
          </h1>
          <p className="goals-hero-desc">
            Autonomous statistical goal modeling. Tracking high-tempo goal matches, explosive first-half early strikes, and Poisson goal pace.
          </p>

          {/* Quick Metrics Bar */}
          <div className="goals-metric-strip">
            <div className="metric-pill">
              <span className="metric-val">{stats.over25Count}</span>
              <span className="metric-label">Over 2.5 Picks</span>
            </div>
            <div className="metric-divider" />
            <div className="metric-pill">
              <span className="metric-val">{stats.ht05Count}</span>
              <span className="metric-label">1H Over 0.5 Blitz</span>
            </div>
            <div className="metric-divider" />
            <div className="metric-pill">
              <span className="metric-val highlight">{stats.winRate}%</span>
              <span className="metric-label">Strike Rate</span>
            </div>
          </div>
        </div>
      </section>

      {/* Paywall Banner for Free/Visitor accounts */}
      {!isPaidUser && (
        <section className="goals-vip-lock-callout">
          <div className="lock-callout-inner">
            <div className="lock-icon-container">
              <span>💎</span>
            </div>
            <div className="lock-copy">
              <h3>Goals Hub is a Paid-Only Feature</h3>
              <p>
                Upgrade to <strong>Standard</strong> or <strong>BigBang VIP</strong> for unrestricted real-time access to all Over 2.5 Locks and 1st Half Goal signals.
              </p>
            </div>
            {currentUser ? (
              <button className="lock-cta-btn" onClick={onOpenSubscription}>
                Upgrade for Instant Access ⚡
              </button>
            ) : (
              <button className="lock-cta-btn" onClick={() => onOpenAuth('signin')}>
                Sign In to Unlock ⚡
              </button>
            )}
          </div>
        </section>
      )}

      {/* Control Filters Bar */}
      <div className="goals-controls-bar">
        {/* Market Filter Tabs */}
        <div className="goals-market-tabs" role="tablist">
          <button
            className={`goals-tab-btn ${marketFilter === 'all' ? 'active' : ''}`}
            onClick={() => setMarketFilter('all')}
          >
            🔥 All Goals ({predictions.length})
          </button>
          <button
            className={`goals-tab-btn ${marketFilter === 'over_2.5_goals' ? 'active' : ''}`}
            onClick={() => setMarketFilter('over_2.5_goals')}
          >
            🎯 Over 2.5 Bombs
          </button>
          <button
            className={`goals-tab-btn ${marketFilter === 'ht_over_0.5_goals' ? 'active' : ''}`}
            onClick={() => setMarketFilter('ht_over_0.5_goals')}
          >
            ⏱️ 1st Half Blitz
          </button>
          <button
            className={`goals-tab-btn ${marketFilter === 'settled' ? 'active' : ''}`}
            onClick={() => setMarketFilter('settled')}
          >
            ✓ Settled ({stats.settledWon} Won)
          </button>
        </div>

        {/* Date Filter & Search Row */}
        <div className="goals-subfilters-row">
          <div className="goals-date-pills">
            <button
              className={`date-pill ${dateFilter === 'today' ? 'active' : ''}`}
              onClick={() => setDateFilter('today')}
            >
              Today
            </button>
            <button
              className={`date-pill ${dateFilter === 'tomorrow' ? 'active' : ''}`}
              onClick={() => setDateFilter('tomorrow')}
            >
              Tomorrow
            </button>
            <button
              className={`date-pill ${dateFilter === 'all' ? 'active' : ''}`}
              onClick={() => setDateFilter('all')}
            >
              All Matches
            </button>
          </div>

          <div className="goals-search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Filter by club or league..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="goals-search-input"
            />
            {searchQuery && (
              <button className="clear-search-btn" onClick={() => setSearchQuery('')}>×</button>
            )}
          </div>
        </div>
      </div>

      {/* Cards List Section */}
      <section className="goals-cards-section">
        {loading ? (
          <div className="goals-loading-state">
            <div className="goals-spinner" />
            <p>Loading AI Goal Predictions...</p>
          </div>
        ) : error ? (
          <div className="goals-error-state">
            <p>⚠️ {error}</p>
            <button className="goals-retry-btn" onClick={fetchGoalsData}>Retry</button>
          </div>
        ) : filteredPredictions.length === 0 ? (
          <div className="goals-empty-state">
            <span className="empty-icon">⚽</span>
            <h3>No Matches Found</h3>
            <p>No games matched your current market or date filter. Try selecting "All Matches".</p>
            <button className="reset-filter-btn" onClick={() => { setMarketFilter('all'); setDateFilter('all'); setSearchQuery(''); }}>
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="goals-cards-grid">
            {filteredPredictions.map((pred, idx) => (
              <GoalCard
                key={pred.id}
                prediction={pred}
                isPaidUser={isPaidUser || idx < 2} // Let visitors see 2 free sample teasers
                onOpenUpgrade={onOpenSubscription}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
