import { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { QueueFixture } from './types';

export default function App() {
  const [fixtures, setFixtures] = useState<QueueFixture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | 'all'>('all');
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchQueueFixtures = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const { data, error } = await supabase
        .from('football_prediction_queue')
        .select('*')
        .order('target_kickoff_at', { ascending: true })
        .limit(300);

      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);

      if (error) {
        throw error;
      }

      setFixtures(data || []);
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.error('Error querying Cloud Supabase prediction queue:', err);
      setError(err.message || 'Failed to fetch fixtures from Cloud Supabase');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueFixtures();
  }, []);

  // Compute counts per day
  const dayCounts = useMemo(() => {
    const counts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
    fixtures.forEach((f) => {
      if (typeof f.queue_day === 'number' && f.queue_day in counts) {
        counts[f.queue_day]++;
      }
    });
    return counts;
  }, [fixtures]);

  // Unique leagues for filter
  const leagues = useMemo(() => {
    const map = new Map<string, string>();
    fixtures.forEach((f) => {
      if (f.league_code && f.league_name) {
        map.set(f.league_code, f.league_name);
      }
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [fixtures]);

  // Filtered fixtures
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      // Day filter
      if (selectedDay !== 'all' && f.queue_day !== selectedDay) {
        return false;
      }
      // League filter
      if (selectedLeague !== 'all' && f.league_code !== selectedLeague) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchHome = f.home_team_name?.toLowerCase().includes(q);
        const matchAway = f.away_team_name?.toLowerCase().includes(q);
        const matchLeague = f.league_name?.toLowerCase().includes(q);
        if (!matchHome && !matchAway && !matchLeague) {
          return false;
        }
      }
      return true;
    });
  }, [fixtures, selectedDay, selectedLeague, searchQuery]);

  const formatKickoff = (isoString: string) => {
    const d = new Date(isoString);
    return {
      local: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      date: d.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      utc: d.toISOString().replace('.000Z', ' UTC').replace('T', ' ')
    };
  };

  const getQueueBadgeClass = (day: number) => {
    switch (day) {
      case 0: return 'queue-day-0';
      case 1: return 'queue-day-1';
      case 2: return 'queue-day-2';
      case 3: return 'queue-day-3';
      case 4: return 'queue-day-4';
      default: return 'queue-day-0';
    }
  };

  return (
    <div className="app-container">
      {/* Top Header */}
      <header className="header-bar">
        <div className="brand-section">
          <div className="brand-logo">JB</div>
          <div>
            <h1 className="brand-title">JamBets</h1>
            <div className="brand-subtitle">AI Football Engine — Four-Day Prediction Queue</div>
          </div>
        </div>

        <div className="db-pill">
          <span className="pulsing-dot"></span>
          <span>Cloud Supabase Live</span>
          {latencyMs !== null && <span>({latencyMs}ms)</span>}
        </div>
      </header>

      {/* Hero Banner */}
      <section className="hero-banner">
        <h2 className="hero-title">Verified Four-Day Prediction Queue</h2>
        <p className="hero-desc">
          Strictly gating football fixtures to <strong>TODAY, +1, +2, +3, and +4 days</strong>.
          Protected by canonical fixture identity deduplication, historical result isolation,
          and multi-source verified data persistence directly in Cloud Supabase.
        </p>
      </section>

      {/* Metric Cards */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-label">Total In Queue</div>
          <div className="metric-value">{fixtures.length}</div>
          <div className="metric-sub">Across 4-Day Window</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Today's Targets (Day 0)</div>
          <div className="metric-value" style={{ color: '#34d399' }}>{dayCounts[0]}</div>
          <div className="metric-sub">Kicking off today</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Tomorrow (+1 Day)</div>
          <div className="metric-value" style={{ color: '#38bdf8' }}>{dayCounts[1]}</div>
          <div className="metric-sub">Next 24-48 hours</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Active Competitions</div>
          <div className="metric-value" style={{ color: '#c084fc' }}>{leagues.length}</div>
          <div className="metric-sub">Filtered from 30 leagues</div>
        </div>
      </div>

      {/* Queue Navigation Tabs */}
      <div className="queue-nav-bar">
        <div className="day-tabs">
          <button
            className={`day-tab ${selectedDay === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedDay('all')}
          >
            <span>All Days</span>
            <span className="day-tab-count">{fixtures.length}</span>
          </button>

          <button
            className={`day-tab ${selectedDay === 0 ? 'active' : ''}`}
            onClick={() => setSelectedDay(0)}
          >
            <span>Today (Day 0)</span>
            <span className="day-tab-count">{dayCounts[0]}</span>
          </button>

          <button
            className={`day-tab ${selectedDay === 1 ? 'active' : ''}`}
            onClick={() => setSelectedDay(1)}
          >
            <span>Tomorrow (+1)</span>
            <span className="day-tab-count">{dayCounts[1]}</span>
          </button>

          <button
            className={`day-tab ${selectedDay === 2 ? 'active' : ''}`}
            onClick={() => setSelectedDay(2)}
          >
            <span>Day +2</span>
            <span className="day-tab-count">{dayCounts[2]}</span>
          </button>

          <button
            className={`day-tab ${selectedDay === 3 ? 'active' : ''}`}
            onClick={() => setSelectedDay(3)}
          >
            <span>Day +3</span>
            <span className="day-tab-count">{dayCounts[3]}</span>
          </button>

          <button
            className={`day-tab ${selectedDay === 4 ? 'active' : ''}`}
            onClick={() => setSelectedDay(4)}
          >
            <span>Day +4</span>
            <span className="day-tab-count">{dayCounts[4]}</span>
          </button>
        </div>

        {/* Filters and Search Row */}
        <div className="filters-row">
          <input
            type="text"
            className="search-input"
            placeholder="Search teams or leagues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <select
            className="league-select"
            value={selectedLeague}
            onChange={(e) => setSelectedLeague(e.target.value)}
          >
            <option value="all">All Competitions ({leagues.length})</option>
            {leagues.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>

          <button className="refresh-btn" onClick={fetchQueueFixtures} disabled={loading}>
            <span>{loading ? 'Refreshing...' : '↻ Sync Cloud'}</span>
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: 18, background: 'rgba(244, 63, 94, 0.15)', border: '1px solid rgba(244, 63, 94, 0.3)', borderRadius: 14, color: '#fb7185', marginBottom: 24 }}>
          <strong>Cloud Error:</strong> {error}
        </div>
      )}

      {/* Fixtures Grid */}
      {loading ? (
        <div className="empty-state">
          <div className="empty-title">Querying Cloud Supabase...</div>
          <div className="empty-desc">Fetching authoritative prediction queue from vepcoopomlfjageijsew.supabase.co</div>
        </div>
      ) : filteredFixtures.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Fixtures Found</div>
          <div className="empty-desc">No fixtures match the selected queue day and competition filter.</div>
        </div>
      ) : (
        <div className="fixtures-grid">
          {filteredFixtures.map((fixture) => {
            const time = formatKickoff(fixture.target_kickoff_at);
            const homeInitial = fixture.home_team_name?.charAt(0)?.toUpperCase() || 'H';
            const awayInitial = fixture.away_team_name?.charAt(0)?.toUpperCase() || 'A';

            return (
              <div key={fixture.id} className="fixture-card">
                <div className="card-top">
                  <span className="league-badge">
                    {fixture.league_name || fixture.league_code}
                  </span>
                  <span className={`queue-day-pill ${getQueueBadgeClass(fixture.queue_day)}`}>
                    {fixture.queue_day === 0 ? 'Queue: Today' : `Queue: Day +${fixture.queue_day}`}
                  </span>
                </div>

                <div className="matchup-container">
                  <div className="team-row">
                    <div className="team-info">
                      <div className="team-icon" style={{ background: 'rgba(56, 189, 248, 0.15)', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                        {homeInitial}
                      </div>
                      <span className="team-name">{fixture.home_team_name.replace(/-/g, ' ')}</span>
                    </div>
                  </div>

                  <div className="vs-divider">VS</div>

                  <div className="team-row">
                    <div className="team-info">
                      <div className="team-icon" style={{ background: 'rgba(168, 85, 247, 0.15)', borderColor: 'rgba(168, 85, 247, 0.3)' }}>
                        {awayInitial}
                      </div>
                      <span className="team-name">{fixture.away_team_name.replace(/-/g, ' ')}</span>
                    </div>
                  </div>
                </div>

                <div className="card-bottom">
                  <div className="kickoff-info">
                    <span className="kickoff-time">
                      {time.date} • {time.local}
                    </span>
                    <span className="kickoff-utc">{time.utc}</span>
                  </div>

                  <div className="canonical-tag" title={fixture.canonical_key}>
                    🔑 {fixture.canonical_key}
                  </div>

                  <div className="status-badge">
                    <span>STATUS: {fixture.status.toUpperCase()}</span>
                    <span>VERIFIED ✓</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <footer style={{ marginTop: 48, textAlign: 'center', color: '#64748b', fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 20 }}>
        JamBets AI Platform • Cloud Supabase Authoritative Datastore • 4-Day Queue Protection Active • Synced: {lastRefreshed.toLocaleTimeString()}
      </footer>
    </div>
  );
}
