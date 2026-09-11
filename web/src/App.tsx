import { useState, useEffect, useMemo, Fragment } from 'react';
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
import { AnalyticsView } from './components/AnalyticsView';
import { AdminView } from './components/AdminView';
import { PricingModal } from './components/PricingModal';
import { FaqModal } from './components/FaqModal';
import { NavigationFooter } from './components/NavigationFooter';
import { FixtureCard, formatPredictionOutcome } from './components/FixtureCard';
import { LandingPage } from './pages/Landing';
import { SubscriptionPage } from './pages/Subscription';

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

  // Sports Category Selector with Cloud Supabase Dynamic Availability
  const [selectedSport, setSelectedSport] = useState<string>('football');
  const [sportsState, setSportsState] = useState<Record<string, SportAvailability>>({
    football: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
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
      if (window.location.hash === '#analytics') navigate('/analytics');
      else if (window.location.hash === '#admin') navigate('/admin');
      else if (window.location.hash === '#fixtures') navigate('/dashboard/predictions');
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

    const { data: authListener } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
    try {
      const { data } = await supabase.auth.getUser();
      if (data?.user) {
        const { data: userRec } = await supabase
          .from('users')
          .select('role')
          .eq('id', data.user.id)
          .single();

        const role = userRec?.role || 'free';
        if (role === 'standard' || role === 'bigbang' || role === 'admin') {
          navigate('/dashboard/predictions');
        } else {
          navigate('/subscription');
        }
      }
    } catch {
      navigate('/subscription');
    }
  };

  // Authoritative Cloud Supabase Query
  const fetchCloudData = async () => {
    setLoading(true);
    setError(null);
    const start = performance.now();
    try {
      // Authoritative Cloud Supabase Query
      // STRICT NON-NEGOTIABLE RULE: CLOUD SUPABASE -> VALID PREDICTION -> UI
      // 1. Prediction model successfully produced the prediction
      // 2. Exactly/at least 250,000 valid simulations were completed
      // 3. Prediction is successfully published in Cloud Supabase (publication_status = 'published')
      // 4. Fixture is strictly derived from the authoritative prediction record
      const predictionsQuery = supabase
        .from('football_predictions')
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
        .gte('simulations_count', 250000)
        .order('target_kickoff_at', { ascending: true })
        .limit(2000);

      const simQuery = supabase
        .from('football_simulations')
        .select('*')
        .eq('status', 'completed')
        .order('created_at', { ascending: false });

      const leagueQuery = supabase
        .from('football_leagues')
        .select('*')
        .order('name', { ascending: true });

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

      const isUserAdmin =
        isAdmin ||
        currentUser?.user_metadata?.role === 'admin' ||
        (currentUser as any)?.app_metadata?.role === 'admin' ||
        profile?.role === 'admin' ||
        currentUser?.email?.toLowerCase() === 'chibzymart@gmail.com' ||
        currentUser?.email?.toLowerCase() === 'whizzchibz@gmail.com' ||
        currentUser?.email?.toLowerCase() === 'chibuezeamuchie@gmail.com';

      const predOrTeaserQuery = isUserAdmin
        ? supabase.from('football_predictions').select('*').limit(2000)
        : supabase.from('football_predictions_paywall').select('*').eq('publication_status', 'published').limit(2000);

      // Dynamically verify other candidate sports against Cloud Supabase
      const otherCandidateSports = ['american_football', 'basketball', 'tennis', 'cricket'];
      const otherSportsPromises = otherCandidateSports.map(async (sp) => {
        try {
          const { count, error: cErr } = await supabase
            .from(`${sp}_fixtures`)
            .select('*', { count: 'exact', head: true });
          const hasData = !cErr && typeof count === 'number' && count > 0;
          return {
            sport: sp,
            isAvailable: hasData,
            fixtureCount: hasData ? count : 0,
            leagueCount: 0
          };
        } catch {
          return {
            sport: sp,
            isAvailable: false,
            fixtureCount: 0,
            leagueCount: 0
          };
        }
      });

      const [
        predictionsRes,
        _simRes,
        leagueRes,
        _jobRes,
        _settleJobRes,
        predOrTeaserRes,
        ...otherSportsResults
      ] = await Promise.all([
        predictionsQuery,
        simQuery,
        leagueQuery,
        jobQuery,
        settleJobQuery,
        predOrTeaserQuery,
        ...otherSportsPromises
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

        // Verify valid prediction probability, prediction outcome, and confidence category
        if (typeof item.probability !== 'number' || item.probability <= 0) return;
        if (!item.prediction || !item.confidence_category) return;

        embeddedPreds.push({
          id: item.id,
          fixture_id: f.id,
          prediction: item.prediction,
          market: item.market,
          probability: item.probability,
          confidence_category: item.confidence_category,
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
          target_kickoff_at: item.target_kickoff_at || f.target_kickoff_at
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
      const separatePreds = (predOrTeaserRes.data || []) as FootballPrediction[];
      const allPredsMap = new Map<string, FootballPrediction>();
      embeddedPreds.forEach((p) => allPredsMap.set(p.id, p));
      // Only include paywall records for fixtures that exist in the authoritative fixture set
      separatePreds.forEach((p) => {
        if (fixtureMap.has(p.fixture_id)) {
          allPredsMap.set(p.id, p);
        }
      });
      const combinedPredictions = Array.from(allPredsMap.values());

      setFixtures(returnedFixtures);
      setLeaguesList(returnedLeagues);
      setPredictions(combinedPredictions);

      // Update dynamic sports state based exclusively on Cloud Supabase results
      const nextSportsState: Record<string, SportAvailability> = {
        football: {
          isAvailable: returnedFixtures.length > 0,
          fixtureCount: returnedFixtures.length,
          leagueCount: returnedLeagues.length
        }
      };

      otherSportsResults.forEach((r) => {
        nextSportsState[r.sport] = {
          isAvailable: r.isAvailable,
          fixtureCount: r.fixtureCount,
          leagueCount: r.leagueCount
        };
      });

      setSportsState(nextSportsState);
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

  const formatWatDateDisplay = (dateStr: string) => {
    try {
      const [year, month, day] = dateStr.split('-').map(Number);
      const d = new Date(year, month - 1, day, 12, 0, 0);
      return d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
      });
    } catch {
      return dateStr;
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
      isAvailable: sportsState.football?.isAvailable ?? false,
      fixtureCount: sportsState.football?.fixtureCount ?? 0,
      leagueCount: sportsState.football?.leagueCount ?? 0,
      statusLabel: sportsState.football?.isAvailable ? 'Available' : 'Coming Soon',
      subtext: sportsState.football?.isAvailable
        ? `${availableLeagues.length} Available League${availableLeagues.length === 1 ? '' : 's'}`
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
      {/* 0. PINNED UNIVERSAL REGULATORY BANNER (ALL PAGES) */}
      <aside className="regulatory-top-banner" role="alert" aria-label="Strict Regulatory Notice">
        <div className="regulatory-top-banner-inner">
          <span className="regulatory-top-icon" aria-hidden="true">⚠️</span>
          <p className="regulatory-top-text">
            <strong>STRICT REGULATORY NOTICE:</strong> Predictions are probabilistic estimates derived from mathematical simulations for informational purposes only. They are not guarantees of outcomes, and JamBets does not place bets on anyone's behalf. Sports predictive modeling entails variance and uncertainty; please make decisions responsibly. JamBets will not take responsibility for any financial losses. This is STRICTLY FOR EDUCATIONAL purposes only and NOT FINANCIAL OR INVESTMENT ADVICE.
          </p>
        </div>
      </aside>

      {/* 1. TOP HEADER BAR */}
      <header className="site-header">
        <div className="site-header-inner">
          <Link to="/" className="header-brand" onClick={() => resetAllFilters()}>
            <div className="brand-icon-sq">J</div>
            <div>
              <span className="brand-text-name">JamBets</span>
              <span className="brand-text-tag">Analytics</span>
            </div>
          </Link>

          <div className="header-center-links">
            <Link
              to="/"
              className={`nav-link-btn ${location.pathname === '/' ? 'active' : ''}`}
            >
              Overview
            </Link>
            <Link
              to="/dashboard/predictions"
              className={`nav-link-btn ${location.pathname.startsWith('/dashboard') ? 'active' : ''}`}
            >
              Predictions
            </Link>
            <Link
              to="/subscription"
              className={`nav-link-btn ${location.pathname === '/subscription' ? 'active' : ''}`}
            >
              Pricing & Plans <span className="pricing-flat-badge">₦5,000/mo</span>
            </Link>
            <Link
              to="/analytics"
              className={`nav-link-btn ${location.pathname === '/analytics' ? 'active' : ''}`}
            >
              Analytics & Audit
            </Link>
            <button className="nav-link-btn" onClick={() => setIsFaqModalOpen(true)}>
              FAQ
            </button>
          </div>

          <div className="header-right-actions">
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
              />
            }
          />

          {/* ROUTE 2: NGN SUBSCRIPTION PAGE */}
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

          {/* ROUTE 3: ANALYTICS & AUDIT */}
          <Route
            path="/analytics"
            element={
              <AnalyticsView onBackToFixtures={() => navigate('/dashboard/predictions')} />
            }
          />

          {/* ROUTE 4: ADMIN COMMAND DECK (STRICTLY GATED) */}
          <Route
            path="/admin"
            element={
              isAdmin ? (
                <AdminView
                  currentUserProfile={profile}
                  onBackToFixtures={() => navigate('/dashboard/predictions')}
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
            path="/dashboard/predictions"
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

        {/* Dynamic Sport Availability: Coming Soon UX for unavailable sports */}
        {!currentSportObj?.isAvailable ? (
          <div className="coming-soon-panel">
            <div className="coming-soon-icon-circle">{currentSportObj?.icon || '🏆'}</div>
            <h2 className="coming-soon-title">{currentSportObj?.name || 'Sport'}</h2>
            <span className="coming-soon-status-badge">Coming Soon</span>
            <p className="coming-soon-desc">
              No predictions are currently available for this sport.
            </p>
            <button
              type="button"
              className="coming-soon-back-btn"
              onClick={() => setSelectedSport('football')}
            >
              ← Back to Football Predictions
            </button>
          </div>
        ) : (
          <>
            {/* 3. DAILY VERIFIED SCORECARD SECTION */}
        <section className="daily-scorecard-section">
          <div className="scorecard-header-row">
            <div>
              <div className="scorecard-meta-tags">
                <span className="tag-scorecard-verified">● Daily Verified Scorecard</span>
                <span className="tag-scorecard-sport">● {currentSportObj.name}</span>
                {watDateStr && <span className="tag-scorecard-sport">● WAT Live Date: {watDateStr}</span>}
              </div>
              <h2 className="scorecard-title-main">
                {selectedDate === 'all'
                  ? `All Queue Dates Performance (${dynamicDateTabs.all.count} Matches)`
                  : selectedDate === dynamicDateTabs.yesterday.id
                  ? `Yesterday's Verified Performance (${dynamicDateTabs.yesterday.subLabel})`
                  : selectedDate === dynamicDateTabs.today.id
                  ? `Today's Verified Performance (${dynamicDateTabs.today.subLabel})`
                  : selectedDate === dynamicDateTabs.tomorrow.id
                  ? `Tomorrow's Upcoming Predictions (${dynamicDateTabs.tomorrow.subLabel})`
                  : `${formatWatDateDisplay(selectedDate)} Performance`}
              </h2>
              <p className="scorecard-subtitle-main">
                Real-time livescore settlements and calibrated bivariate Poisson predictions for{' '}
                {selectedDate === 'all'
                  ? 'all dates'
                  : selectedDate === dynamicDateTabs.yesterday.id
                  ? `Yesterday (${dynamicDateTabs.yesterday.subLabel})`
                  : selectedDate === dynamicDateTabs.today.id
                  ? `Today (${dynamicDateTabs.today.subLabel})`
                  : selectedDate === dynamicDateTabs.tomorrow.id
                  ? `Tomorrow (${dynamicDateTabs.tomorrow.subLabel})`
                  : formatWatDateDisplay(selectedDate)}
              </p>
            </div>

            <div className="choose-date-selector">
              <span className="choose-date-label">Choose Date:</span>
              <select
                className="choose-date-select"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              >
                <option value="all">All Dates ({dynamicDateTabs.all.count} matches)</option>
                <option value={dynamicDateTabs.yesterday.id}>
                  Yesterday — {dynamicDateTabs.yesterday.subLabel} ({dynamicDateTabs.yesterday.count} matches)
                </option>
                <option value={dynamicDateTabs.today.id}>
                  Today — {dynamicDateTabs.today.subLabel} ({dynamicDateTabs.today.count} matches) [CURRENT]
                </option>
                <option value={dynamicDateTabs.tomorrow.id}>
                  Tomorrow — {dynamicDateTabs.tomorrow.subLabel} ({dynamicDateTabs.tomorrow.count} matches)
                </option>
                {dynamicDateTabs.futureDates.map((fd) => (
                  <option key={fd.id} value={fd.id}>
                    {fd.subLabel} — {fd.label} ({fd.count} matches)
                  </option>
                ))}
              </select>
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

          {/* 4. SCORECARD KPI CARDS (2 ROWS) - ALL INTERACTIVELY CLICKABLE */}
          {/* Row 1: 3 Hero KPI Cards */}
          <div className="hero-kpi-grid">
            {/* Card 1: All Predictions Win Rate (Dark Navy) */}
            <div
              className={`hero-kpi-dark-card hero-kpi-clickable ${selectedTier === 'all' && settlementFilter === 'all' && scoreStatusFilter === 'all' ? 'active-filter' : ''}`}
              onClick={() => {
                setSelectedTier('all');
                setSettlementFilter('all');
                setScoreStatusFilter('all');
              }}
              title="Click to reset filters and view all predictions"
            >
              <div className="hero-kpi-header">
                <span className="hero-kpi-title">All Predictions Win Rate</span>
                <span className="hero-kpi-pill-badge">{scorecardStats.allDecided} Matches</span>
              </div>
              <div className="hero-kpi-value-row">
                {scorecardStats.allWinRate}% Win. {scorecardStats.allWon}/{scorecardStats.allDecided}.
              </div>
              <div className="hero-kpi-sub-stats">
                {scorecardStats.allWon} Won • {scorecardStats.allLost} Lost • {scorecardStats.allPending} Pending
              </div>
            </div>

            {/* Card 2: Daily Banger Win Rate */}
            <div
              className={`hero-kpi-banger-card hero-kpi-clickable ${selectedTier === 'BANGER' ? 'active-filter' : ''}`}
              onClick={() => setSelectedTier(selectedTier === 'BANGER' ? 'all' : 'BANGER')}
              title="Click to filter by 90%+ Banger Locks"
            >
              <div className="hero-kpi-header">
                <span className="hero-kpi-title">⭐ Daily Banger Win Rate</span>
                <span className="hero-kpi-pill-badge">{scorecardStats.bangerTotal} Bangers</span>
              </div>
              <div className="hero-kpi-value-row">
                {scorecardStats.bangerWinRate}% Win. {scorecardStats.bangerWon}/{scorecardStats.bangerDecided}.
              </div>
              <div className="hero-kpi-sub-stats">
                {scorecardStats.bangerWon} Won • {scorecardStats.bangerLost} Lost • {scorecardStats.bangerPending} Pending
              </div>
            </div>

            {/* Card 3: Daily Top Pick Win Rate */}
            <div
              className={`hero-kpi-toppick-card hero-kpi-clickable ${selectedTier === 'TOP PICK' ? 'active-filter' : ''}`}
              onClick={() => setSelectedTier(selectedTier === 'TOP PICK' ? 'all' : 'TOP PICK')}
              title="Click to filter by Daily Top Picks"
            >
              <div className="hero-kpi-header">
                <span className="hero-kpi-title">👑 Daily Top Pick Win Rate</span>
                <span className="hero-kpi-pill-badge">{scorecardStats.topPickTotal} Top Picks</span>
              </div>
              <div className="hero-kpi-value-row">
                {scorecardStats.topPickWinRate}% Win. {scorecardStats.topPickWon}/{scorecardStats.topPickDecided}.
              </div>
              <div className="hero-kpi-sub-stats">
                {scorecardStats.topPickWon} Won • {scorecardStats.topPickLost} Lost • {scorecardStats.topPickPending} Pending
              </div>
            </div>
          </div>

          {/* Row 2: 5 Status Sub-Tiles - ALL INTERACTIVELY CLICKABLE */}
          <div className="status-tiles-grid">
            <div
              className={`status-tile status-tile-clickable ${scoreStatusFilter === 'finished' ? 'active-filter' : ''}`}
              onClick={() => setScoreStatusFilter(scoreStatusFilter === 'finished' ? 'all' : 'finished')}
              title="Click to filter by settled finished matches"
            >
              <div className="status-tile-label">Settled Matches</div>
              <div className="status-tile-val">{scorecardStats.settledMatchesCount}</div>
              <div className="status-tile-sub">Verified Full Time</div>
            </div>

            <div
              className={`status-tile won status-tile-clickable ${settlementFilter === 'won' ? 'active-filter' : ''}`}
              onClick={() => setSettlementFilter(settlementFilter === 'won' ? 'all' : 'won')}
              title="Click to filter by won predictions"
            >
              <div className="status-tile-label">Won Picks</div>
              <div className="status-tile-val">{scorecardStats.allWon}</div>
              <div className="status-tile-sub">Verified Wins</div>
            </div>

            <div
              className={`status-tile lost status-tile-clickable ${settlementFilter === 'lost' ? 'active-filter' : ''}`}
              onClick={() => setSettlementFilter(settlementFilter === 'lost' ? 'all' : 'lost')}
              title="Click to filter by lost predictions"
            >
              <div className="status-tile-label">Lost Picks</div>
              <div className="status-tile-val">{scorecardStats.allLost}</div>
              <div className="status-tile-sub">Transparent Audit Trail</div>
            </div>

            <div
              className="status-tile rate status-tile-clickable"
              onClick={() => {
                setSettlementFilter('all');
                setScoreStatusFilter('all');
              }}
              title="Click to reset win/loss filters"
            >
              <div className="status-tile-label">Day Win Rate</div>
              <div className="status-tile-val">{scorecardStats.allWinRate}%</div>
              <div className="status-tile-sub">{scorecardStats.allWon} of {scorecardStats.allDecided} won</div>
            </div>

            <div
              className={`status-tile pending status-tile-clickable ${settlementFilter === 'pending' ? 'active-filter' : ''}`}
              onClick={() => setSettlementFilter(settlementFilter === 'pending' ? 'all' : 'pending')}
              title="Click to filter by pending / in-play picks"
            >
              <div className="status-tile-label">In-Play / Pending</div>
              <div className="status-tile-val">{scorecardStats.allPending} ({scorecardStats.liveCount} Live)</div>
              <div className="status-tile-sub">Auto-settles every 15 mins</div>
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

        {/* 6. MULTI-FILTER & ACTION BAR */}
        <div className="actions-filter-bar">
          <div className="filter-dropdowns-row">
            <span className="filter-prefix-label">⚙ Filters:</span>

            {/* League Dropdown with all 30 leagues */}
            <select
              className="filter-select-input"
              value={selectedLeague}
              onChange={(e) => setSelectedLeague(e.target.value)}
            >
              <option value="all">League: All 30 Leagues ({fixtures.length})</option>
              {allLeaguesWithCounts.map((lg) => (
                <option key={lg.code} value={lg.code}>
                  {lg.name} ({lg.count} {lg.count === 1 ? 'match' : 'matches'})
                </option>
              ))}
            </select>

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
                📅 {selectedDate === 'all'
                  ? 'All Dates'
                  : selectedDate === dynamicDateTabs.yesterday.id
                  ? `Yesterday (${dynamicDateTabs.yesterday.subLabel})`
                  : selectedDate === dynamicDateTabs.today.id
                  ? `Today (${dynamicDateTabs.today.subLabel})`
                  : selectedDate === dynamicDateTabs.tomorrow.id
                  ? `Tomorrow (${dynamicDateTabs.tomorrow.subLabel})`
                  : formatWatDateDisplay(selectedDate)}
              </span>
              <button
                type="button"
                className="btn-reset-filters"
                onClick={resetAllFilters}
              >
                🔄 Reset Filters
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
                  onClick={() => {
                    setExpandedFixtures(new Set(fixtures.map((f) => f.id)));
                  }}
                >
                  Expand All
                </button>
                <button
                  type="button"
                  className="btn-toggle-expand"
                  onClick={() => {
                    setExpandedFixtures(new Set());
                  }}
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
            {/* Stream Section Banner Header */}
            <div className="stream-section-banner">
              <div className="stream-banner-left">
                <div className="calendar-green-box">📅</div>
                <div>
                  <div className="stream-title-text">
                    <span>
                      {selectedDate === 'all'
                        ? 'All Queue Dates Fixtures'
                        : selectedDate === dynamicDateTabs.yesterday.id
                        ? `Yesterday's Fixtures (${dynamicDateTabs.yesterday.subLabel})`
                        : selectedDate === dynamicDateTabs.today.id
                        ? `Today's Fixtures (${dynamicDateTabs.today.subLabel})`
                        : selectedDate === dynamicDateTabs.tomorrow.id
                        ? `Tomorrow's Fixtures (${dynamicDateTabs.tomorrow.subLabel})`
                        : `${formatWatDateDisplay(selectedDate)} Fixtures`}
                    </span>
                    {selectedDate === dynamicDateTabs.today.id && (
                      <span className="live-today-pill">LIVE TODAY</span>
                    )}
                  </div>
                  <p className="stream-sub-text">
                    Matches scheduled & live settlement tracking strictly in West Africa Time (WAT / UTC+1)
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
          navigate('/dashboard/predictions');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        userRole={isAdmin ? 'admin' : profile?.role}
      />

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
