import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { GoalCard, GoalPredictionItem, GroupedGoalMatch, formatClubName } from '../components/GoalCard';
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
  const [rawPredictions, setRawPredictions] = useState<GoalPredictionItem[]>([]);
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

  // Group raw predictions by fixture_id into unified Match Rows (Eliminating duplicate fixtures!)
  const groupedMatches = useMemo(() => {
    const fixtureMap = new Map<string, GroupedGoalMatch>();

    for (const pred of rawPredictions) {
      const fid = pred.fixture_id;
      const f = pred.fixture;

      if (!fixtureMap.has(fid)) {
        const rawHome = f?.home_team?.short_name || f?.home_team?.name || f?.home_team_name || (pred.metadata as any)?.home_team || 'Home Club';
        const rawAway = f?.away_team?.short_name || f?.away_team?.name || f?.away_team_name || (pred.metadata as any)?.away_team || 'Away Club';
        const rawLeague = f?.league?.name || f?.league_name || (pred.metadata as any)?.league || 'Football League';

        fixtureMap.set(fid, {
          fixture_id: fid,
          target_kickoff_at: pred.target_kickoff_at || f?.target_kickoff_at || '',
          status: f?.status || 'scheduled',
          period: f?.period,
          match_minute: f?.match_minute,
          home_score: f?.home_score,
          away_score: f?.away_score,
          half_time_home_score: f?.half_time_home_score,
          half_time_away_score: f?.half_time_away_score,
          league_name: rawLeague,
          home_team_name: rawHome,
          away_team_name: rawAway,
          actual_score: pred.actual_score || null,
          ht_score: pred.ht_score || null,
          settlement_status: pred.settlement_status || 'pending',
          over25: null,
          ht05: null,
          maxProbability: 0,
        });
      }

      const match = fixtureMap.get(fid)!;
      if (pred.market === 'over_2.5_goals') {
        match.over25 = pred;
      } else if (pred.market === 'ht_over_0.5_goals') {
        match.ht05 = pred;
      }

      if (pred.actual_score) match.actual_score = pred.actual_score;
      if (pred.ht_score) match.ht_score = pred.ht_score;
      if (pred.settlement_status !== 'pending') match.settlement_status = pred.settlement_status;

      // Calculate max probability for ranking (supports robust fallback for preview ranking)
      const pOver = match.over25?.probability ?? (
        match.over25?.xg_combined ? Math.min(0.88, Math.max(0.62, (match.over25.xg_combined / 4.0) * 0.85)) : 0.6
      );
      const pHt = match.ht05?.probability ?? (
        match.ht05?.ht_goal_frequency ? match.ht05.ht_goal_frequency / 100.0 : 0.7
      );
      match.maxProbability = Math.max(pOver, pHt);
    }

    return Array.from(fixtureMap.values());
  }, [rawPredictions]);

  // Filtered and sorted matches (Highest ratings first, descending)
  const filteredMatches = useMemo(() => {
    const list = groupedMatches.filter((m) => {
      // 1. Market Filter
      if (marketFilter === 'over_2.5_goals' && !m.over25) return false;
      if (marketFilter === 'ht_over_0.5_goals' && !m.ht05) return false;
      if (marketFilter === 'settled' && m.settlement_status === 'pending') return false;

      // 2. Date Filter
      if (dateFilter !== 'all') {
        try {
          const mLagosDate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Africa/Lagos',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }).format(new Date(m.target_kickoff_at));

          if (mLagosDate !== dateFilter) return false;
        } catch {}
      }

      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const hName = formatClubName(m.home_team_name).toLowerCase();
        const aName = formatClubName(m.away_team_name).toLowerCase();
        const lName = m.league_name.toLowerCase();
        if (!hName.includes(q) && !aName.includes(q) && !lName.includes(q)) {
          return false;
        }
      }

      return true;
    });

    // 4. Strictly sort by highest ratings / confidence first!
    return list.sort((a, b) => (b.maxProbability ?? 0) - (a.maxProbability ?? 0));
  }, [groupedMatches, marketFilter, dateFilter, searchQuery]);

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
            🔥 All Matches ({groupedMatches.length})
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
            ✓ Settled Scores
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
      </div>

      {/* Grouped Match Rows Container with Thick Border Separators */}
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
        ) : filteredMatches.length === 0 ? (
          <div className="goals-empty-state">
            <span className="empty-icon">⚽</span>
            <h3>No Matches Found</h3>
            <p>No games matched your current market or date filter. Try selecting "All Matches".</p>
            <button
              className="reset-filter-btn"
              onClick={() => { setMarketFilter('all'); setDateFilter('all'); setSearchQuery(''); }}
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="goals-cards-grid">
            {filteredMatches.map((match, idx) => (
              <GoalCard
                key={match.fixture_id}
                match={match}
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
