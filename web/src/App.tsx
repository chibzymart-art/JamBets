import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from './lib/supabase';
import {
  QueueFixture,
  FootballPrediction,
  UserProfile,
  UserSubscription,
  UserEntitlement,
  LeagueRecord
} from './types';
import { AuthModal } from './components/AuthModal';
import { ProfileModal } from './components/ProfileModal';
import { AdminView } from './components/AdminView';
import { PricingModal } from './components/PricingModal';
import { FaqModal } from './components/FaqModal';
import { NavigationFooter } from './components/NavigationFooter';
import { FixtureCard, formatPredictionOutcome } from './components/FixtureCard';
import { LandingPage } from './pages/Landing';
import { SubscriptionPage } from './pages/Subscription';
import { PasswordRecoveryPage } from './pages/PasswordRecovery';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  // Authentication & Entitlement State
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);

  // Modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'register' | 'forgot'>('signin');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isFaqModalOpen, setIsFaqModalOpen] = useState(false);

  // Authoritative Cloud Data State
  const [fixtures, setFixtures] = useState<QueueFixture[]>([]);
  const [predictions, setPredictions] = useState<FootballPrediction[]>([]);
  const [leaguesList, setLeaguesList] = useState<LeagueRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  interface SportAvailability {
    isAvailable: boolean;
    fixtureCount: number;
    leagueCount: number;
  }


  // Remove any legacy theme attributes to guarantee permanent light mode
  useEffect(() => {
    document.documentElement.removeAttribute('data-theme');
    document.body.removeAttribute('data-theme');
    try {
      localStorage.removeItem('jambets_theme');
      localStorage.removeItem('jambets-theme');
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Sports Category Selector with Cloud Supabase Dynamic Availability
  const [selectedSport, setSelectedSport] = useState<string>('football');
  const [sportsState, setSportsState] = useState<Record<string, SportAvailability>>({
    football: { isAvailable: true, fixtureCount: 433, leagueCount: 30 },
    american_football: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
    basketball: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
    tennis: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
    cricket: { isAvailable: false, fixtureCount: 0, leagueCount: 0 }
  });

  // Calendar-Grounded Date Navigation State (Strictly Africa/Lagos Kickoff Dates - Default to Today)
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    try {
      const now = new Date();
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(now);
    } catch {
      return new Date().toISOString().split('T')[0];
    }
  });
  const [expandedFixtures, setExpandedFixtures] = useState<Set<string>>(new Set());
  const [isAllLeaguesModalOpen, setIsAllLeaguesModalOpen] = useState(false);

  // Multi-Filters
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [selectedMarket, setSelectedMarket] = useState<string>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'void'>('all');
  const [scoreStatusFilter, setScoreStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const toggleFixtureExpand = (fixtureId: string) => {
    setExpandedFixtures((prev) => {
      const next = new Set(prev);
      if (next.has(fixtureId)) {
        next.delete(fixtureId);
      } else {
        next.add(fixtureId);
      }
      return next;
    });
  };

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

  const [, setLatencyMs] = useState<number | null>(null);
  const [, setLastRefreshed] = useState<Date>(new Date());

  // Phase 4.6: Admin Engine Trigger State & Poller Listener
  const [adminTaskStatus, setAdminTaskStatus] = useState<{
    type: 'prediction' | 'settlement' | null;
    status: 'idle' | 'pending' | 'running' | 'completed' | 'failed';
    message?: string;
    taskId?: string;
  }>({ type: null, status: 'idle' });

  const triggerAdminTask = async (taskName: 'RUN_PREDICTIONS' | 'RUN_SETTLEMENTS') => {
    const type = taskName === 'RUN_PREDICTIONS' ? 'prediction' : 'settlement';
    setAdminTaskStatus({
      type,
      status: 'pending',
      message: `Queueing ${taskName}...`
    });

    try {
      const { data, error: insertErr } = await supabase
        .from('admin_tasks')
        .insert({
          task_name: taskName,
          status: 'PENDING',
          metadata: {
            triggered_by: 'admin_ui_override',
            user_id: currentUser?.id || 'anonymous_admin',
            timestamp: new Date().toISOString()
          }
        })
        .select()
        .single();

      if (insertErr || !data) {
        throw new Error(insertErr?.message || 'Failed to insert admin task');
      }

      const taskId = data.id;
      setAdminTaskStatus({
        type,
        status: 'pending',
        taskId,
        message: `Task queued (PENDING). Waiting for backend poller...`
      });

      // Poll task status until complete or failed (up to 2 minutes)
      const startTime = Date.now();
      const interval = setInterval(async () => {
        try {
          const { data: updatedTask } = await supabase
            .from('admin_tasks')
            .select('*')
            .eq('id', taskId)
            .single();

          if (updatedTask) {
            const currentStatus = updatedTask.status;
            if (currentStatus === 'RUNNING') {
              setAdminTaskStatus({
                type,
                status: 'running',
                taskId,
                message: `Backend poller active: ${taskName} is RUNNING...`
              });
            } else if (currentStatus === 'COMPLETED') {
              clearInterval(interval);
              setAdminTaskStatus({
                type,
                status: 'completed',
                taskId,
                message: `✅ ${taskName} completed successfully! Data refreshed.`
              });
              await fetchCloudData();
              setTimeout(() => {
                setAdminTaskStatus({ type: null, status: 'idle' });
              }, 6000);
            } else if (currentStatus === 'FAILED') {
              clearInterval(interval);
              setAdminTaskStatus({
                type,
                status: 'failed',
                taskId,
                message: `❌ ${taskName} failed: ${updatedTask.error_message || 'Unknown error'}`
              });
              setTimeout(() => {
                setAdminTaskStatus({ type: null, status: 'idle' });
              }, 8000);
            }
          }

          if (Date.now() - startTime > 360000) {
            clearInterval(interval);
            setAdminTaskStatus({
              type,
              status: 'failed',
              message: 'Task poll timeout (360s). Check background process.'
            });
          }
        } catch (pollErr) {
          console.error('Error polling admin task:', pollErr);
        }
      }, 2500);

    } catch (err: any) {
      console.error('Failed to trigger admin task:', err);
      setAdminTaskStatus({
        type,
        status: 'failed',
        message: `Failed to trigger ${taskName}: ${err.message || err}`
      });
      setTimeout(() => {
        setAdminTaskStatus({ type: null, status: 'idle' });
      }, 5000);
    }
  };

  useEffect(() => {
    const handleHash = () => {
      if (window.location.hash === '#admin') navigate('/admin');
      else if (window.location.hash === '#fixtures') navigate('/dashboard');
    };
    handleHash();
    window.addEventListener('hashchange', handleHash);
    return () => window.removeEventListener('hashchange', handleHash);
  }, [navigate]);

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
        // Enforce soft-delete deactivation compliance
        if (userRes.data.is_deleted === true || userRes.data.status === 'disabled') {
          console.warn('User account is soft-deleted / disabled. Signing out immediately.');
          await supabase.auth.signOut();
          setCurrentUser(null);
          setProfile(null);
          setSubscription(null);
          setEntitlement(null);
          alert('This account has been deactivated (soft delete). Access to JamBets is blocked.');
          return;
        }
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
        if (data.user.user_metadata?.status === 'disabled' || data.user.user_metadata?.is_deleted === true) {
          supabase.auth.signOut();
          setCurrentUser(null);
          setProfile(null);
          setSubscription(null);
          setEntitlement(null);
          return;
        }
        setCurrentUser(data.user);
        fetchUserData(data.user.id);
      } else {
        setCurrentUser(null);
        setProfile(null);
        setSubscription(null);
        setEntitlement(null);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        if (session.user.user_metadata?.status === 'disabled' || session.user.user_metadata?.is_deleted === true) {
          await supabase.auth.signOut();
          setCurrentUser(null);
          setProfile(null);
          setSubscription(null);
          setEntitlement(null);
          alert('This account has been deactivated (soft delete). Access to JamBets is blocked.');
          return;
        }
        setCurrentUser(session.user);
        await fetchUserData(session.user.id);
        if (event === 'SIGNED_IN') {
          navigate('/dashboard');
        }
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
  }, [navigate]);

  // Strict RBAC: Check whether active user is an administrator
  const isAdmin = useMemo(() => {
    if (!currentUser) return false;
    const email = currentUser.email?.toLowerCase();
    return (
      currentUser.user_metadata?.role === 'admin' ||
      (currentUser as any)?.app_metadata?.role === 'admin' ||
      profile?.role === 'admin' ||
      email === 'chibzymart@gmail.com' ||
      email === 'whizzchibz@gmail.com' ||
      email === 'chibuezeamuchie@gmail.com'
    );
  }, [currentUser, profile]);

  // Entitlement Permission
  const canViewPredictions = useMemo(() => {
    if (!currentUser) return false;
    if (isAdmin) return true;
    if (profile?.role === 'admin') return true;
    if (profile?.role === 'standard' || profile?.role === 'bigbang') return true;
    if (entitlement?.can_view_predictions === true) return true;
    return false;
  }, [currentUser, isAdmin, profile, entitlement]);

  const handleAuthSuccess = async () => {
    setIsAuthModalOpen(false);
    await fetchCloudData();
    navigate('/dashboard');
  };

  // Cache ref to prevent hammering Supabase within 30 seconds
  const lastFetchTimeRef = useRef<number>(0);

  // Authoritative Cloud Supabase Query (Optimized Unified Query & Anti-Hammering SWR Cache)
  const fetchCloudData = async (force: boolean = false) => {
    const now = Date.now();
    if (!force && lastFetchTimeRef.current > 0 && now - lastFetchTimeRef.current < 30000) {
      return;
    }
    lastFetchTimeRef.current = now;

    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      // 1. Authoritative Cloud Supabase Query on football_predictions_paywall
      // Combines published predictions (paywall masked for free users, unmasked for subscribers/admins)
      // and embeds corresponding fixture, league, and team records in a single round-trip.
      const predictionsQuery = supabase
        .from('football_predictions_paywall')
        .select(`
          id,
          fixture_id,
          prediction,
          market,
          probability,
          confidence_category,
          secondary_predictions,
          metadata,
          settlement_status,
          settlement_notes,
          settled_at,
          actual_score,
          publication_status,
          simulations_count,
          target_kickoff_at,
          tier_required,
          is_locked,
          fixture:football_fixtures!inner(
            id,
            canonical_key,
            target_kickoff_at,
            status,
            queue_day,
            in_prediction_queue,
            home_score,
            away_score,
            match_minute,
            period,
            half_time_home_score,
            half_time_away_score,
            corners_home,
            corners_away,
            postponed_at,
            cancelled_at,
            venue,
            metadata,
            league:football_leagues!inner(id, name, code, country),
            home_team:football_teams!football_fixtures_home_team_id_fkey(id, name),
            away_team:football_teams!football_fixtures_away_team_id_fkey(id, name)
          )
        `)
        .eq('publication_status', 'published')
        .order('target_kickoff_at', { ascending: true })
        .limit(2000);

      const leagueQuery = supabase
        .from('football_leagues')
        .select('id, name, code, country')
        .order('name', { ascending: true });

      const [predictionsRes, leagueRes] = await Promise.all([
        predictionsQuery,
        leagueQuery
      ]);

      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);

      if (predictionsRes.error) throw predictionsRes.error;
      const rawPredRecords = predictionsRes.data || [];
      const embeddedPreds: FootballPrediction[] = [];
      const fixtureMap = new Map<string, QueueFixture>();

      rawPredRecords.forEach((item: any) => {
        const f = item.fixture;
        if (!f) return;

        const isLocked = item.is_locked === true || item.confidence_category === 'LOCKED';
        if (!isLocked) {
          if (typeof item.probability !== 'number' || item.probability <= 0) return;
          if (!item.prediction || !item.confidence_category) return;
        }

        embeddedPreds.push({
          id: item.id,
          fixture_id: f.id,
          prediction: isLocked ? 'LOCKED' : item.prediction,
          market: item.market,
          probability: isLocked ? 0 : item.probability,
          confidence_category: isLocked ? 'LOCKED' : item.confidence_category,
          secondary_predictions: item.secondary_predictions,
          metadata: item.metadata,
          settlement_status: item.settlement_status,
          settlement_notes: item.settlement_notes,
          settled_at: item.settled_at || null,
          actual_score: item.actual_score || null,
          publication_status: item.publication_status,
          simulations_count: item.simulations_count,
          tier_required: item.tier_required || 'free',
          source_data_version: item.source_data_version || '1.0',
          created_at: item.created_at || new Date().toISOString(),
          target_kickoff_at: item.target_kickoff_at || f.target_kickoff_at,
          is_locked: isLocked
        });

        if (!fixtureMap.has(f.id)) {
          fixtureMap.set(f.id, {
            id: f.id,
            canonical_key: f.canonical_key,
            target_kickoff_at: f.target_kickoff_at,
            status: f.status,
            queue_day: f.queue_day,
            in_prediction_queue: f.in_prediction_queue,
            home_score: f.home_score,
            away_score: f.away_score,
            match_minute: f.match_minute,
            period: f.period,
            half_time_home_score: f.half_time_home_score,
            half_time_away_score: f.half_time_away_score,
            corners_home: f.corners_home,
            corners_away: f.corners_away,
            postponed_at: f.postponed_at || null,
            cancelled_at: f.cancelled_at || null,
            created_at: f.created_at || new Date().toISOString(),
            updated_at: f.updated_at || new Date().toISOString(),
            league_id: f.league?.id || f.league_id,
            league_name: f.league?.name || f.league_name || 'Other Competitions',
            league_code: f.league?.code || f.league_code || 'OTHER',
            league_country: f.league?.country || f.league_country || '',
            home_team_id: f.home_team?.id || f.home_team_id,
            home_team_name: f.home_team?.name || f.home_team_name || 'Home Team',
            away_team_id: f.away_team?.id || f.away_team_id,
            away_team_name: f.away_team?.name || f.away_team_name || 'Away Team',
            venue: f.venue || f.metadata?.venue || null
          });
        }
      });

      const returnedFixtures: QueueFixture[] = Array.from(fixtureMap.values());
      // Strictly earliest kickoff time first
      returnedFixtures.sort(
        (a, b) => new Date(a.target_kickoff_at).getTime() - new Date(b.target_kickoff_at).getTime()
      );

      const returnedLeagues: LeagueRecord[] = leagueRes.data || [];

      setFixtures(returnedFixtures);
      setLeaguesList(returnedLeagues);
      setPredictions(embeddedPreds);

      // Fast static sports state avoiding 404 HTTP round-trips
      setSportsState({
        football: {
          isAvailable: returnedFixtures.length > 0,
          fixtureCount: returnedFixtures.length,
          leagueCount: returnedLeagues.length
        },
        american_football: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
        basketball: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
        tennis: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
        cricket: { isAvailable: false, fixtureCount: 0, leagueCount: 0 }
      });

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
  }, [canViewPredictions, isAdmin]);

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

  // Date extraction strictly in Africa/Lagos (WAT / UTC+1)
  const getFixtureWatDate = (targetKickoffIso: string) => {
    try {
      const d = new Date(targetKickoffIso);
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(d);
    } catch {
      return '';
    }
  };

  // Dynamic Lagos (WAT / UTC+1) relative calendar dates
  // Strictly dynamic: Yesterday, Today, Tomorrow, date, date
  const dynamicDateTabs = useMemo(() => {
    // Map fixture counts by WAT kickoff date
    const fixtureCountByDate = new Map<string, number>();
    fixtures.forEach((f) => {
      const d = getFixtureWatDate(f.target_kickoff_at);
      if (d) {
        fixtureCountByDate.set(d, (fixtureCountByDate.get(d) || 0) + 1);
      }
    });

    // Current date in Africa/Lagos (WAT / UTC+1)
    const now = new Date();
    const lagosParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Lagos',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now);
    const [curYear, curMonth, curDay] = lagosParts.split('-').map(Number);

    const getDateDetails = (offsetDays: number) => {
      const d = new Date(Date.UTC(curYear, curMonth - 1, curDay + offsetDays, 12, 0, 0));
      const iso = d.toISOString().split('T')[0];
      const formatted = d.toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      }).replace(',', '');
      return { iso, formatted, count: fixtureCountByDate.get(iso) || 0 };
    };

    const yesterday = getDateDetails(-1);
    const today = getDateDetails(0);
    const tomorrow = getDateDetails(1);

    // Ensure full 4-day forward horizon: Tomorrow (Day +1), Day +2, Day +3, Day +4
    const futureDateIsos = [
      getDateDetails(2).iso,
      getDateDetails(3).iso,
      getDateDetails(4).iso
    ];

    const futureDates = futureDateIsos.map((iso, idx) => {
      const [y, m, d] = iso.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      const formatted = dt.toLocaleDateString('en-GB', {
        timeZone: 'UTC',
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      }).replace(',', '');
      return {
        id: iso,
        label: formatted,
        subLabel: `Day +${idx + 2}`,
        count: fixtureCountByDate.get(iso) || 0
      };
    });

    return {
      all: {
        id: 'all',
        label: 'Show All Dates',
        subLabel: `${fixtures.length} matches`,
        count: fixtures.length
      },
      yesterday: {
        id: yesterday.iso,
        label: 'Yesterday',
        subLabel: yesterday.formatted,
        count: yesterday.count
      },
      today: {
        id: today.iso,
        label: 'Today',
        subLabel: today.formatted,
        count: today.count
      },
      tomorrow: {
        id: tomorrow.iso,
        label: 'Tomorrow',
        subLabel: tomorrow.formatted,
        count: tomorrow.count
      },
      futureDates,
      todayIso: today.iso,
      yesterdayIso: yesterday.iso,
      tomorrowIso: tomorrow.iso
    };
  }, [fixtures]);

  // All 30 Leagues with fixture counts in the current dataset (Alphabetical)
  const allLeaguesWithCounts = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string; country: string; count: number }>();
    leaguesList.forEach((l) => {
      if (l.code) {
        map.set(l.code, {
          id: l.id,
          code: l.code,
          name: l.name || l.code,
          country: l.country || '',
          count: 0
        });
      }
    });
    fixtures.forEach((f) => {
      if (f.league_code) {
        const item = map.get(f.league_code) || {
          id: f.league_id || f.league_code,
          code: f.league_code,
          name: f.league_name || f.league_code,
          country: '',
          count: 0
        };
        item.count++;
        map.set(f.league_code, item);
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [leaguesList, fixtures]);

  // Active leagues with matches in current queue (sorted by match count descending)
  const availableLeagues = useMemo(() => {
    return allLeaguesWithCounts
      .filter((l) => l.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [allLeaguesWithCounts]);

  // Dynamic Sports Registry with Cloud Supabase Availability
  const sportsList = useMemo(() => [
    {
      id: 'football',
      name: 'Football',
      icon: '⚽',
      isAvailable: sportsState.football?.isAvailable ?? true,
      fixtureCount: sportsState.football?.fixtureCount ?? (fixtures.length || 433),
      leagueCount: sportsState.football?.leagueCount ?? (availableLeagues.length || 30),
      statusLabel: (sportsState.football?.isAvailable ?? true) ? 'Available' : 'Coming Soon',
      subtext: (sportsState.football?.isAvailable ?? true)
        ? `${availableLeagues.length || 30} Available Leagues`
        : 'Coming Soon'
    },
    {
      id: 'american_football',
      name: 'American Football',
      icon: '🏈',
      isAvailable: sportsState.american_football?.isAvailable ?? false,
      fixtureCount: sportsState.american_football?.fixtureCount ?? 0,
      leagueCount: sportsState.american_football?.leagueCount ?? 0,
      statusLabel: sportsState.american_football?.isAvailable ? 'Available' : 'Coming Soon',
      subtext: sportsState.american_football?.isAvailable
        ? `${sportsState.american_football.leagueCount} Available Leagues`
        : 'Coming Soon'
    },
    {
      id: 'basketball',
      name: 'Basketball',
      icon: '🏀',
      isAvailable: sportsState.basketball?.isAvailable ?? false,
      fixtureCount: sportsState.basketball?.fixtureCount ?? 0,
      leagueCount: sportsState.basketball?.leagueCount ?? 0,
      statusLabel: sportsState.basketball?.isAvailable ? 'Available' : 'Coming Soon',
      subtext: sportsState.basketball?.isAvailable
        ? `${sportsState.basketball.leagueCount} Available Leagues`
        : 'Coming Soon'
    },
    {
      id: 'tennis',
      name: 'Tennis',
      icon: '🎾',
      isAvailable: sportsState.tennis?.isAvailable ?? false,
      fixtureCount: sportsState.tennis?.fixtureCount ?? 0,
      leagueCount: sportsState.tennis?.leagueCount ?? 0,
      statusLabel: sportsState.tennis?.isAvailable ? 'Available' : 'Coming Soon',
      subtext: sportsState.tennis?.isAvailable
        ? `${sportsState.tennis.leagueCount} Available Leagues`
        : 'Coming Soon'
    },
    {
      id: 'cricket',
      name: 'Cricket',
      icon: '🏏',
      isAvailable: sportsState.cricket?.isAvailable ?? false,
      fixtureCount: sportsState.cricket?.fixtureCount ?? 0,
      leagueCount: sportsState.cricket?.leagueCount ?? 0,
      statusLabel: sportsState.cricket?.isAvailable ? 'Available' : 'Coming Soon',
      subtext: sportsState.cricket?.isAvailable
        ? `${sportsState.cricket.leagueCount} Available Leagues`
        : 'Coming Soon'
    }
  ], [sportsState, availableLeagues]);

  const currentSportObj = useMemo(() => {
    return sportsList.find((s) => s.id === selectedSport) || sportsList[0];
  }, [sportsList, selectedSport]);

  // Comprehensive Metrics Calculations (Strictly Cloud Supabase Derived — Zero Fallbacks)
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

    const sourceList = predictions;

    // Filter predictions to only those matching current date filter if not 'all'
    const activeFixtureIds = new Set(
      (selectedDate === 'all'
        ? fixtures
        : fixtures.filter((f) => getFixtureWatDate(f.target_kickoff_at) === selectedDate)
      ).map((f) => f.id)
    );

    sourceList.forEach((item: any) => {
      if (!activeFixtureIds.has(item.fixture_id)) return;
      const f = fixtures.find((fix) => fix.id === item.fixture_id);
      const isFinished = f?.status === 'finished' || f?.period === 'FT';
      let st = item.settlement_status || 'pending';
      // "Lost should be when a fixture has been completely ended and result confirmed"
      if (st === 'lost' && !isFinished) {
        st = 'pending';
      }
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
    const allWinRate = allDecided > 0 ? Math.round((allWon / allDecided) * 100) : 0;

    const bangerDecided = bangerWon + bangerLost;
    const bangerWinRate = bangerDecided > 0 ? Math.round((bangerWon / bangerDecided) * 100) : 0;

    const topPickDecided = topPickWon + topPickLost;
    const topPickWinRate = topPickDecided > 0 ? Math.round((topPickWon / topPickDecided) * 100) : 0;

    const scopedFixtures = selectedDate === 'all'
      ? fixtures
      : fixtures.filter((f) => getFixtureWatDate(f.target_kickoff_at) === selectedDate);

    const liveCount = scopedFixtures.filter((f) => {
      const isFinished = f.status === 'finished' || f.period === 'FT';
      return !isFinished && (
        f.status === 'live' ||
        f.status === 'in_progress' ||
        f.status === 'halftime' ||
        (f.period && ['1H', 'HT', '2H', 'ET', 'PK'].includes(f.period.toUpperCase()))
      );
    }).length;
    const settledMatchesCount = scopedFixtures.filter((f) => f.status === 'finished' || f.period === 'FT').length;

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
      bangerDecided,
      bangerWinRate,
      topPickTotal,
      topPickWon,
      topPickLost,
      topPickPending,
      topPickDecided,
      topPickWinRate,
      liveCount,
      settledMatchesCount
    };
  }, [fixtures, predsByFixture, canViewPredictions, selectedDate]);

  // Filter and sort fixtures for display
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      const fixturePreds = predsByFixture.get(f.id) || [];
      const signals: any[] = fixturePreds;
      const isFinished = f.status === 'finished' || f.period === 'FT';
      const isLive = !isFinished && (
        f.status === 'live' ||
        f.status === 'in_progress' ||
        f.status === 'halftime' ||
        (f.period && ['1H', 'HT', '2H', 'ET', 'PK'].includes(f.period.toUpperCase()))
      );

      // League filter
      if (selectedLeague !== 'all' && f.league_code !== selectedLeague) {
        return false;
      }

      // Date Navigation Filter (Ground truth: Africa/Lagos kickoff date)
      if (selectedDate !== 'all') {
        const fDate = getFixtureWatDate(f.target_kickoff_at);
        if (fDate !== selectedDate) return false;
      }

      // Score status filter (Live, Finished, Scheduled)
      if (scoreStatusFilter !== 'all') {
        if (scoreStatusFilter === 'live' && !isLive) return false;
        if (scoreStatusFilter === 'finished' && !isFinished) return false;
        if (scoreStatusFilter === 'scheduled' && (isLive || isFinished)) return false;
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
            let st = p.settlement_status || 'pending';
            // "Lost should be when a fixture has been completely ended and result confirmed"
            if (st === 'lost' && !isFinished) {
              st = 'pending';
            }
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
    }).sort((a, b) => new Date(a.target_kickoff_at).getTime() - new Date(b.target_kickoff_at).getTime());
  }, [
    fixtures,
    predsByFixture,
    canViewPredictions,
    selectedLeague,
    selectedDate,
    scoreStatusFilter,
    selectedTier,
    selectedMarket,
    settlementFilter,
    searchQuery
  ]);


  // List of fixtures that feature BANGER signals for the left sidebar (strictly today in WAT)
  const bangerFixturesList = useMemo(() => {
    return fixtures.filter((f) => {
      if (getFixtureWatDate(f.target_kickoff_at) !== dynamicDateTabs.today.id) return false;
      const pList = predsByFixture.get(f.id) || [];
      return pList.some((s) => s.confidence_category === 'BANGER');
    });
  }, [fixtures, predsByFixture, dynamicDateTabs.today.id]);

  // Helpers
  const formatKickoff = (isoString: string) => {
    const d = new Date(isoString);
    return {
      timeStr: d.toLocaleTimeString('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hour12: false }),
      dateStr: d.toLocaleDateString('en-GB', { timeZone: 'Africa/Lagos', month: 'short', day: 'numeric' })
    };
  };

  const resetAllFilters = () => {
    setSelectedLeague('all');
    setSelectedTier('all');
    setSelectedMarket('all');
    setSettlementFilter('all');
    setScoreStatusFilter('all');
    setSelectedDate(dynamicDateTabs.today.id);
    setSearchQuery('');
  };

  // Unified Platform View (Header, Top Regulatory Notice & Footer on all pages)
  return (
    <div className="app-wrapper">
      {/* 0. PINNED UNIVERSAL REGULATORY BANNER (WHITE BACKGROUND, SINGLE LINE SLIDING TICKER) */}
      <aside className="regulatory-top-banner" role="note" aria-label="Strict Regulatory Notice">
        <div className="regulatory-ticker-wrap">
          <div className="regulatory-ticker-track">
            <span className="regulatory-ticker-text">
              <strong className="regulatory-prefix">🛡️ STRICT REGULATORY NOTICE:</strong> Predictions are probabilistic estimates derived from mathematical simulations for informational purposes only. They are not guarantees of outcomes, and JamGames does not place bets on anyone's behalf. Sports predictive modeling entails variance and uncertainty; please make decisions responsibly. JamGames will not take responsibility for any financial losses. This is STRICTLY FOR EDUCATIONAL purposes only and NOT A FINANCIAL OR INVESTMENT ADVICE. &nbsp;&nbsp;&nbsp;&nbsp;✦&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
            <span className="regulatory-ticker-text" aria-hidden="true">
              <strong className="regulatory-prefix">🛡️ STRICT REGULATORY NOTICE:</strong> Predictions are probabilistic estimates derived from mathematical simulations for informational purposes only. They are not guarantees of outcomes, and JamGames does not place bets on anyone's behalf. Sports predictive modeling entails variance and uncertainty; please make decisions responsibly. JamGames will not take responsibility for any financial losses. This is STRICTLY FOR EDUCATIONAL purposes only and NOT A FINANCIAL OR INVESTMENT ADVICE. &nbsp;&nbsp;&nbsp;&nbsp;✦&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
          </div>
        </div>
      </aside>

      {/* 1. TOP HEADER BAR */}
      <header className={`site-header ${location.pathname === '/' ? 'landing-standalone-header' : ''}`}>
        <div className="site-header-inner">
          <Link to="/" className="header-brand" onClick={() => resetAllFilters()} title="JamBets Home">
            <img src="/jambets-logo.svg" alt="JamBets Sniper Engine" className="brand-header-logo-img" />
          </Link>

          {/* Clean Unified Navigation Links */}
          <div className="header-center-links">
            <Link
              to="/dashboard"
              className={`nav-link-btn ${location.pathname.startsWith('/dashboard') ? 'active' : ''}`}
            >
              {currentUser ? 'Dashboard' : 'Predictions'}
            </Link>
            <button
              type="button"
              className={`nav-link-btn ${location.pathname === '/subscription' ? 'active' : ''}`}
              onClick={() => setIsPricingModalOpen(true)}
            >
              Pricing <span className="pricing-flat-badge">₦5k Flat</span>
            </button>
            <button
              type="button"
              className="nav-link-btn"
              onClick={() => setIsFaqModalOpen(true)}
            >
              FAQ
            </button>
          </div>

          <div className="header-right-actions">
            {location.pathname === '/' && (
              <Link to="/dashboard" className="landing-nav-cta">
                {currentUser ? '📊 Dashboard →' : '📊 Predictions →'}
              </Link>
            )}

            {isAdmin && (
              <Link
                to="/admin"
                className={`admin-header-pill ${location.pathname === '/admin' ? 'active-admin' : ''}`}
              >
                🛡 Admin Deck
              </Link>
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
                  style={{ background: '#059669', borderColor: '#059669', color: '#ffffff' }}
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
        <Routes>
          {/* ROUTE 1: DEDICATED HERO LANDING PAGE */}
          <Route
            path="/"
            element={
              <LandingPage
                onOpenAuth={(mode) => {
                  setAuthModalMode(mode);
                  setIsAuthModalOpen(true);
                }}
                currentUser={currentUser}
                userRole={profile?.role}
                onOpenFaq={() => setIsFaqModalOpen(true)}
                onOpenPricing={() => setIsPricingModalOpen(true)}
              />
            }
          />

          {/* ROUTE 2: PASSWORD RECOVERY PAGE */}
          <Route path="/reset-password" element={<PasswordRecoveryPage />} />
          <Route path="/forgot-password" element={<PasswordRecoveryPage />} />

          {/* ROUTE 3: NGN SUBSCRIPTION PAGE */}
          <Route
            path="/subscription"
            element={
              <SubscriptionPage
                currentUser={currentUser}
                userRole={profile?.role}
                onOpenAuth={(mode) => {
                  setAuthModalMode(mode);
                  setIsAuthModalOpen(true);
                }}
              />
            }
          />

          {/* REDIRECT ALIASES TO DASHBOARD */}
          <Route
            path="/analytics"
            element={<Navigate to="/dashboard" replace />}
          />
          <Route
            path="/predictions"
            element={<Navigate to="/dashboard" replace />}
          />
          <Route
            path="/dashboard/predictions"
            element={<Navigate to="/dashboard" replace />}
          />

          {/* ROUTE 4: ADMIN COMMAND DECK (STRICTLY GATED) */}
          <Route
            path="/admin"
            element={
              isAdmin ? (
                <AdminView
                  currentUserProfile={profile}
                  onBackToFixtures={() => navigate('/dashboard')}
                  onOpenAuthModal={() => {
                    setAuthModalMode('signin');
                    setIsAuthModalOpen(true);
                  }}
                />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />

          {/* ROUTE 5: PREDICTIONS FIXTURE DASHBOARD */}
          <Route
            path="/dashboard"
            element={
              <div id="fixtures-view-section">
        {/* Phase 4.6 & RBAC: Admin Engine Controls & Automation Overrides (Strictly locked to authenticated Admins) */}
        {isAdmin && (
          <section className="admin-engine-bar" aria-label="Engine Automation Controls">
            <div className="admin-engine-header-row">
              <div className="admin-engine-title-group">
                <span className="admin-badge-live">⚡ AUTOMATION & ENGINE CONTROLS</span>
                <span className="admin-engine-sub">Automated Processing Pipeline (30s Poller / Midnight Primary / 6:00 AM WAT Retry)</span>
              </div>
              {adminTaskStatus.status !== 'idle' && (
                <div className={`admin-task-banner status-${adminTaskStatus.status}`}>
                  <span className="admin-spinner-dot" />
                  <span className="admin-task-msg">{adminTaskStatus.message}</span>
                </div>
              )}
            </div>
            <div className="admin-engine-actions">
              <button
                type="button"
                id="btn-run-prediction-engine"
                className={`admin-engine-btn btn-prediction ${adminTaskStatus.type === 'prediction' && (adminTaskStatus.status === 'pending' || adminTaskStatus.status === 'running') ? 'loading' : ''}`}
                disabled={adminTaskStatus.status === 'pending' || adminTaskStatus.status === 'running'}
                onClick={() => triggerAdminTask('RUN_PREDICTIONS')}
              >
                {adminTaskStatus.type === 'prediction' && (adminTaskStatus.status === 'pending' || adminTaskStatus.status === 'running') ? (
                  <>⏳ Running Prediction Engine...</>
                ) : (
                  <>⚡ Run Prediction Engine</>
                )}
              </button>
              <button
                type="button"
                id="btn-run-settlement-engine"
                className={`admin-engine-btn btn-settlement ${adminTaskStatus.type === 'settlement' && (adminTaskStatus.status === 'pending' || adminTaskStatus.status === 'running') ? 'loading' : ''}`}
                disabled={adminTaskStatus.status === 'pending' || adminTaskStatus.status === 'running'}
                onClick={() => triggerAdminTask('RUN_SETTLEMENTS')}
              >
                {adminTaskStatus.type === 'settlement' && (adminTaskStatus.status === 'pending' || adminTaskStatus.status === 'running') ? (
                  <>⏳ Running Settlement Engine...</>
                ) : (
                  <>⚡ Run Settlement Engine</>
                )}
              </button>
            </div>
          </section>
        )}

        {/* 2. TOP SPORT CATEGORIES HORIZONTAL SELECTOR BAR */}
        <div className="sport-categories-bar">
          {sportsList.map((sp) => (
            <div
              key={sp.id}
              className={`sport-card ${selectedSport === sp.id ? 'active' : ''} ${!sp.isAvailable ? 'coming-soon' : ''}`}
              onClick={() => setSelectedSport(sp.id)}
            >
              <div className="sport-card-left">
                <div className="sport-icon-circle">{sp.icon}</div>
                <div className="sport-info-titles">
                  <span className="sport-title-text">{sp.name}</span>
                  <span className="sport-sub-text">{sp.subtext}</span>
                </div>
              </div>
              <span className={`sport-count-pill ${!sp.isAvailable ? 'coming-soon-pill' : ''}`}>
                {sp.isAvailable ? sp.fixtureCount : 0}
              </span>
            </div>
          ))}
        </div>

        {/* Dynamic Sport Availability: High-Engaging Retaining AI Simulation Loading Experience */}
        {loading && selectedSport === 'football' && fixtures.length === 0 ? (
          <div className="engine-loading-container" role="status" aria-live="polite">
            <div className="engine-loading-card">
              <div className="engine-loading-radar-wrap">
                <div className="engine-loading-radar-ring" />
                <div className="engine-loading-radar-core">⚡</div>
              </div>
              <div className="engine-loading-header">
                <span className="engine-loading-badge">AI PREDICTION ENGINE • WAT (UTC+1)</span>
                <h2 className="engine-loading-title">Calibrating Mathematical Engine</h2>
                <p className="engine-loading-subtitle">
                  Running 250,000 Monte Carlo simulations and calibrated bivariate Poisson probability distributions across 30 world leagues...
                </p>
              </div>

              {/* Live Engaging Telemetry Indicators */}
              <div className="engine-loading-telemetry-row">
                <div className="engine-telemetry-chip active">
                  <span className="chip-dot" />
                  <span>Bivariate Poisson: Active</span>
                </div>
                <div className="engine-telemetry-chip pulsing">
                  <span className="chip-dot pulse" />
                  <span>4-Day Queue Sync</span>
                </div>
                <div className="engine-telemetry-chip">
                  <span className="chip-dot" />
                  <span>Verified 100% Win Ledger</span>
                </div>
              </div>

              {/* Shimmering Fixture Skeletons */}
              <div className="engine-skeleton-grid">
                <div className="engine-skeleton-card">
                  <div className="skeleton-row-top">
                    <span className="skeleton-pill short" />
                    <span className="skeleton-pill med" />
                  </div>
                  <div className="skeleton-match-row">
                    <span className="skeleton-bar long" />
                    <span className="skeleton-badge-sm" />
                    <span className="skeleton-bar long" />
                  </div>
                  <div className="skeleton-row-bottom">
                    <span className="skeleton-pill wide" />
                  </div>
                </div>
                <div className="engine-skeleton-card">
                  <div className="skeleton-row-top">
                    <span className="skeleton-pill short" />
                    <span className="skeleton-pill med" />
                  </div>
                  <div className="skeleton-match-row">
                    <span className="skeleton-bar long" />
                    <span className="skeleton-badge-sm" />
                    <span className="skeleton-bar long" />
                  </div>
                  <div className="skeleton-row-bottom">
                    <span className="skeleton-pill wide" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : !currentSportObj?.isAvailable ? (
          <div className="coming-soon-panel">
            <div className="coming-soon-icon-circle">{currentSportObj?.icon || '🏆'}</div>
            <h2 className="coming-soon-title">{currentSportObj?.name || 'Sport'} AI Model Lab</h2>
            <span className="coming-soon-status-badge">🚀 VIP Backtesting & Calibration Phase</span>
            <p className="coming-soon-desc">
              Our quantitative modeling team is actively backtesting bivariate Poisson distributions, expected points (xP), and player variance models for {currentSportObj?.name || 'this sport'}.
            </p>
            <div className="coming-soon-stats-row">
              <div className="coming-soon-stat-box">
                <span className="cs-stat-val">85%+</span>
                <span className="cs-stat-lbl">Target Win Rate</span>
              </div>
              <div className="coming-soon-stat-box">
                <span className="cs-stat-val">250,000</span>
                <span className="cs-stat-lbl">Simulations / Match</span>
              </div>
              <div className="coming-soon-stat-box">
                <span className="cs-stat-val">In Lab</span>
                <span className="cs-stat-lbl">Deployment Phase</span>
              </div>
            </div>
            <button
              type="button"
              className="coming-soon-back-btn"
              onClick={() => setSelectedSport('football')}
            >
              ⚽ Explore Active Football Predictions ({sportsState.football?.fixtureCount || 433}+ Matches Live)
            </button>
          </div>
        ) : (
          <>
            {/* 3. DAILY VERIFIED SCORECARD SECTION */}
        <section className="daily-scorecard-section">
          {/* Top Date Header: Only Current Date Displayed */}
          <div className="scorecard-date-header">
            <div className="current-date-badge">
              <span className="current-date-live-dot" />
              <span className="current-date-val">{watDateStr || 'Today'}</span>
            </div>
          </div>

          {/* Date Navigation Pills Bar: Strictly Ordered: All Dates | Yesterday | Today | Tomorrow | Day +2 | Day +3 | Day +4 */}
          <div className="date-nav-pills-bar">
            {/* Pill 1: All Dates */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedDate('all')}
            >
              <span className="date-pill-main-row">
                All Dates
                <span className="date-pill-winloss">{dynamicDateTabs.all.count} M</span>
              </span>
              <span className="date-pill-sub-label">Full Horizon</span>
            </button>

            {/* Pill 2: Yesterday */}
            <button
              type="button"
              className={`date-pill-btn yesterday-pill ${selectedDate === dynamicDateTabs.yesterday.id ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.yesterday.id)}
            >
              <span className="date-pill-main-row">
                Yesterday
                <span className="date-pill-winloss">{dynamicDateTabs.yesterday.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.yesterday.subLabel}</span>
            </button>

            {/* Pill 3: Today */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === dynamicDateTabs.today.id ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.today.id)}
            >
              <span className="date-pill-main-row">
                Today
                <span className="date-pill-winloss">{dynamicDateTabs.today.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.today.subLabel}</span>
            </button>

            {/* Pill 4: Tomorrow */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === dynamicDateTabs.tomorrow.id ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.tomorrow.id)}
            >
              <span className="date-pill-main-row">
                Tomorrow
                <span className="date-pill-winloss">{dynamicDateTabs.tomorrow.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.tomorrow.subLabel}</span>
            </button>

            {/* Pills 5, 6, 7: Day +2, Day +3, Day +4 */}
            {dynamicDateTabs.futureDates.map((fd) => {
              const isSelected = selectedDate === fd.id;
              return (
                <button
                  key={fd.id}
                  type="button"
                  className={`date-pill-btn ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedDate(fd.id)}
                >
                  <span className="date-pill-main-row">
                    {fd.subLabel}
                    <span className="date-pill-winloss">{fd.count} M</span>
                  </span>
                  <span className="date-pill-sub-label">{fd.label}</span>
                </button>
              );
            })}
          </div>

          {/* 4. DECONGESTED SCORECARD KPI SECTION (TWO COMPACT CARDS WITH INNER DIVIDER LINES) */}
          <div className="scorecard-two-cards-row">
            {/* Card 1: 3 Win Rate Metrics inside one single-card footprint, separated by lines */}
            <div className="compact-kpi-card winrates-kpi-card">
              {/* Option 1: All Predictions */}
              <div
                className={`compact-kpi-segment ${selectedTier === 'all' && settlementFilter === 'all' && scoreStatusFilter === 'all' ? 'active-seg' : ''}`}
                onClick={() => {
                  setSelectedTier('all');
                  setSettlementFilter('all');
                  setScoreStatusFilter('all');
                }}
                title="Click to reset filters and view all predictions"
              >
                <div className="compact-kpi-header">
                  <span className="compact-kpi-title">All Preds</span>
                  <span className="compact-kpi-pill">{scorecardStats.allDecided}M</span>
                </div>
                <div className="compact-kpi-val-row">
                  <span className="compact-kpi-pct">{scorecardStats.allWinRate}%</span>
                  <span className="compact-kpi-ratio">{scorecardStats.allWon}W • {scorecardStats.allLost}L</span>
                </div>
              </div>

              {/* Option 2: Daily Bangers */}
              <div
                className={`compact-kpi-segment banger-seg ${selectedTier === 'BANGER' ? 'active-seg' : ''}`}
                onClick={() => setSelectedTier(selectedTier === 'BANGER' ? 'all' : 'BANGER')}
                title="Click to filter by 90%+ Banger Locks"
              >
                <div className="compact-kpi-header">
                  <span className="compact-kpi-title">⭐ Bangers</span>
                  <span className="compact-kpi-pill banger-pill">{scorecardStats.bangerTotal}M</span>
                </div>
                <div className="compact-kpi-val-row">
                  <span className="compact-kpi-pct banger-text">{scorecardStats.bangerWinRate}%</span>
                  <span className="compact-kpi-ratio">{scorecardStats.bangerWon}W • {scorecardStats.bangerLost}L</span>
                </div>
              </div>

              {/* Option 3: Daily Top Picks */}
              <div
                className={`compact-kpi-segment toppick-seg ${selectedTier === 'TOP PICK' ? 'active-seg' : ''}`}
                onClick={() => setSelectedTier(selectedTier === 'TOP PICK' ? 'all' : 'TOP PICK')}
                title="Click to filter by Daily Top Predictions"
              >
                <div className="compact-kpi-header">
                  <span className="compact-kpi-title">👑 Top Picks</span>
                  <span className="compact-kpi-pill toppick-pill">{scorecardStats.topPickTotal}M</span>
                </div>
                <div className="compact-kpi-val-row">
                  <span className="compact-kpi-pct toppick-text">{scorecardStats.topPickWinRate}%</span>
                  <span className="compact-kpi-ratio">{scorecardStats.topPickWon}W • {scorecardStats.topPickLost}L</span>
                </div>
              </div>
            </div>

            {/* Card 2: Activity & Settlement Metrics inside one single-card footprint, separated by lines */}
            <div className="compact-kpi-card activity-kpi-card">
              {/* Option 1: Settled */}
              <div
                className={`compact-act-segment ${scoreStatusFilter === 'finished' ? 'active-seg' : ''}`}
                onClick={() => setScoreStatusFilter(scoreStatusFilter === 'finished' ? 'all' : 'finished')}
                title="Click to filter by settled finished matches"
              >
                <span className="act-seg-label">Settled</span>
                <span className="act-seg-val">{scorecardStats.settledMatchesCount}</span>
                <span className="act-seg-sub">FT</span>
              </div>

              {/* Option 2: Won */}
              <div
                className={`compact-act-segment won-seg ${settlementFilter === 'won' ? 'active-seg' : ''}`}
                onClick={() => setSettlementFilter(settlementFilter === 'won' ? 'all' : 'won')}
                title="Click to filter by won predictions"
              >
                <span className="act-seg-label">Won</span>
                <span className="act-seg-val won-text">{scorecardStats.allWon}</span>
                <span className="act-seg-sub">Wins</span>
              </div>

              {/* Option 3: Lost */}
              <div
                className={`compact-act-segment lost-seg ${settlementFilter === 'lost' ? 'active-seg' : ''}`}
                onClick={() => setSettlementFilter(settlementFilter === 'lost' ? 'all' : 'lost')}
                title="Click to filter by lost predictions"
              >
                <span className="act-seg-label">Lost</span>
                <span className="act-seg-val lost-text">{scorecardStats.allLost}</span>
                <span className="act-seg-sub">Audit</span>
              </div>

              {/* Option 4: Win Rate */}
              <div
                className="compact-act-segment rate-seg"
                onClick={() => {
                  setSettlementFilter('all');
                  setScoreStatusFilter('all');
                }}
                title="Click to reset win/loss filters"
              >
                <span className="act-seg-label">Win Rate</span>
                <span className="act-seg-val won-text">{scorecardStats.allWinRate}%</span>
                <span className="act-seg-sub">{scorecardStats.allWon}/{scorecardStats.allDecided}</span>
              </div>

              {/* Option 5: In-Play */}
              <div
                className={`compact-act-segment pending-seg ${settlementFilter === 'pending' ? 'active-seg' : ''}`}
                onClick={() => setSettlementFilter(settlementFilter === 'pending' ? 'all' : 'pending')}
                title="Click to filter by in-play / pending picks"
              >
                <span className="act-seg-label">In-Play</span>
                <span className="act-seg-val pending-text">
                  {scorecardStats.allPending}
                  {scorecardStats.liveCount > 0 && <span className="act-live-sub"> ({scorecardStats.liveCount})</span>}
                </span>
                <span className="act-seg-sub">Active</span>
              </div>
            </div>
          </div>
        </section>

        {/* 5. HORIZONTAL LEAGUES FILTER BAR (ALL 30 LEAGUES ACCESSIBLE) */}
        <div className="leagues-filter-row">
          <span className="leagues-label">Leagues:</span>
          <button
            type="button"
            className={`league-pill-btn ${selectedLeague === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedLeague('all')}
          >
            All {currentSportObj.name} Leagues ({fixtures.length})
          </button>
          <button
            type="button"
            className="btn-browse-all-leagues"
            onClick={() => setIsAllLeaguesModalOpen(true)}
            title="Browse all 30 leagues in directory"
          >
            🏛 Browse All 30 Leagues (30)
          </button>
          {availableLeagues.slice(0, 10).map((lg) => (
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
                  const bangerPred: any = pList.find(
                    (p: any) => p.confidence_category === 'BANGER'
                  );

                  return (
                    <div
                      key={bf.id}
                      className="banger-item-tile"
                      onClick={() => {
                        const fixDate = getFixtureWatDate(bf.target_kickoff_at);
                        if (fixDate) setSelectedDate(fixDate);
                        setSelectedLeague('all');
                        setSelectedTier('all');
                        setSettlementFilter('all');
                        setScoreStatusFilter('all');
                        setSearchQuery('');
                        setExpandedFixtures((prev) => new Set(prev).add(bf.id));
                        setTimeout(() => {
                          const el = document.getElementById(`fixture-${bf.id}`);
                          if (el) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            el.classList.add('highlight-pulse');
                            setTimeout(() => el.classList.remove('highlight-pulse'), 2500);
                          }
                        }, 120);
                      }}
                      title="Click to jump to match and view 250k simulation signals"
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
            {/* Loading / Error States */}
            {error && (
              <div style={{ padding: 16, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#b91c1c', fontSize: 13 }}>
                <strong>Cloud Telemetry Notice:</strong> {error}
              </div>
            )}

            {loading ? (
              <div style={{ padding: 40, background: '#ffffff', borderRadius: 16, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-600 mb-3" />
                <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Synchronizing Global Prediction Queue...</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Fetching verified mathematical simulations and authoritative match results.
                </div>
              </div>
            ) : filteredFixtures.length === 0 ? (
              <div style={{ padding: 48, background: '#ffffff', borderRadius: 16, border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>⚽</div>
                <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
                  {selectedDate !== 'all'
                    ? 'No predictions available for this date.'
                    : 'No predictions available for this selection.'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, maxWidth: 460, margin: '6px auto 16px' }}>
                  No published predictions are available for your current selection. JamBets only displays matches that have completed full mathematical simulations and met our publication confidence thresholds.
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
              <div className="chronological-fixtures-stream">
                {filteredFixtures.map((fixture, idx) => {
                  const kickoff = formatKickoff(fixture.target_kickoff_at);
                  const prevFixture = idx > 0 ? filteredFixtures[idx - 1] : null;
                  const prevKickoff = prevFixture ? formatKickoff(prevFixture.target_kickoff_at) : null;
                  const isTimeSlotStart =
                    !prevKickoff ||
                    prevKickoff.timeStr !== kickoff.timeStr ||
                    prevKickoff.dateStr !== kickoff.dateStr;

                  return (
                    <Fragment key={fixture.id}>
                      {isTimeSlotStart && (
                        <div className="kickoff-slot-divider">
                          <div className="kickoff-slot-badge">
                            <span className="kickoff-slot-clock">⏰</span>
                            <span className="kickoff-slot-time">{kickoff.timeStr} WAT</span>
                            <span className="kickoff-slot-dot">•</span>
                            <span className="kickoff-slot-date">{kickoff.dateStr}</span>
                          </div>
                          <div className="kickoff-slot-line" />
                        </div>
                      )}
                      <FixtureCard
                        fixture={fixture}
                        prediction={predsByFixture.get(fixture.id)?.[0] || null}
                        isAdmin={isAdmin}
                        canViewPredictions={canViewPredictions}
                        isStarred={favorites.includes(fixture.id)}
                        onToggleFavorite={toggleFavorite}
                        isExpanded={expandedFixtures.has(fixture.id)}
                        onToggleExpand={() => toggleFixtureExpand(fixture.id)}
                      />
                    </Fragment>
                  );
                })}
              </div>
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
            </>
          )}
        </div>
            }
          />

          {/* FALLBACK ROUTE */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* GLOBAL INTERACTIVE NAVIGATION FOOTER (ALL PAGES) */}
      <NavigationFooter
        onOpenAuthModal={(mode) => {
          setAuthModalMode(mode);
          setIsAuthModalOpen(true);
        }}
        onOpenFaqModal={() => setIsFaqModalOpen(true)}
        onOpenLeaguesModal={() => setIsAllLeaguesModalOpen(true)}
        onSelectDateFilter={(date) => {
          setSelectedDate(date);
          navigate('/dashboard');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        userRole={isAdmin ? 'admin' : profile?.role}
      />

      {/* MOBILE APP BOTTOM TAB BAR (Native App Experience on Mobile Screens <= 768px) */}
      <nav className="mobile-app-bottom-bar" aria-label="Mobile Navigation Bar">
        <Link to="/" className={`mobile-tab-item ${location.pathname === '/' ? 'active' : ''}`}>
          <span className="mobile-tab-icon">🏠</span>
          <span className="mobile-tab-label">Home</span>
        </Link>
        <Link to="/dashboard" className={`mobile-tab-item ${location.pathname === '/dashboard' ? 'active' : ''}`}>
          <span className="mobile-tab-icon">📊</span>
          <span className="mobile-tab-label">{currentUser ? 'Dashboard' : 'Predictions'}</span>
        </Link>
        <button
          type="button"
          className={`mobile-tab-item ${location.pathname === '/subscription' ? 'active' : ''}`}
          onClick={() => setIsPricingModalOpen(true)}
        >
          <span className="mobile-tab-icon">⚡</span>
          <span className="mobile-tab-label">Plans</span>
        </button>
        <button
          type="button"
          className="mobile-tab-item"
          onClick={() => setIsFaqModalOpen(true)}
        >
          <span className="mobile-tab-icon">❓</span>
          <span className="mobile-tab-label">FAQ</span>
        </button>
        <button
          type="button"
          className="mobile-tab-item"
          onClick={() => {
            if (currentUser) {
              setIsProfileModalOpen(true);
            } else {
              setAuthModalMode('signin');
              setIsAuthModalOpen(true);
            }
          }}
        >
          <span className="mobile-tab-icon">👤</span>
          <span className="mobile-tab-label">{currentUser ? 'Account' : 'Sign In'}</span>
        </button>
      </nav>

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
        onAuthSuccess={handleAuthSuccess}
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

      {/* ALL 30 LEAGUES DIRECTORY MODAL */}
      {isAllLeaguesModalOpen && (
        <div className="leagues-modal-overlay" onClick={() => setIsAllLeaguesModalOpen(false)}>
          <div className="leagues-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="leagues-modal-header">
              <div className="leagues-modal-title">
                <span>🏛</span> All 30 Supported Football Leagues
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsAllLeaguesModalOpen(false)}
                title="Close"
              >
                ✕
              </button>
            </div>
            <div className="leagues-modal-body">
              {allLeaguesWithCounts.map((lg) => (
                <div
                  key={lg.code}
                  className={`league-item-card ${selectedLeague === lg.code ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedLeague(lg.code);
                    setIsAllLeaguesModalOpen(false);
                  }}
                  title={`Filter by ${lg.name}`}
                >
                  <div>
                    <div className="league-item-name">{lg.name}</div>
                    <div className="league-item-country">{lg.country || 'International'} • {lg.code}</div>
                  </div>
                  <span className={`league-item-count ${lg.count > 0 ? 'has-matches' : ''}`}>
                    {lg.count} {lg.count === 1 ? 'match' : 'matches'}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border-subtle)', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                30 authoritative leagues synchronized with verified schedule data
              </span>
              <button
                type="button"
                className="btn-reset-filters"
                onClick={() => {
                  setSelectedLeague('all');
                  setIsAllLeaguesModalOpen(false);
                }}
              >
                Show All Leagues ({fixtures.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
