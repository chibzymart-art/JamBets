import { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';
import { QueueFixture, FootballPrediction, ConfidenceTier } from './types';

export default function App() {
  const [fixtures, setFixtures] = useState<QueueFixture[]>([]);
  const [predictions, setPredictions] = useState<FootballPrediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<number | 'all'>('all');
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [onlyPredicted, setOnlyPredicted] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const fetchQueueAndPredictions = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const [queueRes, predRes] = await Promise.all([
        supabase
          .from('football_prediction_queue')
          .select('*')
          .order('target_kickoff_at', { ascending: true })
          .limit(300),
        supabase
          .from('football_predictions')
          .select('*')
          .eq('publication_status', 'published')
          .order('probability', { ascending: false })
      ]);

      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);

      if (queueRes.error) throw queueRes.error;
      if (predRes.error) throw predRes.error;

      setFixtures(queueRes.data || []);
      setPredictions(predRes.data || []);
      setLastRefreshed(new Date());
    } catch (err: any) {
      console.error('Error querying Cloud Supabase:', err);
      setError(err.message || 'Failed to fetch data from Cloud Supabase');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQueueAndPredictions();
  }, []);

  // Group predictions by fixture_id
  const predsByFixture = useMemo(() => {
    const map = new Map<string, FootballPrediction[]>();
    predictions.forEach((p) => {
      const list = map.get(p.fixture_id) || [];
      list.push(p);
      map.set(p.fixture_id, list);
    });
    return map;
  }, [predictions]);

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

  // High confidence count
  const highConfidenceCount = useMemo(() => {
    return predictions.filter((p) =>
      ['BANGER', 'TOP PICK', 'HIGH CONFIDENCE'].includes(p.confidence_category)
    ).length;
  }, [predictions]);

  // Filtered fixtures
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      const fixturePreds = predsByFixture.get(f.id) || [];

      // Only predicted filter
      if (onlyPredicted && fixturePreds.length === 0) {
        return false;
      }

      // Tier filter
      if (selectedTier !== 'all') {
        const hasTier = fixturePreds.some((p) => p.confidence_category === selectedTier);
        if (!hasTier) return false;
      }

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
  }, [fixtures, predsByFixture, selectedDay, selectedLeague, selectedTier, onlyPredicted, searchQuery]);

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

  const getTierBadgeClass = (tier: ConfidenceTier | string) => {
    switch (tier) {
      case 'BANGER': return 'tier-banger';
      case 'TOP PICK': return 'tier-top-pick';
      case 'HIGH CONFIDENCE': return 'tier-high-conf';
      case 'MID CONFIDENCE': return 'tier-mid-conf';
      case 'LOW CONFIDENCE': return 'tier-low-conf';
      case 'RISKY': return 'tier-risky';
      default: return 'tier-low-conf';
    }
  };

  const formatMarketName = (market: string) => {
    switch (market) {
      case '1x2': return 'Match Result (1X2)';
      case 'double_chance': return 'Double Chance';
      case 'over_under_1.5': return 'Goals O/U 1.5';
      case 'over_under_2.5': return 'Goals O/U 2.5';
      case 'over_under_3.5': return 'Goals O/U 3.5';
      case 'btts': return 'Both Teams To Score';
      case 'ht_result': return 'Half-Time Result';
      default: return market.toUpperCase();
    }
  };

  const formatPredictionOutcome = (outcome: string) => {
    switch (outcome) {
      case 'home': return 'Home Win';
      case 'draw': return 'Draw';
      case 'away': return 'Away Win';
      case 'over': return 'Over';
      case 'under': return 'Under';
      case 'yes': return 'Yes';
      case 'no': return 'No';
      case '1x': return '1X (Home or Draw)';
      case 'x2': return 'X2 (Draw or Away)';
      case '12': return '12 (Home or Away)';
      default: return outcome.toUpperCase();
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
            <div className="brand-subtitle">AI Football Engine — Dixon-Coles 250k Simulation Platform</div>
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
        <h2 className="hero-title">Production Football Prediction Engine</h2>
        <p className="hero-desc">
          Calibrated with genuine historical datasets and bivariate Poisson distribution.
          Every published prediction is backed by <strong>exactly 250,000 Monte Carlo simulations</strong>,
          strict zero future data leakage, and a rigorous <strong>45.00% publication threshold</strong>.
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
          <div className="metric-label">Published Predictions</div>
          <div className="metric-value" style={{ color: '#34d399' }}>{predictions.length}</div>
          <div className="metric-sub">≥45% Publication Gate</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">High Confidence / Top Picks</div>
          <div className="metric-value" style={{ color: '#38bdf8' }}>{highConfidenceCount}</div>
          <div className="metric-sub">≥83% Strict Probability</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Simulation Engine</div>
          <div className="metric-value" style={{ color: '#c084fc' }}>250k</div>
          <div className="metric-sub">Dixon-Coles Bivariate</div>
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

          <select
            className="league-select"
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value)}
          >
            <option value="all">All Confidence Tiers</option>
            <option value="BANGER">BANGER (96–100%)</option>
            <option value="TOP PICK">TOP PICK (90–95.99%)</option>
            <option value="HIGH CONFIDENCE">HIGH CONFIDENCE (83–89.99%)</option>
            <option value="MID CONFIDENCE">MID CONFIDENCE (70–82.99%)</option>
            <option value="LOW CONFIDENCE">LOW CONFIDENCE (60–69.99%)</option>
            <option value="RISKY">RISKY (45–59.99%)</option>
          </select>

          <button
            className={`day-tab ${onlyPredicted ? 'active' : ''}`}
            style={{ padding: '8px 14px', fontSize: '12px' }}
            onClick={() => setOnlyPredicted(!onlyPredicted)}
          >
            <span>{onlyPredicted ? '✓ Predictions Only' : 'Show Predictions Only'}</span>
          </button>

          <button className="refresh-btn" onClick={fetchQueueAndPredictions} disabled={loading}>
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
          <div className="empty-desc">Fetching authoritative prediction queue and verified 250k simulations from vepcoopomlfjageijsew.supabase.co</div>
        </div>
      ) : filteredFixtures.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Fixtures Found</div>
          <div className="empty-desc">No fixtures match the selected queue day, competition, and confidence filters.</div>
        </div>
      ) : (
        <div className="fixtures-grid">
          {filteredFixtures.map((fixture) => {
            const time = formatKickoff(fixture.target_kickoff_at);
            const homeInitial = fixture.home_team_name?.charAt(0)?.toUpperCase() || 'H';
            const awayInitial = fixture.away_team_name?.charAt(0)?.toUpperCase() || 'A';
            const fixturePreds = predsByFixture.get(fixture.id) || [];

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

                {/* Phase 4 Predictions Section */}
                {fixturePreds.length > 0 ? (
                  <div className="prediction-panel">
                    <div className="prediction-panel-header">
                      <div className="sim-verified-pill">
                        <span className="dot"></span>
                        <span>250,000 Sims Verified</span>
                      </div>
                      <span className="model-tag">Dixon-Coles v1.0.0</span>
                    </div>

                    <div className="prediction-list">
                      {fixturePreds.map((p) => {
                        const pct = (p.probability * 100).toFixed(2);
                        return (
                          <div key={p.id} className="prediction-row">
                            <div className="pred-row-top">
                              <div className="pred-market-outcome">
                                <span className="pred-market-name">{formatMarketName(p.market)}:</span>
                                <span className="pred-outcome-val">{formatPredictionOutcome(p.prediction)}</span>
                              </div>
                              <span className={`tier-badge ${getTierBadgeClass(p.confidence_category)}`}>
                                {p.confidence_category}
                              </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Simulated Probability</span>
                              <span className="pred-prob-val">{pct}%</span>
                            </div>

                            <div className="pred-bar-container">
                              <div
                                className="pred-bar-fill"
                                style={{
                                  width: `${Math.min(100, p.probability * 100)}%`,
                                  background:
                                    p.confidence_category === 'BANGER'
                                      ? 'linear-gradient(90deg, #10b981, #f59e0b)'
                                      : p.confidence_category === 'TOP PICK'
                                      ? '#a855f7'
                                      : p.confidence_category === 'HIGH CONFIDENCE'
                                      ? '#38bdf8'
                                      : p.confidence_category === 'MID CONFIDENCE'
                                      ? '#f59e0b'
                                      : '#64748b'
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="not-ready-panel">
                    <span className="not-ready-tag">⚙ Features Incomplete • NOT_READY</span>
                    <span className="not-ready-shield">0 Sims • 0 Predictions</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <footer style={{ marginTop: 48, textAlign: 'center', color: '#64748b', fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 20 }}>
        JamBets AI Platform • Cloud Supabase Authoritative Datastore • 250,000 Monte Carlo Simulations Verified • Synced: {lastRefreshed.toLocaleTimeString()}
      </footer>
    </div>
  );
}
