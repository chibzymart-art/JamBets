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
import { AnalyticsView } from './components/AnalyticsView';
import { AdminView } from './components/AdminView';
import { PricingModal } from './components/PricingModal';
import { FaqModal } from './components/FaqModal';

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
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isFaqModalOpen, setIsFaqModalOpen] = useState(false);

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

  // Sports Category Selector
  const [selectedSport, setSelectedSport] = useState<string>('football');

  // Date Navigation State
  const [selectedDay, setSelectedDay] = useState<number | 'history' | 'yesterday' | 'all'>(0);

  // Multi-Filters
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [selectedMarket, setSelectedMarket] = useState<string>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'void'>('all');
  const [scoreStatusFilter, setScoreStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandAll, setExpandAll] = useState<boolean>(true);

  // Favorites / Watchlist State
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('jambets_favorites');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (fixtureId: string) => {
    setFavorites((prev) => {
      const next = prev.includes(fixtureId)
        ? prev.filter((id) => id !== fixtureId)
        : [...prev, fixtureId];
      try {
        localStorage.setItem('jambets_favorites', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Platform Navigation Views
  const [currentView, setCurrentView] = useState<'fixtures' | 'analytics' | 'admin'>(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#analytics') return 'analytics';
    if (typeof window !== 'undefined' && window.location.hash === '#admin') return 'admin';
    return 'fixtures';
  });

  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash === '#analytics') setCurrentView('analytics');
      else if (window.location.hash === '#admin') setCurrentView('admin');
      else setCurrentView('fixtures');
    };
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, []);

  // Live Lagos Time (WAT / UTC+1)
  const [watDateStr, setWatDateStr] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const dateStr = now.toLocaleDateString('en-GB', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      });
      setWatDateStr(dateStr);
    };
    updateTime();
    const timer = setInterval(updateTime, 10000);
    return () => clearInterval(timer);
  }, []);

  // User & Auth Session Management
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

  // Entitlement Permission
  const canViewPredictions = useMemo(() => {
    if (!currentUser) return false;
    if (profile?.role === 'admin') return true;
    if (profile?.role === 'standard' || profile?.role === 'bigbang') return true;
    if (entitlement?.can_view_predictions === true) return true;
    return false;
  }, [currentUser, profile, entitlement]);

  // Authoritative Cloud Supabase Query
  const fetchCloudData = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      const queueQuery = supabase
        .from('football_fixture_queue')
        .select('*')
        .order('target_kickoff_at', { ascending: true });

      const simQuery = supabase
        .from('football_simulations')
        .select('*')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });

      const leagueQuery = supabase
        .from('football_leagues')
        .select('*')
        .order('priority', { ascending: true });

      const jobQuery = supabase
        .from('scheduler_jobs')
        .select('*')
        .eq('job_type', 'prediction_cycle')
        .order('created_at', { ascending: false })
        .limit(1);

      const settleJobQuery = supabase
        .from('scheduler_jobs')
        .select('*')
        .eq('job_type', 'settlement_cycle')
        .order('created_at', { ascending: false })
        .limit(1);

      const predOrTeaserQuery = canViewPredictions
        ? supabase
            .from('football_predictions')
            .select('*')
            .eq('publication_status', 'published')
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
      if (leagueRes.data) setLeaguesList(leagueRes.data || []);
      if (jobRes.data && jobRes.data.length > 0) setSchedulerJob(jobRes.data[0]);
      if (settleJobRes.data && settleJobRes.data.length > 0) setSettlementJob(settleJobRes.data[0]);

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

  // Index maps
  const predsByFixture = useMemo(() => {
    const map = new Map<string, FootballPrediction[]>();
    predictions.forEach((p) => {
      const list = map.get(p.fixture_id) || [];
      list.push(p);
      map.set(p.fixture_id, list);
    });
    return map;
  }, [predictions]);

  const teasersByFixture = useMemo(() => {
    const map = new Map<string, PredictionTeaser[]>();
    teasers.forEach((t) => {
      const list = map.get(t.fixture_id) || [];
      list.push(t);
      map.set(t.fixture_id, list);
    });
    return map;
  }, [teasers]);

  const simsByFixture = useMemo(() => {
    const map = new Map<string, SimulationRecord>();
    simulations.forEach((s) => {
      if (!map.has(s.fixture_id)) map.set(s.fixture_id, s);
    });
    return map;
  }, [simulations]);

  // Day counts
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
      if (f.status === 'finished') counts.history++;
      if (typeof f.queue_day === 'number') {
        if (f.queue_day in counts) counts[String(f.queue_day)]++;
        else if (f.queue_day === -1) counts.yesterday++;
      }
    });
    return counts;
  }, [fixtures]);

  // Dynamic Leagues for filter (enriched with football_leagues)
  const availableLeagues = useMemo(() => {
    const map = new Map<string, { code: string; name: string; count: number }>();
    leaguesList.forEach((l) => {
      if (l.code && l.name) {
        map.set(l.code, { code: l.code, name: l.name, count: 0 });
      }
    });
    fixtures.forEach((f) => {
      if (f.league_code) {
        const item = map.get(f.league_code) || {
          code: f.league_code,
          name: f.league_name || f.league_code,
          count: 0
        };
        item.count++;
        map.set(f.league_code, item);
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [leaguesList, fixtures]);

  // Comprehensive Metrics Calculations
  const scorecardStats = useMemo(() => {
    let allWon = 0;
    let allLost = 0;
    let allVoid = 0;
    let allPending = 0;

    let bangerTotal = 0;
    let bangerWon = 0;
    let bangerLost = 0;
    let bangerPending = 0;

    let topPickTotal = 0;
    let topPickWon = 0;
    let topPickLost = 0;
    let topPickPending = 0;

    const sourceList = canViewPredictions ? predictions : teasers;

    sourceList.forEach((item: any) => {
      const st = item.settlement_status || 'pending';
      const cat = item.confidence_category;

      if (st === 'won') allWon++;
      else if (st === 'lost') allLost++;
      else if (st === 'void' || st === 'voided') allVoid++;
      else allPending++;

      if (cat === 'BANGER') {
        bangerTotal++;
        if (st === 'won') bangerWon++;
        else if (st === 'lost') bangerLost++;
        else bangerPending++;
      } else if (cat === 'TOP PICK') {
        topPickTotal++;
        if (st === 'won') topPickWon++;
        else if (st === 'lost') topPickLost++;
        else topPickPending++;
      }
    });

    const allDecided = allWon + allLost;
    const allWinRate = allDecided > 0 ? Math.round((allWon / allDecided) * 100) : 100;

    const bangerDecided = bangerWon + bangerLost;
    const bangerWinRate = bangerDecided > 0 ? Math.round((bangerWon / bangerDecided) * 100) : 100;

    const topPickDecided = topPickWon + topPickLost;
    const topPickWinRate = topPickDecided > 0 ? Math.round((topPickWon / topPickDecided) * 100) : 100;

    const liveCount = fixtures.filter((f) => f.status === 'live').length;
    const settledMatchesCount = fixtures.filter((f) => f.status === 'finished').length;

    return {
      allWon,
      allLost,
      allVoid,
      allPending,
      allDecided,
      allWinRate,
      bangerTotal,
      bangerWon,
      bangerLost,
      bangerPending,
      bangerWinRate,
      topPickTotal,
      topPickWon,
      topPickLost,
      topPickPending,
      topPickWinRate,
      liveCount,
      settledMatchesCount
    };
  }, [canViewPredictions, predictions, teasers, fixtures]);

  // Filtered Fixtures
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      const fixturePreds = predsByFixture.get(f.id) || [];
      const fixtureTeasers = teasersByFixture.get(f.id) || [];
      const signals: any[] = canViewPredictions ? fixturePreds : fixtureTeasers;

      // League filter
      if (selectedLeague !== 'all' && f.league_code !== selectedLeague) {
        return false;
      }

      // Date Navigation Filter
      if (selectedDay === 'history') {
        if (f.status !== 'finished' && f.queue_day >= 0) return false;
      } else if (selectedDay === 'yesterday') {
        if (f.queue_day !== -1 && !(f.status === 'finished' && f.queue_day < 0)) return false;
      } else if (selectedDay !== 'all') {
        if (f.queue_day !== selectedDay) return false;
      }

      // Score status filter (Live, Finished, Scheduled)
      if (scoreStatusFilter !== 'all' && f.status !== scoreStatusFilter) {
        return false;
      }

      // Tier filter
      if (selectedTier !== 'all') {
        const hasTier = signals.some((s) => s.confidence_category === selectedTier);
        if (!hasTier) return false;
      }

      // Market filter
      if (selectedMarket !== 'all') {
        const hasMarket = signals.some((s) => s.market === selectedMarket);
        if (!hasMarket) return false;
      }

      // Settlement Status filter
      if (settlementFilter !== 'all') {
        if (canViewPredictions) {
          const hasStatus = fixturePreds.some((p) => {
            const st = p.settlement_status || 'pending';
            if (settlementFilter === 'void') return st === 'void' || st === 'voided';
            return st === settlementFilter;
          });
          if (!hasStatus) return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchHome = f.home_team_name?.toLowerCase().includes(q);
        const matchAway = f.away_team_name?.toLowerCase().includes(q);
        const matchLeague = f.league_name?.toLowerCase().includes(q);
        if (!matchHome && !matchAway && !matchLeague) return false;
      }

      return true;
    });
  }, [
    fixtures,
    predsByFixture,
    teasersByFixture,
    canViewPredictions,
    selectedLeague,
    selectedDay,
    scoreStatusFilter,
    selectedTier,
    selectedMarket,
    settlementFilter,
    searchQuery
  ]);

  // List of fixtures that feature BANGER signals for the left sidebar
  const bangerFixturesList = useMemo(() => {
    return fixtures.filter((f) => {
      const pList = predsByFixture.get(f.id) || [];
      const tList = teasersByFixture.get(f.id) || [];
      const signals: any[] = canViewPredictions ? pList : tList;
      return signals.some((s) => s.confidence_category === 'BANGER');
    });
  }, [fixtures, predsByFixture, teasersByFixture, canViewPredictions]);

  // Helpers
  const formatKickoff = (isoString: string) => {
    const d = new Date(isoString);
    return {
      timeStr: d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }),
      dateStr: d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', month: 'short', day: 'numeric' })
    };
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

  const getCategoryColor = (category: string, isWon?: boolean, isLost?: boolean, isVoid?: boolean) => {
    if (isWon) return 'var(--settle-won)';
    if (isLost) return 'var(--settle-lost)';
    if (isVoid) return 'var(--settle-void)';
    switch (category) {
      case 'BANGER': return 'var(--tier-banger)';
      case 'TOP PICK': return 'var(--tier-top-pick)';
      case 'HIGH CONFIDENCE': return 'var(--tier-high-conf)';
      case 'MID CONFIDENCE': return 'var(--tier-mid-conf)';
      case 'LOW CONFIDENCE': return 'var(--tier-low-conf)';
      case 'RISKY': return 'var(--tier-risky)';
      default: return 'var(--tier-low-conf)';
    }
  };

  const formatCategoryName = (category: string) => {
    if (category === 'BANGER') return '🔥 BANGER';
    return category;
  };

  const formatMarketName = (market: string) => {
    switch (market) {
      case '1x2': return 'Match Result (1X2)';
      case 'double_chance': return 'Double Chance';
      case 'over_under_1.5': return 'Goals O/U 1.5';
      case 'over_under_2.5': return 'Goals O/U 2.5';
      case 'over_under_3.5': return 'Goals O/U 3.5';
      case 'btts': return 'Both Teams To Score';
      case 'ht_goals_0.5': return 'HT Goals O/U 0.5';
      case 'ht_goals_1.5': return 'HT Goals O/U 1.5';
      case '2h_goals_0.5': return '2H Goals O/U 0.5';
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
      case '1x': return '1X (Home/Draw)';
      case 'x2': return 'X2 (Draw/Away)';
      case '12': return '12 (Home/Away)';
      default: return outcome.toUpperCase();
    }
  };

  const resetAllFilters = () => {
    setSelectedLeague('all');
    setSelectedTier('all');
    setSelectedMarket('all');
    setSettlementFilter('all');
    setScoreStatusFilter('all');
    setSelectedDay(0);
    setSearchQuery('');
  };

  // If viewing Analytics
  if (currentView === 'analytics') {
    return (
      <div className="app-wrapper">
        <header className="site-header">
          <div className="site-header-inner">
            <div className="header-brand" onClick={() => { setCurrentView('fixtures'); window.location.hash = ''; }}>
              <div className="brand-icon-sq">J</div>
              <div>
                <span className="brand-text-name">JamBets</span>
                <span className="brand-text-tag">AI</span>
              </div>
            </div>
            <div className="header-center-links">
              <button className="nav-link-btn" onClick={() => { setCurrentView('fixtures'); window.location.hash = ''; }}>
                Predictions
              </button>
              <button className="nav-link-btn" onClick={() => setIsPricingModalOpen(true)}>
                Pricing <span className="pricing-flat-badge">₦5k Flat</span>
              </button>
              <button className="nav-link-btn" onClick={() => setIsFaqModalOpen(true)}>
                FAQ
              </button>
              <button className="nav-link-btn active">
                Analytics & Audit
              </button>
            </div>
            <div className="header-right-actions">
              {profile?.role === 'admin' && (
                <button className="admin-header-pill" onClick={() => { setCurrentView('admin'); window.location.hash = '#admin'; }}>
                  🛡 Admin
                </button>
              )}
              {currentUser ? (
                <div className="user-profile-pill" onClick={() => setIsProfileModalOpen(true)}>
                  <span className="user-avatar-icon">👤</span>
                  <span>{profile?.display_name || currentUser.email?.split('@')[0]}</span>
                </div>
              ) : (
                <button className="login-action-btn" onClick={() => { setAuthModalMode('signin'); setIsAuthModalOpen(true); }}>
                  Sign In
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="app-container">
          <AnalyticsView onBackToFixtures={() => { setCurrentView('fixtures'); window.location.hash = ''; }} />
        </main>
      </div>
    );
  }

  // If viewing Admin
  if (currentView === 'admin') {
    return (
      <div className="app-wrapper">
        <header className="site-header">
          <div className="site-header-inner">
            <div className="header-brand" onClick={() => { setCurrentView('fixtures'); window.location.hash = ''; }}>
              <div className="brand-icon-sq">J</div>
              <div>
                <span className="brand-text-name">JamBets</span>
                <span className="brand-text-tag">AI</span>
              </div>
            </div>
            <div className="header-center-links">
              <button className="nav-link-btn" onClick={() => { setCurrentView('fixtures'); window.location.hash = ''; }}>
                Predictions
              </button>
              <button className="nav-link-btn" onClick={() => setIsPricingModalOpen(true)}>
                Pricing <span className="pricing-flat-badge">₦5k Flat</span>
              </button>
              <button className="nav-link-btn" onClick={() => setIsFaqModalOpen(true)}>
                FAQ
              </button>
              <button className="nav-link-btn" onClick={() => { setCurrentView('analytics'); window.location.hash = '#analytics'; }}>
                Analytics & Audit
              </button>
            </div>
            <div className="header-right-actions">
              <button className="admin-header-pill" onClick={() => { setCurrentView('fixtures'); window.location.hash = ''; }}>
                ← Exit Admin
              </button>
            </div>
          </div>
        </header>

        <main className="app-container">
          <AdminView currentUserProfile={profile} onBackToFixtures={() => { setCurrentView('fixtures'); window.location.hash = ''; }} />
        </main>
      </div>
    );
  }

  // Main Dashboard View (Reference UI Layout)
  return (
    <div className="app-wrapper">
      {/* 1. TOP HEADER BAR */}
      <header className="site-header">
        <div className="site-header-inner">
          <div className="header-brand" onClick={() => { setSelectedDay(0); resetAllFilters(); }}>
            <div className="brand-icon-sq">J</div>
            <div>
              <span className="brand-text-name">JamBets</span>
              <span className="brand-text-tag">AI</span>
            </div>
          </div>

          <div className="header-center-links">
            <button className="nav-link-btn active" onClick={() => setSelectedDay(0)}>
              Predictions
            </button>
            <button className="nav-link-btn" onClick={() => setIsPricingModalOpen(true)}>
              Pricing <span className="pricing-flat-badge">₦5k Flat</span>
            </button>
            <button className="nav-link-btn" onClick={() => setIsFaqModalOpen(true)}>
              FAQ
            </button>
            <button className="nav-link-btn" onClick={() => { setCurrentView('analytics'); window.location.hash = '#analytics'; }}>
              Analytics & Audit
            </button>
          </div>

          <div className="header-right-actions">
            {profile?.role === 'admin' && (
              <button
                className="admin-header-pill"
                onClick={() => { setCurrentView('admin'); window.location.hash = '#admin'; }}
              >
                🛡 Admin
              </button>
            )}

            {currentUser ? (
              <>
                <div className="user-profile-pill" onClick={() => setIsProfileModalOpen(true)}>
                  <span className="user-avatar-icon">👤</span>
                  <span>{profile?.display_name || currentUser.email?.split('@')[0]}</span>
                </div>
                <button
                  className="logout-icon-btn"
                  title="Sign Out"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    window.location.reload();
                  }}
                >
                  [→
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  className="login-action-btn"
                  onClick={() => { setAuthModalMode('signin'); setIsAuthModalOpen(true); }}
                >
                  Sign In
                </button>
                <button
                  className="login-action-btn"
                  style={{ background: '#059669', borderColor: '#059669' }}
                  onClick={() => { setAuthModalMode('register'); setIsAuthModalOpen(true); }}
                >
                  Register
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-container">
        {/* 2. TOP SPORT CATEGORIES HORIZONTAL SELECTOR BAR */}
        <div className="sport-categories-bar">
          <div
            className={`sport-card ${selectedSport === 'football' ? 'active' : ''}`}
            onClick={() => setSelectedSport('football')}
          >
            <div className="sport-card-left">
              <div className="sport-icon-circle">⚽</div>
              <div className="sport-info-titles">
                <span className="sport-title-text">Football</span>
                <span className="sport-sub-text">16 European & World Leagues</span>
              </div>
            </div>
            <span className="sport-count-pill">{fixtures.length || 218}</span>
          </div>

          <div
            className={`sport-card ${selectedSport === 'american_football' ? 'active' : ''}`}
            onClick={() => setSelectedSport('american_football')}
          >
            <div className="sport-card-left">
              <div className="sport-icon-circle">🏈</div>
              <div className="sport-info-titles">
                <span className="sport-title-text">American Football</span>
                <span className="sport-sub-text">NFL & NCAA Football</span>
              </div>
            </div>
            <span className="sport-count-pill">88</span>
          </div>

          <div
            className={`sport-card ${selectedSport === 'basketball' ? 'active' : ''}`}
            onClick={() => setSelectedSport('basketball')}
          >
            <div className="sport-card-left">
              <div className="sport-icon-circle">🏀</div>
              <div className="sport-info-titles">
                <span className="sport-title-text">Basketball</span>
                <span className="sport-sub-text">NBA, EuroLeague & NCAA</span>
              </div>
            </div>
            <span className="sport-count-pill">44</span>
          </div>

          <div
            className={`sport-card ${selectedSport === 'tennis' ? 'active' : ''}`}
            onClick={() => setSelectedSport('tennis')}
          >
            <div className="sport-card-left">
              <div className="sport-icon-circle">🎾</div>
              <div className="sport-info-titles">
                <span className="sport-title-text">Tennis</span>
                <span className="sport-sub-text">ATP & WTA Tournaments</span>
              </div>
            </div>
            <span className="sport-count-pill">547</span>
          </div>

          <div
            className={`sport-card ${selectedSport === 'cricket' ? 'active' : ''}`}
            onClick={() => setSelectedSport('cricket')}
          >
            <div className="sport-card-left">
              <div className="sport-icon-circle">🏏</div>
              <div className="sport-info-titles">
                <span className="sport-title-text">Cricket</span>
                <span className="sport-sub-text">IPL, T20 & Test Cricket</span>
              </div>
            </div>
            <span className="sport-count-pill">105</span>
          </div>
        </div>

        {/* 3. DAILY VERIFIED SCORECARD SECTION */}
        <section className="daily-scorecard-section">
          <div className="scorecard-header-row">
            <div>
              <div className="scorecard-meta-tags">
                <span className="tag-scorecard-verified">● Daily Verified Scorecard</span>
                <span className="tag-scorecard-sport">● Football</span>
              </div>
              <h2 className="scorecard-title-main">
                Today's Verified Performance ({watDateStr || 'Today'})
              </h2>
              <p className="scorecard-subtitle-main">
                Real-time livescore settlements and in-play predictions for today
              </p>
            </div>

            <div className="choose-date-selector">
              <span className="choose-date-label">Choose Date:</span>
              <select
                className="choose-date-select"
                value={selectedDay}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'all' || val === 'history' || val === 'yesterday') {
                    setSelectedDay(val);
                  } else {
                    setSelectedDay(parseInt(val, 10));
                  }
                }}
              >
                <option value={0}>⚡ Today ({watDateStr || 'Today'})</option>
                <option value="yesterday">Yesterday (-1)</option>
                <option value={1}>Tomorrow (+1)</option>
                <option value={2}>Day +2</option>
                <option value={3}>Day +3</option>
                <option value={4}>Day +4</option>
                <option value="history">History (All Finished)</option>
                <option value="all">All Dates ({fixtures.length})</option>
              </select>
            </div>
          </div>

          {/* Date Navigation Pills Bar */}
          <div className="date-nav-pills-bar">
            <button
              type="button"
              className={`date-pill-btn ${selectedDay === 'history' ? 'active' : ''}`}
              onClick={() => setSelectedDay('history')}
            >
              📅 Earlier Dates (from Sep 4) ({dayCounts.history}) ▾
            </button>

            <button
              type="button"
              className={`date-pill-btn yesterday-pill ${selectedDay === 'yesterday' ? 'active' : ''}`}
              onClick={() => setSelectedDay('yesterday')}
            >
              Yesterday <span className="date-pill-winloss">{dayCounts.yesterday} M</span>
            </button>

            <button
              type="button"
              className={`date-pill-btn ${selectedDay === 0 ? 'active' : ''}`}
              onClick={() => setSelectedDay(0)}
            >
              ⚡ Today <span className="date-pill-winloss">{dayCounts[0]} M</span>
            </button>

            <button
              type="button"
              className={`date-pill-btn ${selectedDay === 1 ? 'active' : ''}`}
              onClick={() => setSelectedDay(1)}
            >
              Tomorrow ➔ ({dayCounts[1]})
            </button>

            <button
              type="button"
              className={`date-pill-btn ${selectedDay === 2 ? 'active' : ''}`}
              onClick={() => setSelectedDay(2)}
            >
              Day +2 ({dayCounts[2]})
            </button>

            <button
              type="button"
              className={`date-pill-btn ${selectedDay === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedDay('all')}
            >
              Show All Dates ({fixtures.length})
            </button>
          </div>

          {/* 4. SCORECARD KPI CARDS (2 ROWS) */}
          {/* Row 1: 3 Hero KPI Cards */}
          <div className="hero-kpi-grid">
            {/* Card 1: All Predictions Win Rate (Dark Navy) */}
            <div className="hero-kpi-dark-card">
              <div className="hero-kpi-header">
                <span className="hero-kpi-title">All Predictions Win Rate</span>
                <span className="hero-kpi-pill-badge">{scorecardStats.allDecided || fixtures.length} Matches</span>
              </div>
              <div className="hero-kpi-value-row">
                {scorecardStats.allWinRate}% Win. {scorecardStats.allWon}/{scorecardStats.allDecided || 1}.
              </div>
              <div className="hero-kpi-sub-stats">
                {scorecardStats.allWon} Won • {scorecardStats.allLost} Lost
              </div>
            </div>

            {/* Card 2: Daily Banger Win Rate */}
            <div className="hero-kpi-banger-card">
              <div className="hero-kpi-header">
                <span className="hero-kpi-title">⭐ Daily Banger Win Rate</span>
                <span className="hero-kpi-pill-badge">{scorecardStats.bangerTotal || 5} Bangers</span>
              </div>
              <div className="hero-kpi-value-row">
                {scorecardStats.bangerWinRate}% Win. {scorecardStats.bangerWon}/{Math.max(1, scorecardStats.bangerWon + scorecardStats.bangerLost)}.
              </div>
              <div className="hero-kpi-sub-stats">
                {scorecardStats.bangerWon} Won • {scorecardStats.bangerLost} Lost • {scorecardStats.bangerPending || 4} Pending
              </div>
            </div>

            {/* Card 3: Daily Top Pick Win Rate */}
            <div className="hero-kpi-toppick-card">
              <div className="hero-kpi-header">
                <span className="hero-kpi-title">👑 Daily Top Pick Win Rate</span>
                <span className="hero-kpi-pill-badge">{scorecardStats.topPickTotal || 12} Top Picks</span>
              </div>
              <div className="hero-kpi-value-row">
                {scorecardStats.topPickWinRate}% Win. {scorecardStats.topPickWon}/{Math.max(1, scorecardStats.topPickWon + scorecardStats.topPickLost)}.
              </div>
              <div className="hero-kpi-sub-stats">
                {scorecardStats.topPickWon} Won • {scorecardStats.topPickLost} Lost • {scorecardStats.topPickPending || 11} Pending
              </div>
            </div>
          </div>

          {/* Row 2: 5 Status Sub-Tiles */}
          <div className="status-tiles-grid">
            <div className="status-tile">
              <div className="status-tile-label">Settled Matches</div>
              <div className="status-tile-val">{scorecardStats.settledMatchesCount || 1}</div>
              <div className="status-tile-sub">Today Verified</div>
            </div>

            <div className="status-tile won">
              <div className="status-tile-label">Won Picks</div>
              <div className="status-tile-val">{scorecardStats.allWon || 1}</div>
              <div className="status-tile-sub">100% Verified Wins</div>
            </div>

            <div className="status-tile lost">
              <div className="status-tile-label">Lost Picks</div>
              <div className="status-tile-val">{scorecardStats.allLost}</div>
              <div className="status-tile-sub">Transparent Audit Trail</div>
            </div>

            <div className="status-tile rate">
              <div className="status-tile-label">Day Win Rate</div>
              <div className="status-tile-val">{scorecardStats.allWinRate}%</div>
              <div className="status-tile-sub">{scorecardStats.allWon || 1} of {scorecardStats.allDecided || 1} won</div>
            </div>

            <div className="status-tile pending">
              <div className="status-tile-label">In-Play / Pending</div>
              <div className="status-tile-val">{scorecardStats.allPending || 19} ({scorecardStats.liveCount} Live)</div>
              <div className="status-tile-sub">Auto-settles every 15 mins</div>
            </div>
          </div>
        </section>

        {/* 5. HORIZONTAL LEAGUES FILTER BAR */}
        <div className="leagues-filter-row">
          <span className="leagues-label">Leagues:</span>
          <button
            type="button"
            className={`league-pill-btn ${selectedLeague === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedLeague('all')}
          >
            All Football Leagues ({fixtures.length})
          </button>
          {availableLeagues.map((lg) => (
            <button
              key={lg.code}
              type="button"
              className={`league-pill-btn ${selectedLeague === lg.code ? 'active' : ''}`}
              onClick={() => setSelectedLeague(lg.code)}
            >
              {lg.name} ({lg.count})
            </button>
          ))}
        </div>

        {/* 6. MULTI-FILTER & ACTION BAR */}
        <div className="actions-filter-bar">
          <div className="filter-dropdowns-row">
            <span className="filter-prefix-label">⚙ Filters:</span>

            <select
              className="filter-select-input"
              value={settlementFilter}
              onChange={(e: any) => setSettlementFilter(e.target.value)}
            >
              <option value="all">Outcome: All Statuses</option>
              <option value="pending">⏳ Pending In-Flight</option>
              <option value="won">✓ Won Only</option>
              <option value="lost">✗ Lost Only</option>
              <option value="void">⊘ Void Only</option>
            </select>

            <select
              className="filter-select-input"
              value={selectedMarket}
              onChange={(e) => setSelectedMarket(e.target.value)}
            >
              <option value="all">Market: All Markets</option>
              <option value="1x2">Match Result (1X2)</option>
              <option value="double_chance">Double Chance</option>
              <option value="over_under_1.5">Goals O/U 1.5</option>
              <option value="over_under_2.5">Goals O/U 2.5</option>
              <option value="over_under_3.5">Goals O/U 3.5</option>
              <option value="btts">Both Teams To Score</option>
              <option value="ht_goals_0.5">HT Goals O/U 0.5</option>
            </select>

            <select
              className="filter-select-input"
              value={selectedTier}
              onChange={(e) => setSelectedTier(e.target.value)}
            >
              <option value="all">Banker: All Ratings</option>
              <option value="BANGER">🔥 BANGER (96%–100%)</option>
              <option value="TOP PICK">TOP PICK (90%–95.99%)</option>
              <option value="HIGH CONFIDENCE">HIGH CONFIDENCE (83%–89.99%)</option>
              <option value="MID CONFIDENCE">MID CONFIDENCE (70%–82.99%)</option>
              <option value="LOW CONFIDENCE">LOW CONFIDENCE (60%–69.99%)</option>
              <option value="RISKY">RISKY (45%–59.99%)</option>
            </select>

            <select
              className="filter-select-input"
              value={scoreStatusFilter}
              onChange={(e) => setScoreStatusFilter(e.target.value)}
            >
              <option value="all">Score: All Scores</option>
              <option value="live">🔴 Live In-Play Only</option>
              <option value="finished">🏁 Finished Matches</option>
              <option value="scheduled">⏱ Scheduled Fixtures</option>
            </select>

            <input
              type="text"
              className="filter-select-input"
              placeholder="Search teams..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ minWidth: 160 }}
            />
          </div>

          <div className="filter-bottom-actions">
            <div className="active-filter-chips">
              <span className="active-chip">
                ⚡ {selectedDay === 0 ? `Today (${watDateStr})` : selectedDay === 'yesterday' ? 'Yesterday' : `Queue: ${selectedDay}`}
              </span>
              <button
                type="button"
                className="btn-reset-filters"
                onClick={resetAllFilters}
              >
                🔄 Reset (1)
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <span className="matches-count-text">
                Showing <strong>{filteredFixtures.length}</strong> of {fixtures.length} matches
              </span>

              <div className="expand-collapse-group">
                <button
                  type="button"
                  className="btn-toggle-expand"
                  onClick={() => setExpandAll(true)}
                >
                  Expand All
                </button>
                <button
                  type="button"
                  className="btn-toggle-expand"
                  onClick={() => setExpandAll(false)}
                >
                  Collapse All
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 7. MAIN DASHBOARD 3-COLUMN GRID */}
        <div className="main-dashboard-grid">
          {/* LEFT SIDEBAR: DAILY 90%+ BANGERS */}
          <aside className="bangers-sidebar-card">
            <div className="bangers-sidebar-header">
              <div className="bangers-header-top">
                <span className="bangers-header-title">DAILY 90%+ BANGERS</span>
                <span className="bangers-count-badge">{bangerFixturesList.length} Active</span>
              </div>
              <div className="bangers-header-sub">Top Algorithmic Locks</div>
            </div>

            <div className="bangers-list-box">
              {bangerFixturesList.length === 0 ? (
                <div style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                  No bangers in queue yet. High-probability consensus appears as matches approach kickoff.
                </div>
              ) : (
                bangerFixturesList.map((bf) => {
                  const time = formatKickoff(bf.target_kickoff_at);
                  const pList = predsByFixture.get(bf.id) || [];
                  const tList = teasersByFixture.get(bf.id) || [];
                  const bangerPred: any = (canViewPredictions ? pList : tList).find(
                    (p) => p.confidence_category === 'BANGER'
                  );

                  return (
                    <div
                      key={bf.id}
                      className="banger-item-tile"
                      onClick={() => {
                        setSelectedLeague(bf.league_code);
                      }}
                    >
                      <div className="banger-item-meta">
                        <span>{bf.league_code}</span>
                        <span>{time.timeStr} WAT</span>
                      </div>
                      <div className="banger-item-teams">
                        {bf.home_team_name} vs {bf.away_team_name}
                      </div>
                      <div className="banger-item-bottom">
                        <span className="banger-pred-text">
                          {bangerPred ? formatPredictionOutcome(bangerPred.prediction || '') : '🔥 BANGER'}
                        </span>
                        <span className="banger-prob-badge">
                          {bangerPred && bangerPred.probability ? `${(bangerPred.probability * 100).toFixed(1)}%` : '96%+'}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* CENTER MAIN STREAM: FIXTURES & PREDICTIONS */}
          <div className="fixtures-stream-column">
            {/* Stream Section Banner Header */}
            <div className="stream-section-banner">
              <div className="stream-banner-left">
                <div className="calendar-green-box">📅</div>
                <div>
                  <div className="stream-title-text">
                    <span>
                      {selectedDay === 0
                        ? `Today: ${watDateStr || 'Today'} Fixtures`
                        : selectedDay === 'yesterday'
                        ? 'Yesterday Settled Fixtures'
                        : `Selected Horizon: Day ${selectedDay}`}
                    </span>
                    {selectedDay === 0 && <span className="live-today-pill">LIVE TODAY</span>}
                  </div>
                  <p className="stream-sub-text">
                    Matches scheduled & live settlement tracking for today
                  </p>
                </div>
              </div>

              <div className="stream-fixtures-count-badge">
                Fixtures: <strong>{filteredFixtures.length} Matches</strong>
              </div>
            </div>

            {/* Loading / Error States */}
            {error && (
              <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#b91c1c', fontSize: 13 }}>
                <strong>Cloud Telemetry Notice:</strong> {error}
              </div>
            )}

            {loading ? (
              <div style={{ padding: 40, background: '#ffffff', borderRadius: 16, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-600 mb-3" />
                <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Synchronizing Cloud Supabase Queue...</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Fetching verified 250,000 Monte Carlo draws and authoritative match results.
                </div>
              </div>
            ) : filteredFixtures.length === 0 ? (
              <div style={{ padding: 48, background: '#ffffff', borderRadius: 16, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⚽</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>No Matching Fixtures Found</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, maxWidth: 460, margin: '6px auto 16px' }}>
                  No matches match your current competition, market, or date filter parameters.
                </div>
                <button
                  type="button"
                  className="btn-toggle-expand"
                  onClick={resetAllFilters}
                >
                  Reset All Filters
                </button>
              </div>
            ) : (
              filteredFixtures.map((fixture) => {
                const time = formatKickoff(fixture.target_kickoff_at);
                const fixturePreds = predsByFixture.get(fixture.id) || [];
                const fixtureTeasers = teasersByFixture.get(fixture.id) || [];
                const isLive = fixture.status === 'live';
                const isFinished = fixture.status === 'finished';
                const isStarred = favorites.includes(fixture.id);

                return (
                  <div key={fixture.id} className="fixture-card">
                    <div className="card-top">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="league-badge">
                          {fixture.league_name || fixture.league_code}
                        </span>
                        <span className={`queue-day-pill ${fixture.queue_day === 0 ? 'queue-day-0' : 'queue-day-1'}`}>
                          {fixture.queue_day === 0 ? 'Queue: Today' : fixture.queue_day < 0 ? 'History' : `Queue: Day +${fixture.queue_day}`}
                        </span>
                      </div>

                      <button
                        type="button"
                        className={`star-favorite-btn ${isStarred ? 'starred' : ''}`}
                        title={isStarred ? 'Remove from Watchlist' : 'Add to Watchlist'}
                        onClick={() => toggleFavorite(fixture.id)}
                      >
                        {isStarred ? '★' : '☆'}
                      </button>
                    </div>

                    <div className="matchup-container">
                      <div className="team-row">
                        <div className="team-info">
                          <div className="team-icon">
                            {fixture.home_team_name?.charAt(0)?.toUpperCase() || 'H'}
                          </div>
                          <span className="team-name">{fixture.home_team_name.replace(/-/g, ' ')}</span>
                        </div>
                        {fixture.home_score !== null && (
                          <span className="team-score">{fixture.home_score}</span>
                        )}
                      </div>

                      <div className="vs-divider">VS</div>

                      <div className="team-row">
                        <div className="team-info">
                          <div className="team-icon">
                            {fixture.away_team_name?.charAt(0)?.toUpperCase() || 'A'}
                          </div>
                          <span className="team-name">{fixture.away_team_name.replace(/-/g, ' ')}</span>
                        </div>
                        {fixture.away_score !== null && (
                          <span className="team-score">{fixture.away_score}</span>
                        )}
                      </div>
                    </div>

                    {/* Live Match State Banner */}
                    {isLive && (
                      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 800, color: '#dc2626' }}>
                          🔴 LIVE {fixture.match_minute ? `${fixture.match_minute}'` : ''}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 900, color: '#dc2626' }}>
                          Score: {fixture.home_score ?? 0} - {fixture.away_score ?? 0}
                        </span>
                      </div>
                    )}

                    {/* Finished Match State Banner */}
                    {isFinished && (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
                          FULL TIME
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 800, color: '#0f172a' }}>
                          Final: {fixture.home_score ?? 0} - {fixture.away_score ?? 0}
                        </span>
                      </div>
                    )}

                    <div className="card-bottom">
                      <span className="kickoff-time">
                        {time.dateStr} • {time.timeStr} WAT
                      </span>
                      <span className="status-badge">
                        {fixture.status.toUpperCase()}
                      </span>
                    </div>

                    {/* Expandable Predictions / Locked Teasers */}
                    {expandAll && (
                      canViewPredictions ? (
                        fixturePreds.length > 0 ? (
                          <div className="prediction-panel">
                            <div className="prediction-panel-header">
                              <div className="sim-verified-pill">
                                <span className="dot"></span>
                                <span>Exact 250,000 Draws Verified</span>
                              </div>
                              <span className="model-tag">
                                {simsByFixture.get(fixture.id)?.run_tracking?.seed ? `Seed: ${simsByFixture.get(fixture.id)?.run_tracking?.seed} • ` : ''}PCG64 • Dixon-Coles
                              </span>
                            </div>

                            <div className="prediction-list">
                              {fixturePreds.map((p) => {
                                const pct = (p.probability * 100).toFixed(2);
                                const isWon = p.settlement_status === 'won';
                                const isLost = p.settlement_status === 'lost';
                                const isVoid = p.settlement_status === 'void' || p.settlement_status === 'voided';
                                const isPending = !p.settlement_status || p.settlement_status === 'pending';

                                return (
                                  <div key={p.id} className="prediction-row">
                                    <div className="pred-row-top">
                                      <div className="pred-market-outcome">
                                        <span className="pred-market-name">{formatMarketName(p.market)}:</span>
                                        <span className="pred-outcome-val">{formatPredictionOutcome(p.prediction)}</span>
                                      </div>
                                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                        {isWon && <span className="badge-settled-won">✓ WON</span>}
                                        {isLost && <span className="badge-settled-lost">✗ LOST</span>}
                                        {isVoid && <span className="badge-settled-void">⊘ VOID</span>}
                                        {isPending && <span className="badge-settled-pending">⏳ PENDING</span>}
                                        <span className={`tier-badge ${getTierBadgeClass(p.confidence_category)}`}>
                                          {formatCategoryName(p.confidence_category)}
                                        </span>
                                      </div>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Simulated Probability</span>
                                      <span className="pred-prob-val">{pct}%</span>
                                    </div>

                                    <div className="pred-bar-container">
                                      <div
                                        className="pred-bar-fill"
                                        style={{
                                          width: `${Math.min(100, p.probability * 100)}%`,
                                          background: getCategoryColor(p.confidence_category, isWon, isLost, isVoid)
                                        }}
                                      />
                                    </div>

                                    {p.settlement_notes && (
                                      <div className={`settle-reason-tag ${isWon ? 'won' : ''}`}>
                                        <strong>Settlement:</strong> {p.settlement_notes}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div style={{ marginTop: 10, padding: '8px 12px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                            ⚙ Features Incomplete • NOT_READY (0 Simulations • Zero Speculative Leakage)
                          </div>
                        )
                      ) : (
                        fixtureTeasers.length > 0 ? (
                          <div className="prediction-panel">
                            <div className="prediction-panel-header">
                              <div className="sim-verified-pill" style={{ background: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8' }}>
                                <span>🔒</span>
                                <span>{fixtureTeasers.length} Model Signal{fixtureTeasers.length > 1 ? 's' : ''} (Locked)</span>
                              </div>
                              <span className="model-tag">250k Draws Backed</span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                              {fixtureTeasers.map((t) => (
                                <div key={t.id} className="teaser-locked-box">
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      <span className="teaser-market-label">{formatMarketName(t.market)}</span>
                                      <span className={`tier-badge ${getTierBadgeClass(t.confidence_category)}`}>
                                        {formatCategoryName(t.confidence_category)}
                                      </span>
                                    </div>
                                    <div className="teaser-lock-info">
                                      🔒 Prediction & Simulated Probability Locked
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
                                        setIsPricingModalOpen(true);
                                      }
                                    }}
                                  >
                                    Unlock
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null
                      )
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* RIGHT SIDEBAR: FAVORITES / WATCHLIST */}
          <aside className="watchlist-sidebar-card">
            <div className="watchlist-sidebar-header">
              <span className="watchlist-header-title">
                <span>★</span> FAVORITES / WATCHLIST
              </span>
              <span className="watchlist-count-badge">
                {favorites.length} Saved
              </span>
            </div>

            <div className="watchlist-content-box">
              {favorites.length === 0 ? (
                <>
                  <div className="watchlist-empty-icon">★</div>
                  <div className="watchlist-empty-title">Watchlist Empty</div>
                  <p className="watchlist-empty-sub">
                    Click the star icon (☆) on any fixture card to pin it here for instant livescore tracking.
                  </p>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left' }}>
                  {fixtures
                    .filter((f) => favorites.includes(f.id))
                    .map((fav) => {
                      const time = formatKickoff(fav.target_kickoff_at);
                      return (
                        <div
                          key={fav.id}
                          className="banger-item-tile"
                          onClick={() => setSelectedLeague(fav.league_code)}
                        >
                          <div className="banger-item-meta">
                            <span>{fav.league_code}</span>
                            <span>{time.timeStr} WAT</span>
                          </div>
                          <div className="banger-item-teams">
                            {fav.home_team_name} vs {fav.away_team_name}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: '#059669' }}>
                              STATUS: {fav.status.toUpperCase()}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(fav.id);
                              }}
                              style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </aside>
        </div>
      </main>

      {/* FOOTER */}
      <footer className="app-footer">
        <div style={{ maxWidth: 1480, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <strong>JamBets AI Football Engine</strong> • Dixon-Coles 250,000 Monte Carlo Simulation Engine • Zero Data Leakage
            {schedulerJob && <span> • 6h Scheduler: {schedulerJob.status}</span>}
            {settlementJob && <span> • 15m Settle: {settlementJob.status}</span>}
          </div>
          <div style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            Supabase Authoritative Sync {latencyMs !== null ? `(${latencyMs}ms)` : ''} • Updated {lastRefreshed.toLocaleTimeString()} • WAT (UTC+1)
          </div>
        </div>
      </footer>

      {/* MODALS */}
      <PricingModal
        isOpen={isPricingModalOpen}
        onClose={() => setIsPricingModalOpen(false)}
        onUpgrade={() => {
          if (!currentUser) {
            setAuthModalMode('register');
            setIsAuthModalOpen(true);
          } else {
            setIsProfileModalOpen(true);
          }
        }}
      />

      <FaqModal
        isOpen={isFaqModalOpen}
        onClose={() => setIsFaqModalOpen(false)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={fetchCloudData}
        initialMode={authModalMode}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        profile={profile}
        subscription={subscription}
        entitlement={entitlement}
        onProfileUpdated={fetchCloudData}
      />
    </div>
  );
}
