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
  const [dateFilter, setDateFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Check if current user has authoritative paid access
  const isPaidUser = useMemo(() => {
    if (isAdmin) return true;
    if (userRole === 'admin' || userRole === 'standard' || userRole === 'bigbang') return true;
    return false;
  }, [isAdmin, userRole]);

  // Dynamic 4-day Date Options in Africa/Lagos (WAT / UTC+1)
  const dateOptions = useMemo(() => {
    const list: { key: string; label: string }[] = [
      { key: 'all', label: 'All Matches (4 Days)' }
    ];

    const now = new Date();
    for (let i = 0; i < 4; i++) {
      const d = new Date(now.getTime() + i * 86400000);
      const isoDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);

      let label = '';
      if (i === 0) {
        label = 'Today';
      } else if (i === 1) {
        label = 'Tomorrow';
      } else {
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Africa/Lagos',
          weekday: 'short',
          month: 'short',
          day: 'numeric'
        }).format(d);
        label = formatted;
      }

      list.push({ key: isoDate, label });
    }

    return list;
  }, []);

  // Fetch Goals Specialist Data
  const fetchGoalsData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Attempt Edge API first with user auth token, gracefully fallback to Supabase query
      let data: GoalPredictionItem[] = [];
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
        // Continue to direct Supabase fallback
      }

      if (data.length === 0) {
        // Direct Supabase fallback
        const selectQuery = `
          id, fixture_id, market, predicted_outcome, probability, confidence_tier,
          xg_combined, home_over25_rate, away_over25_rate, h2h_over25_rate,
          ht_goal_frequency, avg_first_goal_minute, target_kickoff_at, settlement_status,
          settled_at, actual_score, ht_score, settlement_notes, is_locked, metadata,
          fixture:football_fixtures!inner(
            id, target_kickoff_at, status, period, match_minute,
            home_score, away_score, half_time_home_score, half_time_away_score,
            league:football_leagues!inner(id, name, code, country),
            home_team:football_teams!football_fixtures_home_team_id_fkey(id, name),
            away_team:football_teams!football_fixtures_away_team_id_fkey(id, name)
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

  // Filtered & Sorted Predictions (Highest Rating / Confidence First)
  const filteredPredictions = useMemo(() => {
    const list = predictions.filter((p) => {
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

          if (pLagosDate !== dateFilter) return false;
        } catch {}
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hName = p.fixture?.home_team?.name || (p.metadata as any)?.home_team || '';
        const aName = p.fixture?.away_team?.name || (p.metadata as any)?.away_team || '';
        const lName = p.fixture?.league?.name || (p.metadata as any)?.league || '';
        if (!hName.toLowerCase().includes(q) && !aName.toLowerCase().includes(q) && !lName.toLowerCase().includes(q)) {
          return false;
        }
      }

      return true;
    });

    // 5. Strictly sort: highest ratings down to lowest order!
    return list.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
  }, [predictions, marketFilter, dateFilter, searchQuery]);


  return (
    <div className="goals-page-container">
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
            ✓ Settled
          </button>
        </div>

        {/* Date Filter (Next 4 Days) & Search Row */}
        <div className="goals-subfilters-row">
          <div className="goals-date-pills">
            {dateOptions.map((opt) => (
              <button
                key={opt.key}
                className={`date-pill ${dateFilter === opt.key ? 'active' : ''}`}
                onClick={() => setDateFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
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
                onOpenUpgrade={currentUser ? onOpenSubscription : () => onOpenAuth('signin')}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
