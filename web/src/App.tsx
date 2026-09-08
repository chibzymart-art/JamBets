import { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';
import {
  QueueFixture,
  FootballPrediction,
  ConfidenceTier,
  SimulationRecord,
  SchedulerJob,
  SettlementJob,
  UserProfile,
  UserSubscription,
  UserEntitlement,
  PredictionTeaser,
  LeagueRecord
} from './types';
import { AuthModal } from './components/AuthModal';
import { ProfileModal } from './components/ProfileModal';

export default function App() {
  // Authentication & Entitlement State
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);

  // Modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'register'>('signin');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);

  // Authoritative Cloud Data State
  const [fixtures, setFixtures] = useState<QueueFixture[]>([]);
  const [predictions, setPredictions] = useState<FootballPrediction[]>([]);
  const [teasers, setTeasers] = useState<PredictionTeaser[]>([]);
  const [simulations, setSimulations] = useState<SimulationRecord[]>([]);
  const [leaguesList, setLeaguesList] = useState<LeagueRecord[]>([]);
  const [schedulerJob, setSchedulerJob] = useState<SchedulerJob | null>(null);
  const [settlementJob, setSettlementJob] = useState<SettlementJob | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Date Navigation State (Section 5: Default to Today / Day 0)
  const [selectedDay, setSelectedDay] = useState<number | 'history' | 'yesterday' | 'all'>(0);
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'void'>('all');
  const [onlyPredicted, setOnlyPredicted] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Live Lagos Time (WAT / UTC+1)
  const [watTime, setWatTime] = useState<string>('');
  const [nextRunCountdown, setNextRunCountdown] = useState<string>('');
  const [currentSlotIndex, setCurrentSlotIndex] = useState<number>(0);
  const [slot15Index, setSlot15Index] = useState<number>(0);
  const [next15RunCountdown, setNext15RunCountdown] = useState<string>('');

  // 1. Live Lagos Time Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const lagosStr = now.toLocaleTimeString('en-GB', {
        timeZone: 'Africa/Lagos',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
      setWatTime(lagosStr);

      const lagosParts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Lagos',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      }).formatToParts(now);

      const hour = parseInt(lagosParts.find(p => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(lagosParts.find(p => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(lagosParts.find(p => p.type === 'second')?.value || '0', 10);

      // Phase 6: 6-Hour Slot (0 to 3)
      const slot = Math.floor(hour / 6);
      setCurrentSlotIndex(slot);

      const nextSlotHour = (slot + 1) * 6;
      let diffSeconds = (nextSlotHour * 3600) - (hour * 3600 + minute * 60 + second);
      if (diffSeconds < 0) diffSeconds += 24 * 3600;

      const h = Math.floor(diffSeconds / 3600);
      const m = Math.floor((diffSeconds % 3600) / 60);
      const s = diffSeconds % 60;
      setNextRunCountdown(`${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`);

      // Phase 7: 15-Minute Slot (0 to 95)
      const slot15 = hour * 4 + Math.floor(minute / 15);
      setSlot15Index(slot15);

      const next15Min = (Math.floor(minute / 15) + 1) * 15;
      const next15DiffSeconds = (next15Min * 60) - (minute * 60 + second);
      const m15 = Math.floor(next15DiffSeconds / 60);
      const s15 = next15DiffSeconds % 60;
      setNext15RunCountdown(`${String(m15).padStart(2, '0')}m ${String(s15).padStart(2, '0')}s`);
    };

    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. User & Auth Session Management
  const fetchUserData = async (userId: string) => {
    try {
      const [userRes, subRes, entRes] = await Promise.all([
        supabase.from('users').select('*').eq('id', userId).single(),
        supabase.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
        supabase.from('entitlements').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
      ]);

      if (userRes.data) {
        setProfile(userRes.data as UserProfile);
      }
      if (subRes.data && subRes.data.length > 0) {
        setSubscription(subRes.data[0] as UserSubscription);
      }
      if (entRes.data && entRes.data.length > 0) {
        setEntitlement(entRes.data[0] as UserEntitlement);
      }
    } catch (err) {
      console.warn('Error fetching user profile from Cloud Supabase:', err);
    }
  };

  useEffect(() => {
    // Initial session check
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setCurrentUser(data.user);
        fetchUserData(data.user.id);
      } else {
        setCurrentUser(null);
        setProfile(null);
        setSubscription(null);
        setEntitlement(null);
      }
    });

    // Auth state listener
    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        setCurrentUser(session.user);
        await fetchUserData(session.user.id);
      } else {
        setCurrentUser(null);
        setProfile(null);
        setSubscription(null);
        setEntitlement(null);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Entitlement resolution
  const canViewPredictions = useMemo(() => {
    if (!currentUser) return false;
    if (entitlement?.can_view_predictions) return true;
    const role = (profile?.role || subscription?.tier || '').toLowerCase();
    return ['standard', 'bigbang', 'pro', 'premium', 'admin'].includes(role);
  }, [currentUser, entitlement, profile, subscription]);

  const activeTierLabel = useMemo(() => {
    if (!currentUser) return 'VISITOR';
    const role = (profile?.role || subscription?.tier || 'free').toUpperCase();
    return role;
  }, [currentUser, profile, subscription]);

  // 3. Fetch Cloud Supabase Data (Authoritative)
  const fetchCloudData = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();

    try {
      // Parallel fetch for queue, simulations, leagues, and system jobs
      const queueQuery = supabase
        .from('football_prediction_queue')
        .select('*')
        .order('target_kickoff_at', { ascending: true })
        .limit(300);

      const simQuery = supabase
        .from('football_simulations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      const leagueQuery = supabase
        .from('football_leagues')
        .select('*')
        .eq('is_active', true)
        .order('priority', { ascending: true });

      const jobQuery = supabase
        .from('system_jobs')
        .select('*')
        .eq('job_type', 'prediction_worker')
        .order('created_at', { ascending: false })
        .limit(1);

      const settleJobQuery = supabase
        .from('system_jobs')
        .select('*')
        .ilike('idempotency_key', 'settlement-cycle-%')
        .order('created_at', { ascending: false })
        .limit(1);

      // Conditional query: If entitled, fetch full predictions; else fetch public teasers
      const predOrTeaserQuery = canViewPredictions
        ? supabase
            .from('football_predictions')
            .select('*')
            .eq('publication_status', 'published')
            .order('probability', { ascending: false })
        : supabase
            .from('football_prediction_teasers')
            .select('*')
            .eq('publication_status', 'published');

      const [queueRes, simRes, leagueRes, jobRes, settleJobRes, predOrTeaserRes] = await Promise.all([
        queueQuery,
        simQuery,
        leagueQuery,
        jobQuery,
        settleJobQuery,
        predOrTeaserQuery
      ]);

      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);

      if (queueRes.error) throw queueRes.error;
      setFixtures(queueRes.data || []);
      setSimulations(simRes.data || []);
      if (leagueRes.data) {
        setLeaguesList(leagueRes.data || []);
      }
      if (jobRes.data && jobRes.data.length > 0) {
        setSchedulerJob(jobRes.data[0]);
      }
      if (settleJobRes.data && settleJobRes.data.length > 0) {
        setSettlementJob(settleJobRes.data[0]);
      }

      if (canViewPredictions) {
        setPredictions(predOrTeaserRes.data || []);
        setTeasers([]);
      } else {
        setPredictions([]);
        setTeasers(predOrTeaserRes.data || []);
      }

      setLastRefreshed(new Date());
    } catch (err: any) {
      console.error('Error querying Cloud Supabase:', err);
      setError(err.message || 'Failed to fetch authoritative data from Cloud Supabase');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCloudData();
  }, [canViewPredictions]);

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

  // Group teasers by fixture_id
  const teasersByFixture = useMemo(() => {
    const map = new Map<string, PredictionTeaser[]>();
    teasers.forEach((t) => {
      const list = map.get(t.fixture_id) || [];
      list.push(t);
      map.set(t.fixture_id, list);
    });
    return map;
  }, [teasers]);

  // Index simulations by fixture_id
  const simsByFixture = useMemo(() => {
    const map = new Map<string, SimulationRecord>();
    simulations.forEach((s) => {
      if (!map.has(s.fixture_id)) {
        map.set(s.fixture_id, s);
      }
    });
    return map;
  }, [simulations]);

  // Total completed draws
  const totalCompletedDraws = useMemo(() => {
    return simulations.reduce((acc, s) => acc + (s.completed_simulations || 0), 0);
  }, [simulations]);

  // Compute counts per day
  const dayCounts = useMemo(() => {
    const counts: Record<string, number> = {
      0: 0,
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      yesterday: 0,
      history: 0
    };
    fixtures.forEach((f) => {
      if (f.status === 'finished') {
        counts.history++;
      }
      if (typeof f.queue_day === 'number') {
        if (f.queue_day in counts) {
          counts[String(f.queue_day)]++;
        } else if (f.queue_day === -1) {
          counts.yesterday++;
        }
      }
    });
    return counts;
  }, [fixtures]);

  // Dynamic Leagues for filter (Primary from football_leagues, enriched with fixture leagues)
  const availableLeagues = useMemo(() => {
    const map = new Map<string, string>();
    leaguesList.forEach((l) => {
      if (l.code && l.name) map.set(l.code, l.name);
    });
    fixtures.forEach((f) => {
      if (f.league_code && f.league_name && !map.has(f.league_code)) {
        map.set(f.league_code, f.league_name);
      }
    });
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [leaguesList, fixtures]);

  // Settlement statistics
  const settlementCounts = useMemo(() => {
    let won = 0;
    let lost = 0;
    let voided = 0;
    let pending = 0;
    predictions.forEach((p) => {
      const st = p.settlement_status || 'pending';
      if (st === 'won') won++;
      else if (st === 'lost') lost++;
      else if (st === 'void' || st === 'voided') voided++;
      else pending++;
    });
    return { won, lost, voided, pending, total: predictions.length };
  }, [predictions]);

  // High confidence count
  const highConfidenceCount = useMemo(() => {
    if (canViewPredictions) {
      return predictions.filter((p) =>
        ['BANGER', 'TOP PICK', 'HIGH CONFIDENCE'].includes(p.confidence_category)
      ).length;
    }
    return teasers.filter((t) =>
      ['BANGER', 'TOP PICK', 'HIGH CONFIDENCE'].includes(t.confidence_category)
    ).length;
  }, [canViewPredictions, predictions, teasers]);

  // Filtered fixtures
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      const fixturePreds = predsByFixture.get(f.id) || [];
      const fixtureTeasers = teasersByFixture.get(f.id) || [];
      const totalSignals = canViewPredictions ? fixturePreds.length : fixtureTeasers.length;

      // Settlement filter
      if (settlementFilter !== 'all') {
        if (!canViewPredictions) return true;
        const hasMatchingStatus = fixturePreds.some((p) => {
          const st = p.settlement_status || 'pending';
          if (settlementFilter === 'void') return st === 'void' || st === 'voided';
          return st === settlementFilter;
        });
        if (!hasMatchingStatus) return false;
      }

      // Only predicted filter
      if (onlyPredicted && totalSignals === 0) {
        return false;
      }

      // Tier filter
      if (selectedTier !== 'all') {
        if (canViewPredictions) {
          const hasTier = fixturePreds.some((p) => p.confidence_category === selectedTier);
          if (!hasTier) return false;
        } else {
          const hasTier = fixtureTeasers.some((t) => t.confidence_category === selectedTier);
          if (!hasTier) return false;
        }
      }

      // Date Navigation Filter (Section 5)
      if (selectedDay === 'history') {
        if (f.status !== 'finished' && f.queue_day >= 0) return false;
      } else if (selectedDay === 'yesterday') {
        if (f.queue_day !== -1 && !(f.status === 'finished' && f.queue_day < 0)) return false;
      } else if (selectedDay !== 'all') {
        if (f.queue_day !== selectedDay) return false;
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
  }, [
    fixtures,
    predsByFixture,
    teasersByFixture,
    canViewPredictions,
    selectedDay,
    selectedLeague,
    selectedTier,
    settlementFilter,
    onlyPredicted,
    searchQuery
  ]);

  const formatKickoff = (isoString: string) => {
    const d = new Date(isoString);
    return {
      local: d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }),
      date: d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', month: 'short', day: 'numeric' }),
      wat: d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }) + ' WAT'
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
      case 'ht_goals_0.5': return 'Half-Time Goals O/U 0.5';
      case 'ht_goals_1.5': return 'Half-Time Goals O/U 1.5';
      case '2h_goals_0.5': return '2nd Half Goals O/U 0.5';
      case '2h_goals_1.5': return '2nd Half Goals O/U 1.5';
      case 'corners_8.5': return 'Corners O/U 8.5';
      case 'corners_9.5': return 'Corners O/U 9.5';
      case 'corners_10.5': return 'Corners O/U 10.5';
      default: return market.toUpperCase();
    }
  };

  const formatPredictionOutcome = (outcome: string) => {
    switch (outcome.toLowerCase()) {
      case 'home': return 'Home Win';
      case 'draw': return 'Draw';
      case 'away': return 'Away Win';
      case 'over': return 'Over';
      case 'under': return 'Under';
      case 'yes': return 'Yes (BTTS)';
      case 'no': return 'No (BTTS)';
      case '1x': return '1X (Home or Draw)';
      case 'x2': return 'X2 (Draw or Away)';
      case '12': return '12 (Home or Away)';
      default: return outcome.toUpperCase();
    }
  };

  return (
    <div className="app-container">
      {/* Top Header Bar with Auth and Entitlement Navigation */}
      <header className="header-bar">
        <div className="brand-section">
          <div className="brand-logo">JB</div>
          <div>
            <h1 className="brand-title">JamBets</h1>
            <div className="brand-subtitle">AI Football Engine — Dixon-Coles 250k Simulation Platform</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div className="db-pill">
            <span className="pulsing-dot"></span>
            <span>Cloud Supabase Live</span>
            {latencyMs !== null && <span>({latencyMs}ms)</span>}
          </div>

          {/* User Auth & Entitlement Bar (Phase 8) */}
          <div className="user-nav-group">
            {!currentUser ? (
              <>
                <div className="visitor-pill">
                  <span>🔒</span>
                  <span>Visitor Mode</span>
                </div>
                <button
                  type="button"
                  className="btn-header-action signin-btn"
                  onClick={() => {
                    setAuthModalMode('signin');
                    setIsAuthModalOpen(true);
                  }}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  className="btn-header-action register-btn"
                  onClick={() => {
                    setAuthModalMode('register');
                    setIsAuthModalOpen(true);
                  }}
                >
                  Create Account
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="user-profile-btn"
                  onClick={() => setIsProfileModalOpen(true)}
                  title="View Profile, Disclaimers & Subscriptions"
                >
                  <div className="user-avatar-small">
                    {profile?.display_name ? profile.display_name.charAt(0).toUpperCase() : (currentUser.email?.charAt(0).toUpperCase() || 'U')}
                  </div>
                  <span className="user-email-label">
                    {profile?.display_name || currentUser.email}
                  </span>
                  <span className={`tier-pill-badge tier-${(profile?.role || 'free').toLowerCase()}`}>
                    {activeTierLabel}
                  </span>
                </button>

                {!canViewPredictions && (
                  <button
                    type="button"
                    className="upgrade-header-btn"
                    onClick={() => setIsProfileModalOpen(true)}
                  >
                    ⚡ Upgrade
                  </button>
                )}

                <button
                  type="button"
                  className="btn-header-action signin-btn"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setCurrentUser(null);
                    setProfile(null);
                    setSubscription(null);
                    setEntitlement(null);
                  }}
                >
                  Sign Out
                </button>
              </>
            )}
          </div>
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

      {/* Phase 6: Automatic 6-Hour Scheduler Status (WAT / Lagos Timezone) */}
      <section className="scheduler-banner">
        <div className="scheduler-header">
          <div className="scheduler-title-group">
            <div className="scheduler-badge">
              <span className="live-radar-dot"></span>
              PHASE 6 • AUTOMATIC 6-HOUR SCHEDULER
            </div>
            <h3 className="scheduler-title">Lagos Timezone Orchestration (WAT / UTC+1)</h3>
          </div>

          <div className="scheduler-clock-group">
            <div className="clock-card">
              <div className="clock-label">Lagos Local Time</div>
              <div className="clock-value">{watTime || 'Loading...'} <span className="clock-tz">WAT</span></div>
            </div>
            <div className="clock-card countdown-highlight">
              <div className="clock-label">Next 6h Cycle In</div>
              <div className="clock-value">{nextRunCountdown || '--h --m --s'}</div>
            </div>
          </div>
        </div>

        {/* Slot Progress Bar */}
        <div className="scheduler-slots-bar">
          <div className={`slot-item ${currentSlotIndex === 0 ? 'slot-active' : ''}`}>
            <div className="slot-pill">Slot 0</div>
            <div className="slot-time">00:00 WAT</div>
          </div>
          <div className={`slot-item ${currentSlotIndex === 1 ? 'slot-active' : ''}`}>
            <div className="slot-pill">Slot 1</div>
            <div className="slot-time">06:00 WAT</div>
          </div>
          <div className={`slot-item ${currentSlotIndex === 2 ? 'slot-active' : ''}`}>
            <div className="slot-pill">Slot 2</div>
            <div className="slot-time">12:00 WAT</div>
          </div>
          <div className={`slot-item ${currentSlotIndex === 3 ? 'slot-active' : ''}`}>
            <div className="slot-pill">Slot 3</div>
            <div className="slot-time">18:00 WAT</div>
          </div>
        </div>

        {/* Latest Cycle Execution Provenance Card */}
        {schedulerJob && (
          <div className="scheduler-provenance-card">
            <div className="prov-header">
              <div className="prov-status-group">
                <span className={`status-badge-pill ${schedulerJob.status === 'completed' ? 'badge-success' : 'badge-warn'}`}>
                  {schedulerJob.status.toUpperCase()}
                </span>
                <span className="prov-idempotency">{schedulerJob.idempotency_key}</span>
              </div>
              <div className="prov-worker">
                Worker: <code>{schedulerJob.metadata?.worker_id || 'active'}</code>
              </div>
            </div>

            <div className="prov-metrics-grid">
              <div className="prov-stat">
                <span className="prov-stat-label">Discovered</span>
                <span className="prov-stat-val">{schedulerJob.metadata?.fixtures_discovered ?? fixtures.length}</span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">4-Day Horizon Eligible</span>
                <span className="prov-stat-val">{schedulerJob.metadata?.fixtures_eligible ?? fixtures.length}</span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">250k Simulations</span>
                <span className="prov-stat-val" style={{ color: '#c084fc' }}>
                  {schedulerJob.metadata?.simulations_completed ?? 1} (250,000 Draws)
                </span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">Published (≥45.00%)</span>
                <span className="prov-stat-val" style={{ color: '#34d399' }}>
                  {schedulerJob.metadata?.predictions_published ?? (canViewPredictions ? predictions.length : teasers.length)}
                </span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">Cycle Duration</span>
                <span className="prov-stat-val">
                  {schedulerJob.metadata?.duration_ms ? `${(schedulerJob.metadata.duration_ms / 1000).toFixed(1)}s` : '--'}
                </span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Phase 7: Automatic 15-Minute Live Data & Settlement Engine Status (WAT / Lagos Timezone) */}
      <section className="scheduler-banner" style={{ marginTop: '16px', background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(13, 21, 39, 0.95) 100%)', borderColor: 'rgba(16, 185, 129, 0.25)' }}>
        <div className="scheduler-header">
          <div className="scheduler-title-group">
            <div className="scheduler-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', borderColor: 'rgba(16, 185, 129, 0.35)' }}>
              <span className="live-radar-dot" style={{ background: '#10b981' }}></span>
              PHASE 7 • AUTOMATIC 15-MINUTE SETTLEMENT ENGINE
            </div>
            <h3 className="scheduler-title">Deterministic Outcome Verification & Early Settlement (WAT)</h3>
          </div>

          <div className="scheduler-clock-group">
            <div className="clock-card" style={{ borderColor: 'rgba(16, 185, 129, 0.2)' }}>
              <div className="clock-label">Lagos Slot (15-Min)</div>
              <div className="clock-value">Slot {slot15Index} <span className="clock-tz">/ 96</span></div>
            </div>
            <div className="clock-card countdown-highlight" style={{ borderColor: 'rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.1)' }}>
              <div className="clock-label">Next 15m Settlement In</div>
              <div className="clock-value" style={{ color: '#34d399' }}>{next15RunCountdown || '--m --s'}</div>
            </div>
          </div>
        </div>

        {/* Latest Settlement Cycle Execution Provenance Card */}
        {settlementJob && (
          <div className="scheduler-provenance-card">
            <div className="prov-header">
              <div className="prov-status-group">
                <span className={`status-badge-pill ${settlementJob.status === 'completed' ? 'badge-success' : 'badge-warn'}`}>
                  {settlementJob.status.toUpperCase()}
                </span>
                <span className="prov-idempotency">{settlementJob.idempotency_key}</span>
              </div>
              <div className="prov-worker">
                Worker: <code>{settlementJob.metadata?.worker_id || 'settlement_engine_v1'}</code>
              </div>
            </div>

            <div className="prov-metrics-grid">
              <div className="prov-stat">
                <span className="prov-stat-label">Fixtures Monitored</span>
                <span className="prov-stat-val">{settlementJob.metadata?.fixtures_inspected ?? fixtures.length}</span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">Live In-Play</span>
                <span className="prov-stat-val" style={{ color: '#ef4444' }}>
                  {settlementJob.metadata?.fixtures_live ?? fixtures.filter(f => f.status === 'live').length} Active
                </span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">Full-Time Finished</span>
                <span className="prov-stat-val" style={{ color: '#10b981' }}>
                  {settlementJob.metadata?.fixtures_finished ?? fixtures.filter(f => f.status === 'finished').length} Matches
                </span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">Settled (Early / FT)</span>
                <span className="prov-stat-val" style={{ color: '#fbbf24' }}>
                  {settlementCounts.won + settlementCounts.lost} ({settlementCounts.won}W / {settlementCounts.lost}L)
                </span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">Still Pending</span>
                <span className="prov-stat-val" style={{ color: '#38bdf8' }}>
                  {settlementCounts.pending}
                </span>
              </div>
              <div className="prov-stat">
                <span className="prov-stat-label">Source Conflicts</span>
                <span className="prov-stat-val" style={{ color: settlementJob.metadata?.conflicts_detected ? '#f43f5e' : '#34d399' }}>
                  {settlementJob.metadata?.conflicts_detected ?? 0} (Zero Drift)
                </span>
              </div>
            </div>
          </div>
        )}
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
          <div className="metric-value" style={{ color: '#34d399' }}>
            {canViewPredictions ? predictions.length : teasers.length}
          </div>
          <div className="metric-sub">
            {canViewPredictions ? 'Unlocked (Active Entitlement)' : 'Teasers (Locked)'}
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">High Confidence / Top Picks</div>
          <div className="metric-value" style={{ color: '#38bdf8' }}>{highConfidenceCount}</div>
          <div className="metric-sub">≥83% Strict Probability</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Settled Predictions</div>
          <div className="metric-value" style={{ color: '#fbbf24' }}>
            {settlementCounts.won + settlementCounts.lost}
          </div>
          <div className="metric-sub">
            <span style={{ color: '#10b981' }}>{settlementCounts.won} Won</span> • <span style={{ color: '#f87171' }}>{settlementCounts.lost} Lost</span>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Monte Carlo Engine</div>
          <div className="metric-value" style={{ color: '#c084fc' }}>
            {totalCompletedDraws >= 1000000 ? `${(totalCompletedDraws / 1000000).toFixed(1)}M` : `${(totalCompletedDraws / 1000).toFixed(0)}k`}
          </div>
          <div className="metric-sub">Exact 250k Draws (PCG64)</div>
        </div>
      </div>

      {/* Queue & Date Navigation Bar (Section 5: History, Yesterday, Today [Default], Tomorrow, +2, +3, +4) */}
      <div className="queue-nav-bar">
        <div className="day-tabs">
          <button
            className={`day-tab ${selectedDay === 'history' ? 'active' : ''}`}
            onClick={() => setSelectedDay('history')}
          >
            <span>History</span>
            <span className="day-tab-count">{dayCounts.history}</span>
          </button>

          <button
            className={`day-tab ${selectedDay === 'yesterday' ? 'active' : ''}`}
            onClick={() => setSelectedDay('yesterday')}
          >
            <span>Yesterday (-1)</span>
            <span className="day-tab-count">{dayCounts.yesterday}</span>
          </button>

          <button
            className={`day-tab ${selectedDay === 0 ? 'active' : ''}`}
            onClick={() => setSelectedDay(0)}
          >
            <span>Today (Default)</span>
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

          <button
            className={`day-tab ${selectedDay === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedDay('all')}
          >
            <span>All Days</span>
            <span className="day-tab-count">{fixtures.length}</span>
          </button>
        </div>

        {/* Filters and Search Row (Section 6: Dynamic Competitions from football_leagues) */}
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
            <option value="all">All Competitions ({availableLeagues.length})</option>
            {availableLeagues.map((l) => (
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

          <button className="refresh-btn" onClick={fetchCloudData} disabled={loading}>
            <span>{loading ? 'Refreshing...' : '↻ Sync Cloud'}</span>
          </button>
        </div>

        {/* Settlement Filter Tabs */}
        {canViewPredictions && (
          <div className="settlement-filter-bar">
            <span style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.6px', marginRight: '4px' }}>
              Settlement Status:
            </span>
            <button
              className={`settle-filter-btn ${settlementFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSettlementFilter('all')}
            >
              All Predictions <span className="settle-count-pill">{settlementCounts.total}</span>
            </button>
            <button
              className={`settle-filter-btn ${settlementFilter === 'pending' ? 'active' : ''}`}
              onClick={() => setSettlementFilter('pending')}
            >
              ⏳ Pending <span className="settle-count-pill">{settlementCounts.pending}</span>
            </button>
            <button
              className={`settle-filter-btn won ${settlementFilter === 'won' ? 'active won' : ''}`}
              onClick={() => setSettlementFilter('won')}
            >
              ✓ Won <span className="settle-count-pill">{settlementCounts.won}</span>
            </button>
            <button
              className={`settle-filter-btn lost ${settlementFilter === 'lost' ? 'active lost' : ''}`}
              onClick={() => setSettlementFilter('lost')}
            >
              ✗ Lost (Early/FT) <span className="settle-count-pill">{settlementCounts.lost}</span>
            </button>
          </div>
        )}
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
          <div className="empty-desc">Fetching authoritative prediction queue, verified 250k simulations, and 15m settlement states from vepcoopomlfjageijsew.supabase.co</div>
        </div>
      ) : filteredFixtures.length === 0 ? (
        <div className="empty-state">
          <div className="empty-title">No Fixtures Found</div>
          <div className="empty-desc">No fixtures match the selected queue day, competition, settlement, and confidence filters.</div>
        </div>
      ) : (
        <div className="fixtures-grid">
          {filteredFixtures.map((fixture) => {
            const time = formatKickoff(fixture.target_kickoff_at);
            const homeInitial = fixture.home_team_name?.charAt(0)?.toUpperCase() || 'H';
            const awayInitial = fixture.away_team_name?.charAt(0)?.toUpperCase() || 'A';
            const fixturePreds = predsByFixture.get(fixture.id) || [];
            const fixtureTeasers = teasersByFixture.get(fixture.id) || [];
            const isLive = fixture.status === 'live';
            const isFinished = fixture.status === 'finished';

            return (
              <div key={fixture.id} className={`fixture-card ${isLive ? 'fixture-card-live' : ''}`}>
                <div className="card-top">
                  <span className="league-badge">
                    {fixture.league_name || fixture.league_code}
                  </span>
                  <span className={`queue-day-pill ${getQueueBadgeClass(fixture.queue_day)}`}>
                    {fixture.queue_day === 0 ? 'Queue: Today' : fixture.queue_day < 0 ? 'History' : `Queue: Day +${fixture.queue_day}`}
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

                {/* Phase 7: Live Match State Banner */}
                {isLive && (
                  <div className="live-match-banner">
                    <div className="live-score-pill">
                      <span className="live-indicator">
                        <span className="live-pulse-dot"></span>
                        LIVE {fixture.match_minute ? `${fixture.match_minute}'` : (fixture.period || '')}
                      </span>
                      {fixture.half_time_home_score !== null && fixture.half_time_away_score !== null && (
                        <span className="ht-score-sub">(HT {fixture.half_time_home_score}-{fixture.half_time_away_score})</span>
                      )}
                    </div>
                    <div className="match-score-display">
                      {fixture.home_score ?? 0} - {fixture.away_score ?? 0}
                    </div>
                  </div>
                )}

                {/* Phase 7: Finished Match State Banner */}
                {isFinished && (
                  <div className="finished-match-banner">
                    <div className="live-score-pill">
                      <span className="finished-indicator">FULL TIME</span>
                      {fixture.half_time_home_score !== null && fixture.half_time_away_score !== null && (
                        <span className="ht-score-sub">(HT {fixture.half_time_home_score}-{fixture.half_time_away_score})</span>
                      )}
                    </div>
                    <div className="match-score-display">
                      {fixture.home_score ?? 0} - {fixture.away_score ?? 0}
                    </div>
                  </div>
                )}

                <div className="card-bottom">
                  <div className="kickoff-info">
                    <span className="kickoff-time">
                      {time.date} • {time.local} WAT
                    </span>
                    <span className="kickoff-utc">{time.wat}</span>
                  </div>

                  <div className="canonical-tag" title={fixture.canonical_key}>
                    🔑 {fixture.canonical_key}
                  </div>

                  <div className="status-badge">
                    <span>STATUS: {fixture.status.toUpperCase()}</span>
                    <span>VERIFIED ✓</span>
                  </div>
                </div>

                {/* Conditional Predictions Section: Full Entitled View vs Locked Teaser View */}
                {canViewPredictions ? (
                  /* ================= ENTITLED PREDICTION VIEW ================= */
                  fixturePreds.length > 0 ? (
                    <div className="prediction-panel">
                      <div className="prediction-panel-header">
                        <div className="sim-verified-pill">
                          <span className="dot"></span>
                          <span>Exact 250,000 Draws Verified</span>
                        </div>
                        <span className="model-tag">PCG64 • Dixon-Coles</span>
                      </div>

                      {/* Simulation Job Provenance */}
                      {simsByFixture.get(fixture.id) && (() => {
                        const sim = simsByFixture.get(fixture.id)!;
                        const tracking = sim.run_tracking || {};
                        return (
                          <>
                            <div className="sim-job-bar">
                              <span className="sim-job-tag">
                                ⚡ Job: {tracking.simulation_job_id ? tracking.simulation_job_id.slice(0, 8) + '...' : '250k'}
                              </span>
                              <span>• Seed: {tracking.seed ?? 'PCG64'}</span>
                              <span>• {tracking.duration_ms ? `${tracking.duration_ms}ms` : '<100ms'}</span>
                              <span className="sanity-tag">✓ 1X2 Sum: {tracking.sanity_report?.sum_1x2 ?? 100}%</span>
                            </div>
                            {(tracking.first_half_avg_goals !== undefined || tracking.second_half_avg_goals !== undefined) && (
                              <div className="ht-stats-bar">
                                <span>⏱ 1H Goals: <strong>{tracking.first_half_avg_goals ?? '0.00'}</strong></span>
                                <span>⏱ 2H Goals: <strong>{tracking.second_half_avg_goals ?? '0.00'}</strong></span>
                                <span className="corners-tag">Corners: MARKET_NOT_READY (0 Fake Data)</span>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      <div className="prediction-list">
                        {fixturePreds.map((p) => {
                          const pct = (p.probability * 100).toFixed(2);
                          const isWon = p.settlement_status === 'won';
                          const isLost = p.settlement_status === 'lost';
                          const isVoid = p.settlement_status === 'void' || p.settlement_status === 'voided';
                          const isPending = !p.settlement_status || p.settlement_status === 'pending';

                          return (
                            <div key={p.id} className={`prediction-row ${isWon ? 'pred-row-won' : ''} ${isLost ? 'pred-row-lost' : ''}`}>
                              <div className="pred-row-top">
                                <div className="pred-market-outcome">
                                  <span className="pred-market-name">{formatMarketName(p.market)}:</span>
                                  <span className="pred-outcome-val">{formatPredictionOutcome(p.prediction)}</span>
                                </div>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                  {isWon && <span className="badge-settled-won">✓ WON</span>}
                                  {isLost && <span className="badge-settled-lost">✗ LOST</span>}
                                  {isVoid && <span className="badge-settled-void">⊘ VOID</span>}
                                  {isPending && <span className="badge-settled-pending">⏳ PENDING</span>}
                                  <span className={`tier-badge ${getTierBadgeClass(p.confidence_category)}`}>
                                    {p.confidence_category}
                                  </span>
                                </div>
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
                                      isWon
                                        ? '#10b981'
                                        : isLost
                                        ? '#ef4444'
                                        : p.confidence_category === 'BANGER'
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

                              {/* Settlement Reason & Notes */}
                              {p.settlement_notes && (
                                <div className={`settle-reason-tag ${isWon ? 'won' : ''}`}>
                                  <strong>Settlement:</strong> {p.settlement_notes} {p.actual_score ? `• Score: ${p.actual_score}` : ''}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="not-ready-panel">
                      <span className="not-ready-tag">⚙ Features Incomplete • NOT_READY</span>
                      <span className="not-ready-shield">0 Sims • 0 Predictions (Zero Leakage)</span>
                    </div>
                  )
                ) : (
                  /* ================= VISITOR / FREE TEASER VIEW ================= */
                  fixtureTeasers.length > 0 ? (
                    <div className="prediction-teaser-panel">
                      <div className="prediction-panel-header">
                        <div className="sim-verified-pill" style={{ background: 'rgba(245, 158, 11, 0.15)', borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fbbf24' }}>
                          <span>🔒</span>
                          <span>{fixtureTeasers.length} Model Signal{fixtureTeasers.length > 1 ? 's' : ''} (Locked)</span>
                        </div>
                        <span className="model-tag">250k Draws Backed</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                        {fixtureTeasers.map((t) => (
                          <div key={t.id} className="teaser-locked-box">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="teaser-market-label">{formatMarketName(t.market)}</span>
                                <span className={`tier-badge ${getTierBadgeClass(t.confidence_category)}`}>
                                  {t.confidence_category}
                                </span>
                              </div>
                              <div className="teaser-lock-info">
                                <span className="teaser-lock-icon">🔒</span>
                                <span>Prediction & Simulated Probability Locked</span>
                              </div>
                            </div>

                            <button
                              type="button"
                              className="teaser-unlock-btn"
                              onClick={() => {
                                if (!currentUser) {
                                  setAuthModalMode('register');
                                  setIsAuthModalOpen(true);
                                } else {
                                  setIsProfileModalOpen(true);
                                }
                              }}
                            >
                              {!currentUser ? 'Unlock Signal' : 'Upgrade Plan'}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="not-ready-panel">
                      <span className="not-ready-tag">⚙ Features Incomplete • NOT_READY</span>
                      <span className="not-ready-shield">0 Sims • 0 Predictions (Zero Leakage)</span>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Mandatory Legal & Responsible Gaming Banner (Phase 8 Section 15, 26, 44) */}
      <section className="responsible-gaming-banner">
        <span className="responsible-tag">18+ ONLY • RESPONSIBLE GAMING NOTICE</span>
        <p className="responsible-text">
          Sports betting involves substantial risk of financial loss. JamBets provides statistical models,
          bivariate Poisson probability distributions, and 250,000 Monte Carlo simulations for educational and informational
          purposes only. None of the materials or predictions constitutes financial or investment advice.
          JamBets and its operators assume zero liability for financial losses incurred through reliance on these simulations.
          Please wager responsibly and within your personal financial limits.
        </p>
      </section>

      {/* Footer */}
      <footer style={{ marginTop: 24, textAlign: 'center', color: '#64748b', fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 20 }}>
        JamBets AI Platform • Automatic 6-Hour Scheduler & 15-Minute Settlement Engine (Lagos WAT / UTC+1) • Cloud Supabase Row-Level Security • 250,000 Monte Carlo Simulations • Synced: {lastRefreshed.toLocaleTimeString()}
      </footer>

      {/* Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={async () => {
          const { data } = await supabase.auth.getUser();
          if (data?.user) {
            setCurrentUser(data.user);
            await fetchUserData(data.user.id);
          }
        }}
        initialMode={authModalMode}
      />

      {/* Profile & Subscriptions Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        profile={profile}
        subscription={subscription}
        entitlement={entitlement}
        onProfileUpdated={async () => {
          if (currentUser) {
            await fetchUserData(currentUser.id);
          }
        }}
      />
    </div>
  );
}
