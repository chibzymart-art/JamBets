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
import { FixtureCard } from './components/FixtureCard';
import { FavoritesDrawer, FavoritePredictionItem } from './components/FavoritesDrawer';
import { FloatingFavoritesWidget } from './components/FloatingFavoritesWidget';
import { BotHubModal } from './components/BotHubModal';
import { CookieConsentBanner } from './components/CookieConsentBanner';
import { AdBannerSlot } from './components/AdBannerSlot';
import { initAttributionTracker } from './lib/attribution';
import { updatePageSeo } from './lib/seo';
import { LandingPage } from './pages/Landing';
import { SubscriptionPage } from './pages/Subscription';
import { PasswordRecoveryPage } from './pages/PasswordRecovery';
import { OtherMarketsPage } from './pages/OtherMarketsPage';
import { WatchlistSidebar } from './components/WatchlistSidebar';
import { LeftSidebarAd } from './components/LeftSidebarAd';
import { getDateDetailsByOffset, getPastDatesList } from './lib/dateUtils';


export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  // Authentication & Entitlement State
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  const targetPredictionsPath = currentUser ? '/dashboard' : '/predictions';
  const isPredictionsOrDashboard = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/predictions');

  // Modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'register' | 'forgot'>('signin');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isFaqModalOpen, setIsFaqModalOpen] = useState(false);
  const [isBotHubModalOpen, setIsBotHubModalOpen] = useState(false);

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


  // Remove any legacy theme attributes to guarantee permanent light mode & init attribution tracking
  useEffect(() => {
    initAttributionTracker();
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
  const [isAllLeaguesModalOpen, setIsAllLeaguesModalOpen] = useState(false);
  const [isHamburgerOpen, setIsHamburgerOpen] = useState(false);

  useEffect(() => {
    setIsHamburgerOpen(false);
    if (location.pathname === '/goals') {
      updatePageSeo({
        title: 'Over 2.5 Goals & 1st Half Specialist | Oddsbanta AI',
        description: 'Calibrated mathematical predictions for Over 2.5 and First Half Over 0.5 goals.',
      });
    } else if (location.pathname === '/subscription') {
      updatePageSeo({
        title: 'Subscription Plans & VIP Access | Oddsbanta',
        description: 'Unlock full mathematical predictions, VIP accumulator slips, and daily high-edge football signals.',
      });
    } else if (location.pathname === '/admin') {
      updatePageSeo({
        title: 'Admin Command Deck | Oddsbanta',
        description: 'Internal operations, prediction queue management, and model telemetry.',
      });
    } else {
      updatePageSeo({
        title: 'Oddsbanta — Smart Sport Analysis & Football Predictions | AI Powered',
        description: 'Authoritative football predictions, verified mathematical simulations, and AI tactical analysis.',
      });
    }
  }, [location.pathname]);

  // Multi-Filters
  const [selectedLeague, setSelectedLeague] = useState<string>('all');
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'pending' | 'won' | 'lost' | 'void'>('all');
  const [scoreStatusFilter, setScoreStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Favorites & Custom Slip Drawer State
  const [isFavoritesDrawerOpen, setIsFavoritesDrawerOpen] = useState(false);

  // Granular Favorite Prediction Items State
  const [favoriteItems, setFavoriteItems] = useState<FavoritePredictionItem[]>(() => {
    try {
      const saved = localStorage.getItem('oddsbanta_favorites_v2');
      if (saved) return JSON.parse(saved);
      return [];
    } catch {
      return [];
    }
  });

  // Fixture ID Favorites State (Core Feed)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('jambets_favorites');
      if (saved) return JSON.parse(saved);
      return [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
      try {
        localStorage.setItem('jambets_favorites', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Expanded Fixtures Set (Accordion state)
  const [expandedFixtures, setExpandedFixtures] = useState<Set<string>>(new Set());

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

  const toggleFavoriteItem = (item: FavoritePredictionItem) => {
    setFavoriteItems((prev) => {
      const exists = prev.some((f) => f.id === item.id);
      const next = exists
        ? prev.filter((f) => f.id !== item.id)
        : [...prev, item];
      try {
        localStorage.setItem('oddsbanta_favorites_v2', JSON.stringify(next));
      } catch {}
      return next;
    });
  };


  const isFavoriteItem = (fixtureId: string, market: string, pick: string) => {
    const targetId = `${fixtureId}::${market}::${pick}`;
    return favoriteItems.some((f) => f.id === targetId);
  };

  const clearAllFavorites = () => {
    setFavoriteItems([]);
    try {
      localStorage.removeItem('oddsbanta_favorites_v2');
      localStorage.removeItem('jambets_favorites');
    } catch {}
  };

  const [, setLatencyMs] = useState<number | null>(null);
  const [, setLastRefreshed] = useState<Date>(new Date());

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
          alert('This account has been deactivated (soft delete). Access to Oddsbanta is blocked.');
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
    let isMounted = true;
    const authTimeout = setTimeout(() => {
      if (isMounted) setIsAuthChecking(false);
    }, 1500);

    supabase.auth.getUser().then(({ data }) => {
      if (!isMounted) return;
      if (data?.user) {
        if (data.user.user_metadata?.status === 'disabled' || data.user.user_metadata?.is_deleted === true) {
          supabase.auth.signOut();
          setCurrentUser(null);
          setProfile(null);
          setSubscription(null);
          setEntitlement(null);
          setIsAuthChecking(false);
          return;
        }
        setCurrentUser(data.user);
        fetchUserData(data.user.id).finally(() => {
          if (isMounted) setIsAuthChecking(false);
        });
      } else {
        setCurrentUser(null);
        setProfile(null);
        setSubscription(null);
        setEntitlement(null);
        setIsAuthChecking(false);
      }
    }).catch(() => {
      if (isMounted) setIsAuthChecking(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMounted) return;
      if (session?.user) {
        if (session.user.user_metadata?.status === 'disabled' || session.user.user_metadata?.is_deleted === true) {
          await supabase.auth.signOut();
          setCurrentUser(null);
          setProfile(null);
          setSubscription(null);
          setEntitlement(null);
          setIsAuthChecking(false);
          alert('This account has been deactivated (soft delete). Access to Oddsbanta is blocked.');
          return;
        }
        setCurrentUser(session.user);
        await fetchUserData(session.user.id);
        if (isMounted) setIsAuthChecking(false);
        // Only navigate to /dashboard if user is explicitly on the root landing page '/' upon fresh sign-in
        // This guarantees that refreshing any subpage (/goals, /admin, /dashboard, etc.) never kicks user away
        if (event === 'SIGNED_IN' && window.location.pathname === '/') {
          navigate('/dashboard');
        }
      } else {
        setCurrentUser(null);
        setProfile(null);
        setSubscription(null);
        setEntitlement(null);
        if (isMounted) setIsAuthChecking(false);
      }
    });

    return () => {
      isMounted = false;
      clearTimeout(authTimeout);
      authListener.subscription.unsubscribe();
    };
  }, [navigate]);

  // Strict RBAC: Check whether active user is an administrator
  const isAdmin = useMemo(() => {
    if (!currentUser) return false;
    const email = currentUser.email?.toLowerCase().trim();
    const adminEmails = [
      'chibzymart@gmail.com',
      'whizzchibz@gmail.com',
      'chibuezec.amuchie@gmail.com',
      'chibuezeamuchie@gmail.com',
      'nnamdiamuchie@gmail.com'
    ];
    return (
      profile?.role === 'admin' ||
      currentUser.user_metadata?.role === 'admin' ||
      (currentUser as any)?.app_metadata?.role === 'admin' ||
      subscription?.tier === 'admin' ||
      entitlement?.tier === 'admin' ||
      (entitlement?.features as any)?.admin === true ||
      (email ? adminEmails.includes(email) : false)
    );
  }, [currentUser, profile, subscription, entitlement]);

  // Entitlement Permission
  const canViewPredictions = useMemo(() => {
    if (!currentUser) return false;
    if (isAdmin) return true;
    if (profile?.role === 'admin') return true;
    if (profile?.role === 'standard' || profile?.role === 'bigbang') return true;
    const subTier = subscription?.tier?.toLowerCase();
    if (subscription?.status === 'active' && subTier && ['standard', 'bigbang', 'admin', 'vip'].includes(subTier)) return true;
    if (entitlement?.can_view_predictions === true) return true;
    const entTier = entitlement?.tier?.toLowerCase();
    if (entTier && ['standard', 'bigbang', 'admin', 'vip'].includes(entTier)) return true;
    if ((entitlement?.features as any)?.vip === true || (entitlement?.features as any)?.football_predictions === true) return true;
    return false;
  }, [currentUser, isAdmin, profile, subscription, entitlement]);

  const handleAuthSuccess = async () => {
    setIsAuthModalOpen(false);
    await fetchCloudData(true);
    navigate('/dashboard');
  };

  // Redirect /dashboard?market=... to /other-markets?market=... for specialist markets
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(location.search);
      const m = searchParams.get('market');
      if (m && m !== 'general' && location.pathname.startsWith('/dashboard')) {
        navigate(`/other-markets?market=${m}`, { replace: true });
      }
    } catch {}
  }, [location.search, location.pathname, navigate]);

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
      let rawPredRecords: any[] = [];
      let returnedLeagues: LeagueRecord[] = [];

      // Edge CDN Acceleration: Query global edge cache for high-concurrency visitor traffic
      let usedEdgeCache = false;
      if (!isAdmin && !canViewPredictions && typeof window !== 'undefined') {
        try {
          const edgeRes = await fetch('/api/predictions-feed', {
            headers: { Accept: 'application/json' },
            cache: 'default'
          });
          if (edgeRes.ok) {
            const edgeData = await edgeRes.json();
            if (edgeData.success && Array.isArray(edgeData.predictions) && edgeData.predictions.length > 0) {
              rawPredRecords = edgeData.predictions;
              returnedLeagues = edgeData.leagues || [];
              usedEdgeCache = true;
            }
          }
        } catch {
          // Graceful fallback to direct Supabase PostgREST query
        }
      }

      if (!usedEdgeCache) {
        // Direct Supabase Query (Used for Admins, Paid Subscribers, or when Edge is local/unavailable)
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
            tier_required,
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
          .order('id', { ascending: true })
          .limit(2000);

        const leagueQuery = supabase
          .from('football_leagues')
          .select('id, name, code, country')
          .order('name', { ascending: true });

        const [predictionsRes, leagueRes] = await Promise.all([
          predictionsQuery,
          leagueQuery
        ]);

        if (predictionsRes.error) throw predictionsRes.error;
        rawPredRecords = predictionsRes.data || [];
        returnedLeagues = leagueRes.data || [];
      }

      const elapsed = Math.round(performance.now() - start);
      setLatencyMs(elapsed);
      const embeddedPreds: FootballPrediction[] = [];
      const fixtureMap = new Map<string, QueueFixture>();

      const userCanView = isAdmin || canViewPredictions;

      rawPredRecords.forEach((item: any) => {
        const f = item.fixture;
        if (!f) return;

        const isLocked = !userCanView && (item.is_locked === true || item.confidence_category === 'LOCKED');
        if (!isLocked) {
          if (typeof item.probability !== 'number' || item.probability <= 0) return;
          if (!item.prediction || item.prediction === 'LOCKED') return;
        }

        embeddedPreds.push({
          id: item.id,
          fixture_id: f.id,
          prediction: isLocked ? 'LOCKED' : item.prediction,
          market: item.market,
          probability: isLocked ? 0 : item.probability,
          confidence_category: isLocked ? 'LOCKED' : ((item.confidence_category && item.confidence_category !== 'LOCKED') ? item.confidence_category : 'MID_CONFIDENCE'),
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
      // Strictly earliest kickoff time first with deterministic ID tie-breaker
      returnedFixtures.sort((a, b) => {
        const timeDiff = new Date(a.target_kickoff_at).getTime() - new Date(b.target_kickoff_at).getTime();
        if (timeDiff !== 0) return timeDiff;
        return a.id.localeCompare(b.id);
      });



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
    fetchCloudData(true);
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
  const dynamicDateTabs = useMemo(() => {
    // Map fixture counts by WAT kickoff date
    const fixtureCountByDate = new Map<string, number>();
    fixtures.forEach((f) => {
      const d = getFixtureWatDate(f.target_kickoff_at);
      if (d) {
        fixtureCountByDate.set(d, (fixtureCountByDate.get(d) || 0) + 1);
      }
    });

    const yesterday = getDateDetailsByOffset(-1);
    const today = getDateDetailsByOffset(0);
    const day1 = getDateDetailsByOffset(1);
    const day2 = getDateDetailsByOffset(2);
    const day3 = getDateDetailsByOffset(3);

    // Past dates list (last 30 days plus any fixture dates before today)
    const rawPastDates = getPastDatesList(30, Array.from(fixtureCountByDate.keys()));
    const pastDates = rawPastDates.map((pd) => ({
      ...pd,
      count: fixtureCountByDate.get(pd.iso) || 0
    }));

    // Count fixtures for current date and future dates (strictly no past dates)
    let currentAndFutureCount = 0;
    fixtures.forEach((f) => {
      const d = getFixtureWatDate(f.target_kickoff_at);
      if (!d || d >= today.iso) currentAndFutureCount++;
    });

    return {
      all: {
        id: 'all',
        label: 'All Dates',
        subLabel: 'Current & Future',
        count: currentAndFutureCount
      },
      yesterday: {
        ...yesterday,
        id: yesterday.iso,
        count: fixtureCountByDate.get(yesterday.iso) || 0
      },
      today: {
        ...today,
        id: today.iso,
        count: fixtureCountByDate.get(today.iso) || 0
      },
      day1: {
        ...day1,
        id: day1.iso,
        count: fixtureCountByDate.get(day1.iso) || 0
      },
      day2: {
        ...day2,
        id: day2.iso,
        count: fixtureCountByDate.get(day2.iso) || 0
      },
      day3: {
        ...day3,
        id: day3.iso,
        count: fixtureCountByDate.get(day3.iso) || 0
      },
      pastDates,
      todayIso: today.iso,
      yesterdayIso: yesterday.iso
    };
  }, [fixtures]);

  const isPastDateSelected =
    selectedDate !== 'all' &&
    selectedDate < dynamicDateTabs.todayIso &&
    selectedDate !== dynamicDateTabs.yesterdayIso;

  const selectedPastOption = isPastDateSelected
    ? dynamicDateTabs.pastDates.find((p) => p.iso === selectedDate)
    : null;
  const selectedPastFormatted = selectedPastOption?.shortFormatted || selectedDate;

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

    let highTotal = 0;
    let highWon = 0;
    let highLost = 0;
    let highPending = 0;

    let midTotal = 0;
    let midWon = 0;
    let midLost = 0;
    let midPending = 0;

    let lowTotal = 0;
    let lowWon = 0;
    let lowLost = 0;
    let lowPending = 0;

    let antiLossTotal = 0;
    let antiLossWon = 0;
    let antiLossLost = 0;
    let antiLossPending = 0;

    const sourceList = predictions;

    // Filter predictions to only those matching current date filter if not 'all'
    // "All Dates (this will be all predictions of current date and future dates, no past dates)"
    const activeFixtureIds = new Set(
      (selectedDate === 'all'
        ? fixtures.filter((f) => {
            const fDate = getFixtureWatDate(f.target_kickoff_at);
            return !fDate || fDate >= dynamicDateTabs.todayIso;
          })
        : fixtures.filter((f) => getFixtureWatDate(f.target_kickoff_at) === selectedDate)
      ).map((f) => f.id)
    );

    sourceList.forEach((item: any) => {
      if (!activeFixtureIds.has(item.fixture_id)) return;
      let st = item.settlement_status || 'pending';
      const rawCat = (item.confidence_category || '').toUpperCase().replace(/ /g, '_');
      const isAntiLoss =
        rawCat === 'NO_SAFE_BANKER' ||
        rawCat === 'NOSAFEBANKER' ||
        item.market === 'NO_SAFE_BANKER' ||
        item.prediction === 'SKIP';

      if (st === 'won') allWon++;
      else if (st === 'lost') allLost++;
      else if (st === 'void' || st === 'voided') allVoid++;
      else allPending++;

      if (rawCat === 'BANGER') {
        bangerTotal++;
        if (st === 'won') bangerWon++;
        else if (st === 'lost') bangerLost++;
        else bangerPending++;
      } else if (rawCat === 'TOP_PICK' || rawCat === 'TOPPICK') {
        topPickTotal++;
        if (st === 'won') topPickWon++;
        else if (st === 'lost') topPickLost++;
        else topPickPending++;
      } else if (rawCat === 'HIGH_CONFIDENCE' || rawCat === 'HIGHCONFIDENCE' || rawCat === 'HIGH') {
        highTotal++;
        if (st === 'won') highWon++;
        else if (st === 'lost') highLost++;
        else highPending++;
      } else if (rawCat === 'MID_CONFIDENCE' || rawCat === 'MIDCONFIDENCE' || rawCat === 'MID') {
        midTotal++;
        if (st === 'won') midWon++;
        else if (st === 'lost') midLost++;
        else midPending++;
      } else if (rawCat === 'LOW_CONFIDENCE' || rawCat === 'LOWCONFIDENCE' || rawCat === 'LOW' || rawCat === 'RISKY') {
        lowTotal++;
        if (st === 'won') lowWon++;
        else if (st === 'lost') lowLost++;
        else lowPending++;
      } else if (isAntiLoss) {
        antiLossTotal++;
        if (st === 'won') antiLossWon++;
        else if (st === 'lost') antiLossLost++;
        else antiLossPending++;
      }
    });

    const allDecided = allWon + allLost;
    const allWinRate = allDecided > 0 ? Math.round((allWon / allDecided) * 100) : 0;

    const bangerDecided = bangerWon + bangerLost;
    const bangerWinRate = bangerDecided > 0 ? Math.round((bangerWon / bangerDecided) * 100) : 0;

    const topPickDecided = topPickWon + topPickLost;
    const topPickWinRate = topPickDecided > 0 ? Math.round((topPickWon / topPickDecided) * 100) : 0;

    const highDecided = highWon + highLost;
    const highWinRate = highDecided > 0 ? Math.round((highWon / highDecided) * 100) : 0;

    const midDecided = midWon + midLost;
    const midWinRate = midDecided > 0 ? Math.round((midWon / midDecided) * 100) : 0;

    const lowDecided = lowWon + lowLost;
    const lowWinRate = lowDecided > 0 ? Math.round((lowWon / lowDecided) * 100) : 0;

    const antiLossDecided = antiLossWon + antiLossLost;
    const antiLossWinRate = antiLossDecided > 0 ? Math.round((antiLossWon / antiLossDecided) * 100) : 0;

    const scopedFixtures = selectedDate === 'all'
      ? fixtures.filter((f) => {
          const fDate = getFixtureWatDate(f.target_kickoff_at);
          return !fDate || fDate >= dynamicDateTabs.todayIso;
        })
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
    const settledMatchesCount = scopedFixtures.filter((f) => {
      const isFinished = f.status === 'finished' || f.period === 'FT';
      const preds = predsByFixture.get(f.id) || [];
      const hasSettledPred = preds.some((p) => p.settlement_status === 'won' || p.settlement_status === 'lost' || p.settlement_status === 'void' || p.settlement_status === 'voided');
      return isFinished || hasSettledPred;
    }).length;

    return {
      allWon,
      allLost,
      allVoid,
      allPending,
      allDecided,
      allWinRate,
      allTotal: allWon + allLost + allPending,
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
      highTotal,
      highWon,
      highLost,
      highPending,
      highDecided,
      highWinRate,
      midTotal,
      midWon,
      midLost,
      midPending,
      midDecided,
      midWinRate,
      lowTotal,
      lowWon,
      lowLost,
      lowPending,
      lowDecided,
      lowWinRate,
      antiLossTotal,
      antiLossWon,
      antiLossLost,
      antiLossPending,
      antiLossDecided,
      antiLossWinRate,
      liveCount,
      settledMatchesCount
    };
  }, [fixtures, predsByFixture, canViewPredictions, selectedDate]);

  // Dynamic Tier-specific activity and settlement stats wired to Card 2
  const activeTierStats = useMemo(() => {
    switch (selectedTier) {
      case 'BANGER':
        return {
          won: scorecardStats.bangerWon,
          lost: scorecardStats.bangerLost,
          pending: scorecardStats.bangerPending,
          decided: scorecardStats.bangerDecided,
          winRate: scorecardStats.bangerWinRate,
          total: scorecardStats.bangerTotal,
          settled: scorecardStats.bangerDecided,
        };
      case 'TOP PICK':
        return {
          won: scorecardStats.topPickWon,
          lost: scorecardStats.topPickLost,
          pending: scorecardStats.topPickPending,
          decided: scorecardStats.topPickDecided,
          winRate: scorecardStats.topPickWinRate,
          total: scorecardStats.topPickTotal,
          settled: scorecardStats.topPickDecided,
        };
      case 'HIGH':
        return {
          won: scorecardStats.highWon,
          lost: scorecardStats.highLost,
          pending: scorecardStats.highPending,
          decided: scorecardStats.highDecided,
          winRate: scorecardStats.highWinRate,
          total: scorecardStats.highTotal,
          settled: scorecardStats.highDecided,
        };
      case 'MID':
        return {
          won: scorecardStats.midWon,
          lost: scorecardStats.midLost,
          pending: scorecardStats.midPending,
          decided: scorecardStats.midDecided,
          winRate: scorecardStats.midWinRate,
          total: scorecardStats.midTotal,
          settled: scorecardStats.midDecided,
        };
      case 'LOW':
        return {
          won: scorecardStats.lowWon,
          lost: scorecardStats.lowLost,
          pending: scorecardStats.lowPending,
          decided: scorecardStats.lowDecided,
          winRate: scorecardStats.lowWinRate,
          total: scorecardStats.lowTotal,
          settled: scorecardStats.lowDecided,
        };
      case 'NO_SAFE_BANKER':
        return {
          won: scorecardStats.antiLossWon,
          lost: scorecardStats.antiLossLost,
          pending: scorecardStats.antiLossPending,
          decided: scorecardStats.antiLossDecided,
          winRate: scorecardStats.antiLossWinRate,
          total: scorecardStats.antiLossTotal,
          settled: scorecardStats.antiLossDecided,
        };
      default:
        return {
          won: scorecardStats.allWon,
          lost: scorecardStats.allLost,
          pending: scorecardStats.allPending,
          decided: scorecardStats.allDecided,
          winRate: scorecardStats.allWinRate,
          total: scorecardStats.allTotal,
          settled: scorecardStats.settledMatchesCount,
        };
    }
  }, [selectedTier, scorecardStats]);

  // Filtered fixtures for General Market view
  const filteredFixtures = useMemo(() => {
    return fixtures.filter((f) => {
      const fixturePreds = predsByFixture.get(f.id) || [];
      const signals: any[] = fixturePreds;
      const isFinished = f.status === 'finished' || f.period === 'FT';
      const isLive = !isFinished && (
        f.status === 'live' ||
        f.status === 'in_progress' ||
        f.status === 'halftime' ||
        (Boolean(f.period) && ['1H', 'HT', '2H', 'ET', 'PK'].includes((f.period || '').toUpperCase()))
      );

      // League filter
      if (selectedLeague !== 'all') {
        const codeMatch = f.league_code?.toLowerCase() === selectedLeague.toLowerCase();
        const idMatch = f.league_id === selectedLeague;
        if (!codeMatch && !idMatch) return false;
      }

      // Date Navigation Filter (Ground truth: Africa/Lagos kickoff date)
      // "All Dates (this will be all predictions of current date and future dates, no past dates)"
      const fDate = getFixtureWatDate(f.target_kickoff_at);
      if (selectedDate !== 'all') {
        if (fDate !== selectedDate) return false;
      } else {
        if (fDate && fDate < dynamicDateTabs.todayIso) return false;
      }

      // Score status filter (Live, Finished, Scheduled)
      if (scoreStatusFilter !== 'all') {
        if (scoreStatusFilter === 'live' && !isLive) return false;
        if (scoreStatusFilter === 'finished' && !isFinished) return false;
        if (scoreStatusFilter === 'scheduled' && (isLive || isFinished)) return false;
      }

      // Tier filter
      if (selectedTier !== 'all') {
        const hasTier = signals.some((s) => {
          const sCat = (s.confidence_category || '').toUpperCase().replace(/ /g, '_');
          if (selectedTier === 'BANGER') return sCat === 'BANGER';
          if (selectedTier === 'TOP PICK') return sCat === 'TOP_PICK' || sCat === 'TOPPICK';
          if (selectedTier === 'HIGH') return sCat === 'HIGH_CONFIDENCE' || sCat === 'HIGHCONFIDENCE' || sCat === 'HIGH';
          if (selectedTier === 'MID') return sCat === 'MID_CONFIDENCE' || sCat === 'MIDCONFIDENCE' || sCat === 'MID';
          if (selectedTier === 'LOW') return sCat === 'LOW_CONFIDENCE' || sCat === 'LOWCONFIDENCE' || sCat === 'LOW' || sCat === 'RISKY';
          if (selectedTier === 'NO_SAFE_BANKER') return sCat === 'NO_SAFE_BANKER' || sCat === 'NOSAFEBANKER' || s.market === 'NO_SAFE_BANKER' || s.prediction === 'SKIP';
          return s.confidence_category === selectedTier;
        });
        if (!hasTier) return false;
      }

      // Strict User Rule: Non-paid users only see won predictions for the day, lost ones are hidden
      if (!isAdmin && !canViewPredictions) {
        const hasWonPred = fixturePreds.some((p) => p.settlement_status === 'won');
        const hasLostPred = fixturePreds.some(
          (p) => p.settlement_status === 'lost' || p.settlement_status === 'void' || p.settlement_status === 'voided'
        );
        if ((hasLostPred && !hasWonPred) || (isFinished && !hasWonPred)) {
          return false;
        }
      }

      // Settlement Status filter
      if (settlementFilter !== 'all') {
        if (canViewPredictions) {
          const hasStatus = fixturePreds.some((p) => {
            let st = p.settlement_status || 'pending';
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
    selectedLeague,
    selectedDate,
    scoreStatusFilter,
    selectedTier,
    settlementFilter,
    canViewPredictions,
    searchQuery,
  ]);

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
              <strong className="regulatory-prefix">🛡️ STRICT REGULATORY NOTICE:</strong> Predictions are probabilistic estimates derived from mathematical simulations for informational purposes only. They are not guarantees of outcomes, and Oddsbanta does not place bets on anyone's behalf. Sports predictive modeling entails variance and uncertainty; please make decisions responsibly. Oddsbanta will not take responsibility for any financial losses. This is STRICTLY FOR EDUCATIONAL purposes only and NOT A FINANCIAL OR INVESTMENT ADVICE. &nbsp;&nbsp;&nbsp;&nbsp;✦&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
            <span className="regulatory-ticker-text" aria-hidden="true">
              <strong className="regulatory-prefix">🛡️ STRICT REGULATORY NOTICE:</strong> Predictions are probabilistic estimates derived from mathematical simulations for informational purposes only. They are not guarantees of outcomes, and Oddsbanta does not place bets on anyone's behalf. Sports predictive modeling entails variance and uncertainty; please make decisions responsibly. Oddsbanta will not take responsibility for any financial losses. This is STRICTLY FOR EDUCATIONAL purposes only and NOT A FINANCIAL OR INVESTMENT ADVICE. &nbsp;&nbsp;&nbsp;&nbsp;✦&nbsp;&nbsp;&nbsp;&nbsp;
            </span>
          </div>
        </div>
      </aside>

      {/* 1. TOP HEADER BAR */}
      <header className={`site-header ${location.pathname === '/' ? 'landing-standalone-header' : ''}`}>
        <div className="site-header-inner">
          <Link to="/" className="header-brand" onClick={() => resetAllFilters()} title="Oddsbanta Home">
            <img src="/oddsbanta-logo.svg" alt="Oddsbanta Prediction Engine" className="brand-header-logo-img" />
          </Link>

            {/* Clean Unified Navigation Links */}
          <div className="header-center-links">
            <Link
              to={targetPredictionsPath}
              className={`nav-link-btn ${isPredictionsOrDashboard ? 'active' : ''}`}
            >
              {currentUser ? 'Dashboard' : 'Predictions'}
            </Link>
            <Link
              to="/other-markets"
              className={`nav-link-btn nav-link-other-markets ${location.pathname === '/other-markets' || location.pathname === '/goals' ? 'active' : ''}`}
            >
              Other Markets
            </Link>
            <button
              type="button"
              className={`nav-link-btn ${location.pathname === '/subscription' ? 'active' : ''}`}
              onClick={() => setIsPricingModalOpen(true)}
            >
              Pricing <span className="pricing-flat-badge">₦5k Flat</span>
            </button>
          </div>

          <div className="header-right-actions">
            {location.pathname === '/' && (
              <Link to={targetPredictionsPath} className="landing-nav-cta">
                {currentUser ? '📊 Dashboard →' : '📊 Predictions →'}
              </Link>
            )}



            {!currentUser && (
              <button
                type="button"
                className="login-action-btn"
                onClick={() => { setAuthModalMode('signin'); setIsAuthModalOpen(true); }}
              >
                Sign In
              </button>
            )}

            {/* Cart-Like Favorites / Custom Slip Button across all screens */}
            <button
              type="button"
              id="btn-nav-favorites-cart"
              className="favorites-menu-cart-btn"
              onClick={() => setIsFavoritesDrawerOpen((prev) => !prev)}
              title="View Favorites & Custom Slip"
              aria-label="Favorites & Custom Slip"
            >
              <span className="favorites-cart-icon">⭐</span>
              <span>Acca Slip</span>
              <span className={`favorites-cart-badge ${favoriteItems.length === 0 ? 'empty' : ''}`}>
                {favoriteItems.length}
              </span>
            </button>

            {/* Modern Hamburger Menu Button */}
            <button
              type="button"
              id="btn-nav-hamburger"
              className={`hamburger-toggle-btn ${isHamburgerOpen ? 'active' : ''}`}
              onClick={() => setIsHamburgerOpen(!isHamburgerOpen)}
              aria-label="Toggle navigation and user menu"
              aria-expanded={isHamburgerOpen}
              title="Navigation & Account Menu"
            >
              {isHamburgerOpen ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              )}
            </button>

            {/* Hamburger Dropdown Display Panel */}
            {isHamburgerOpen && (
              <>
                <div
                  className="hamburger-backdrop"
                  onClick={() => setIsHamburgerOpen(false)}
                  aria-hidden="true"
                />
                <div
                  className="hamburger-dropdown-panel"
                  role="menu"
                  aria-label="Navigation and user actions menu"
                >
                  {currentUser ? (
                    <div
                      className="hamburger-user-header"
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        setIsProfileModalOpen(true);
                      }}
                      title="Click to view full profile details"
                    >
                      <div className="hamburger-user-avatar">👤</div>
                      <div className="hamburger-user-details">
                        <div className="hamburger-user-name">
                          {profile?.display_name || currentUser.email?.split('@')[0]}
                        </div>
                        <div className="hamburger-user-email">
                          {currentUser.email}
                        </div>
                        <span className={`hamburger-role-badge role-${profile?.role || 'free'}`}>
                          {profile?.role === 'admin'
                            ? '🛡 Sigma Admin'
                            : profile?.role === 'bigbang'
                            ? '💥 BigBang VIP'
                            : profile?.role === 'standard'
                            ? '⭐ Standard VIP'
                            : 'Free Access'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="hamburger-guest-header">
                      <div className="hamburger-guest-title">Welcome to Oddsbanta</div>
                      <div className="hamburger-guest-sub">Sign in to unlock full VIP odds & simulations</div>
                      <div className="hamburger-auth-row">
                        <button
                          type="button"
                          className="hamburger-auth-btn signin"
                          onClick={() => {
                            setIsHamburgerOpen(false);
                            setAuthModalMode('signin');
                            setIsAuthModalOpen(true);
                          }}
                        >
                          Sign In
                        </button>
                        <button
                          type="button"
                          className="hamburger-auth-btn register"
                          onClick={() => {
                            setIsHamburgerOpen(false);
                            setAuthModalMode('register');
                            setIsAuthModalOpen(true);
                          }}
                        >
                          Register
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="hamburger-divider" />

                  <div className="hamburger-menu-list">
                    {/* High-Visibility Telegram & WhatsApp Bot Hub Feature */}
                    <button
                      type="button"
                      className="hamburger-menu-item hamburger-bot-item"
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        setIsBotHubModalOpen(true);
                      }}
                      style={{
                        background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.1) 0%, rgba(22, 163, 74, 0.1) 100%)',
                        border: '1px solid rgba(2, 132, 199, 0.3)',
                        borderRadius: '10px',
                        padding: '10px 14px',
                        margin: '2px 0 8px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ fontSize: '20px' }}>🤖</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: '13px', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>Telegram & WhatsApp Bots</span>
                          <span style={{ background: '#22c55e', color: '#ffffff', fontSize: '9px', fontWeight: 900, padding: '1px 5px', borderRadius: '4px' }}>
                            SIGNALS
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748b', marginTop: '1px' }}>
                          {profile?.telegram_chat_id ? '✓ Telegram Connected • Open Bot' : 'Get all predictions on your phone ↗'}
                        </div>
                      </div>
                      <span style={{ fontSize: '14px', color: '#0284c7', fontWeight: 700 }}>→</span>
                    </button>

                    <button
                      type="button"
                      className="hamburger-menu-item"
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        setIsFaqModalOpen(true);
                      }}
                    >
                      <span className="hamburger-item-icon">❓</span>
                      <span className="hamburger-item-label">FAQ & Help Center</span>
                    </button>

                    <button
                      type="button"
                      className="hamburger-menu-item"
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        setIsPricingModalOpen(true);
                      }}
                    >
                      <span className="hamburger-item-icon">💳</span>
                      <span className="hamburger-item-label">Pricing Plans</span>
                      <span className="pricing-flat-badge" style={{ marginLeft: 'auto' }}>₦5k Flat</span>
                    </button>

                    <Link
                      to="/other-markets"
                      className="hamburger-menu-item"
                      onClick={() => setIsHamburgerOpen(false)}
                    >
                      <span className="hamburger-item-icon">🎯</span>
                      <span className="hamburger-item-label">Other Markets</span>
                    </Link>

                    <Link
                      to={targetPredictionsPath}
                      className="hamburger-menu-item"
                      onClick={() => setIsHamburgerOpen(false)}
                    >
                      <span className="hamburger-item-icon">📊</span>
                      <span className="hamburger-item-label">{currentUser ? 'Predictions Dashboard' : 'Predictions'}</span>
                    </Link>

                    {isAdmin && (
                      <Link
                        to="/admin"
                        className="hamburger-menu-item admin-item"
                        onClick={() => setIsHamburgerOpen(false)}
                      >
                        <span className="hamburger-item-icon">🛡</span>
                        <span className="hamburger-item-label">Admin Command Deck</span>
                      </Link>
                    )}

                    {currentUser && (
                      <button
                        type="button"
                        className="hamburger-menu-item"
                        onClick={() => {
                          setIsHamburgerOpen(false);
                          setIsProfileModalOpen(true);
                        }}
                      >
                        <span className="hamburger-item-icon">⚙️</span>
                        <span className="hamburger-item-label">Account Profile</span>
                      </button>
                    )}
                  </div>

                  {currentUser && (
                    <>
                      <div className="hamburger-divider" />
                      <button
                        type="button"
                        className="hamburger-menu-item hamburger-logout-item"
                        onClick={async () => {
                          setIsHamburgerOpen(false);
                          await supabase.auth.signOut();
                          window.location.reload();
                        }}
                      >
                        <span className="hamburger-item-icon">🚪</span>
                        <span className="hamburger-item-label">Sign Out</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="app-container">
        {/* GLOBAL SPONSORED LEADERBOARD BANNER (ALL CURRENT & FUTURE PAGES) */}
        <div className="global-top-ad-banner-wrapper">
          <AdBannerSlot slotType="leaderboard" />
        </div>

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
                onOpenBotHub={() => setIsBotHubModalOpen(true)}
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
                favoriteItems={favoriteItems}
                onToggleFavoriteItem={toggleFavoriteItem}
                onOpenFavoritesDrawer={() => setIsFavoritesDrawerOpen(true)}
              />
            }
          />

          {/* REDIRECT ALIASES */}
          <Route
            path="/analytics"
            element={<Navigate to={targetPredictionsPath} replace />}
          />
          <Route
            path="/dashboard/predictions"
            element={<Navigate to={targetPredictionsPath} replace />}
          />

          {/* ROUTE: OTHER MARKETS (SPECIALIST PREDICTION TERMINAL) */}
          <Route
            path="/other-markets"
            element={
              <OtherMarketsPage
                currentUser={currentUser}
                userRole={profile?.role}
                isAdmin={isAdmin}
                onOpenAuth={(mode) => {
                  setAuthModalMode(mode);
                  setIsAuthModalOpen(true);
                }}
                onOpenSubscription={() => setIsPricingModalOpen(true)}
                favoriteItems={favoriteItems}
                onToggleFavoriteItem={toggleFavoriteItem}
                isFavoriteItem={isFavoriteItem}
                onOpenFavoritesDrawer={() => setIsFavoritesDrawerOpen(true)}
              />
            }
          />
          <Route
            path="/goals"
            element={
              <OtherMarketsPage
                currentUser={currentUser}
                userRole={profile?.role}
                isAdmin={isAdmin}
                onOpenAuth={(mode) => {
                  setAuthModalMode(mode);
                  setIsAuthModalOpen(true);
                }}
                onOpenSubscription={() => setIsPricingModalOpen(true)}
                favoriteItems={favoriteItems}
                onToggleFavoriteItem={toggleFavoriteItem}
                isFavoriteItem={isFavoriteItem}
                onOpenFavoritesDrawer={() => setIsFavoritesDrawerOpen(true)}
              />
            }
          />
          <Route path="/over-2-5" element={<Navigate to="/other-markets" replace />} />

          {/* ROUTE 4: ADMIN COMMAND DECK (STRICTLY GATED) */}
          <Route
            path="/admin"
            element={
              isAuthChecking ? (
                <div
                  className="admin-loading-container"
                  style={{
                    minHeight: '75vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '1rem',
                    padding: '2rem',
                    textAlign: 'center'
                  }}
                >
                  <div className="engine-loading-radar-ring" style={{ width: '60px', height: '60px' }} />
                  <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>
                    Verifying Administrative Credentials...
                  </h3>
                  <p style={{ color: 'var(--text-muted, #64748b)', fontSize: '0.9rem', maxWidth: '420px' }}>
                    Authorizing cryptographic access role in Cloud Supabase session
                  </p>
                </div>
              ) : isAdmin ? (
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
          {/* ROUTE 5 & 6: PREDICTIONS (VISITORS) & DASHBOARD (AUTHENTICATED MEMBERS) */}
          {['/dashboard', '/predictions'].map((pathName) => (
            <Route
              key={pathName}
              path={pathName}
              element={
                pathName === '/dashboard' && !currentUser && !isAuthChecking ? (
                  <Navigate to="/predictions" replace />
                ) : pathName === '/predictions' && currentUser ? (
                  <Navigate to="/dashboard" replace />
                ) : (
                  <div id="fixtures-view-section">
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
          {/* Top Date Header: Current Date Display on left, League Selector Dropdown on far right */}
          <div className="scorecard-date-header">
            <div className="current-date-badge">
              <span className="current-date-live-dot" />
              <span className="current-date-val">{watDateStr || 'Today'}</span>
            </div>

            <div className="scorecard-league-filter-inline">
              <div className="scorecard-league-select-wrapper">
                <span className="scorecard-league-icon">🏆</span>
                <select
                  id="scorecard-league-select"
                  className="scorecard-league-select"
                  value={selectedLeague}
                  onChange={(e) => setSelectedLeague(e.target.value)}
                  aria-label="Filter by League"
                >
                  <option value="all">All Leagues ({fixtures.length})</option>
                  {availableLeagues.map((lg) => (
                    <option key={lg.code} value={lg.code}>
                      {lg.name} ({lg.count})
                    </option>
                  ))}
                </select>
                <span className="scorecard-league-arrow">▾</span>
              </div>
            </div>
          </div>



          {/* Date Navigation Pills Bar: Strictly Ordered: Select Date (Drop down) | Yesterday | Today | Day (with date) | Day (with date) | Day (with date) | All Dates */}
          <div className="date-nav-pills-bar">
            {/* Pill 1: Select Date (Drop down of all past dates) */}
            <div
              className={`date-pill-btn date-pill-dropdown-wrap ${isPastDateSelected ? 'active' : ''}`}
            >
              <span className="date-pill-main-row">
                📅 {isPastDateSelected ? selectedPastFormatted : 'Select Date'} ▾
              </span>
              <span className="date-pill-sub-label">
                {isPastDateSelected ? 'Past Archive' : 'All Past Dates'}
              </span>
              <select
                className="date-pill-native-select"
                value={isPastDateSelected ? selectedDate : ''}
                onChange={(e) => {
                  if (e.target.value) setSelectedDate(e.target.value);
                }}
                aria-label="Select Past Date"
              >
                <option value="" disabled>Select Past Date...</option>
                {dynamicDateTabs.pastDates.map((pd) => (
                  <option key={pd.iso} value={pd.iso}>
                    {pd.formatted}{pd.count ? ` (${pd.count} M)` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Pill 2: Yesterday */}
            <button
              type="button"
              className={`date-pill-btn yesterday-pill ${selectedDate === dynamicDateTabs.yesterday.iso ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.yesterday.iso)}
            >
              <span className="date-pill-main-row">
                Yesterday
                <span className="date-pill-winloss">{dynamicDateTabs.yesterday.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.yesterday.dateFormatted}</span>
            </button>

            {/* Pill 3: Today */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === dynamicDateTabs.today.iso ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.today.iso)}
            >
              <span className="date-pill-main-row">
                Today
                <span className="date-pill-winloss">{dynamicDateTabs.today.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.today.dateFormatted}</span>
            </button>

            {/* Pill 4: Day (with date) - Day + 1 */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === dynamicDateTabs.day1.iso ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.day1.iso)}
            >
              <span className="date-pill-main-row">
                {dynamicDateTabs.day1.shortDay}
                <span className="date-pill-winloss">{dynamicDateTabs.day1.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.day1.dateFormatted}</span>
            </button>

            {/* Pill 5: Day (with date) - Day + 2 */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === dynamicDateTabs.day2.iso ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.day2.iso)}
            >
              <span className="date-pill-main-row">
                {dynamicDateTabs.day2.shortDay}
                <span className="date-pill-winloss">{dynamicDateTabs.day2.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.day2.dateFormatted}</span>
            </button>

            {/* Pill 6: Day (with date) - Day + 3 */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === dynamicDateTabs.day3.iso ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.day3.iso)}
            >
              <span className="date-pill-main-row">
                {dynamicDateTabs.day3.shortDay}
                <span className="date-pill-winloss">{dynamicDateTabs.day3.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.day3.dateFormatted}</span>
            </button>

            {/* Pill 7: All Dates (current date and future dates, no past dates) */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedDate('all')}
            >
              <span className="date-pill-main-row">
                All Dates
                <span className="date-pill-winloss">{dynamicDateTabs.all.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.all.subLabel}</span>
            </button>
          </div>

          {/* 4. DECONGESTED SCORECARD KPI SECTION (TWO COMPACT CARDS WITH INNER DIVIDER LINES) */}
          <div className="scorecard-two-cards-row">
            {/* Card 1: 4 Unified Confidence Tabs inside one single-card footprint */}
            <div className="compact-kpi-card winrates-kpi-card">
              {/* Tab 1: All Predictions */}
              <div
                className={`compact-kpi-segment all-preds-seg ${selectedTier === 'all' && settlementFilter === 'all' && scoreStatusFilter === 'all' ? 'active-seg' : ''}`}
                onClick={() => {
                  setSelectedTier('all');
                  setSettlementFilter('all');
                  setScoreStatusFilter('all');
                }}
                title="Click to reset tier filters and view all predictions"
              >
                <div className="compact-kpi-header">
                  <span className="compact-kpi-title">All Preds</span>
                  <span className="compact-kpi-pill">{scorecardStats.allTotal}M</span>
                </div>
                <div className="compact-kpi-val-row">
                  <span className="compact-kpi-pct">{scorecardStats.allWinRate}%</span>
                  <span className="compact-kpi-ratio">{scorecardStats.allWon}W • {scorecardStats.allLost}L</span>
                </div>
              </div>

              {/* Tab 2: Bangers & Top Picks Grouped Tab */}
              <div className="compact-kpi-grouped-tab">
                <div
                  className={`compact-kpi-subsegment banger-subseg ${selectedTier === 'BANGER' ? 'active-seg' : ''}`}
                  onClick={() => setSelectedTier(selectedTier === 'BANGER' ? 'all' : 'BANGER')}
                  title="Click to filter by 96%+ Bangers"
                >
                  <div className="compact-kpi-header">
                    <span className="compact-kpi-title">⭐ Banger</span>
                    <span className="compact-kpi-pill banger-pill">{scorecardStats.bangerTotal}M</span>
                  </div>
                  <div className="compact-kpi-val-row">
                    <span className="compact-kpi-pct banger-text">{scorecardStats.bangerWinRate}%</span>
                    <span className="compact-kpi-ratio">{scorecardStats.bangerWon}W • {scorecardStats.bangerLost}L</span>
                  </div>
                </div>

                <div className="compact-kpi-inner-divider" />

                <div
                  className={`compact-kpi-subsegment toppick-subseg ${selectedTier === 'TOP PICK' ? 'active-seg' : ''}`}
                  onClick={() => setSelectedTier(selectedTier === 'TOP PICK' ? 'all' : 'TOP PICK')}
                  title="Click to filter by 90%-95% Top Picks"
                >
                  <div className="compact-kpi-header">
                    <span className="compact-kpi-title">👑 Top Pick</span>
                    <span className="compact-kpi-pill toppick-pill">{scorecardStats.topPickTotal}M</span>
                  </div>
                  <div className="compact-kpi-val-row">
                    <span className="compact-kpi-pct toppick-text">{scorecardStats.topPickWinRate}%</span>
                    <span className="compact-kpi-ratio">{scorecardStats.topPickWon}W • {scorecardStats.topPickLost}L</span>
                  </div>
                </div>
              </div>

              {/* Tab 3: High & Mid Confidence Grouped Tab */}
              <div className="compact-kpi-grouped-tab">
                <div
                  className={`compact-kpi-subsegment high-subseg ${selectedTier === 'HIGH' ? 'active-seg' : ''}`}
                  onClick={() => setSelectedTier(selectedTier === 'HIGH' ? 'all' : 'HIGH')}
                  title="Click to filter by 83%-89% High Confidence"
                >
                  <div className="compact-kpi-header">
                    <span className="compact-kpi-title">🟢 High</span>
                    <span className="compact-kpi-pill high-pill">{scorecardStats.highTotal}M</span>
                  </div>
                  <div className="compact-kpi-val-row">
                    <span className="compact-kpi-pct high-text">{scorecardStats.highWinRate}%</span>
                    <span className="compact-kpi-ratio">{scorecardStats.highWon}W • {scorecardStats.highLost}L</span>
                  </div>
                </div>

                <div className="compact-kpi-inner-divider" />

                <div
                  className={`compact-kpi-subsegment mid-subseg ${selectedTier === 'MID' ? 'active-seg' : ''}`}
                  onClick={() => setSelectedTier(selectedTier === 'MID' ? 'all' : 'MID')}
                  title="Click to filter by 75%-82% Mid Confidence"
                >
                  <div className="compact-kpi-header">
                    <span className="compact-kpi-title">🔵 Mid</span>
                    <span className="compact-kpi-pill mid-pill">{scorecardStats.midTotal}M</span>
                  </div>
                  <div className="compact-kpi-val-row">
                    <span className="compact-kpi-pct mid-text">{scorecardStats.midWinRate}%</span>
                    <span className="compact-kpi-ratio">{scorecardStats.midWon}W • {scorecardStats.midLost}L</span>
                  </div>
                </div>
              </div>

              {/* Tab 4: Low & Anti Loss Grouped Tab */}
              <div className="compact-kpi-grouped-tab">
                <div
                  className={`compact-kpi-subsegment low-subseg ${selectedTier === 'LOW' ? 'active-seg' : ''}`}
                  onClick={() => setSelectedTier(selectedTier === 'LOW' ? 'all' : 'LOW')}
                  title="Click to filter by 65%-74% Low Confidence"
                >
                  <div className="compact-kpi-header">
                    <span className="compact-kpi-title">🟡 Low</span>
                    <span className="compact-kpi-pill low-pill">{scorecardStats.lowTotal}M</span>
                  </div>
                  <div className="compact-kpi-val-row">
                    <span className="compact-kpi-pct low-text">{scorecardStats.lowWinRate}%</span>
                    <span className="compact-kpi-ratio">{scorecardStats.lowWon}W • {scorecardStats.lowLost}L</span>
                  </div>
                </div>

                <div className="compact-kpi-inner-divider" />

                <div
                  className={`compact-kpi-subsegment antiloss-subseg ${selectedTier === 'NO_SAFE_BANKER' ? 'active-seg' : ''}`}
                  onClick={() => setSelectedTier(selectedTier === 'NO_SAFE_BANKER' ? 'all' : 'NO_SAFE_BANKER')}
                  title="Click to filter by Anti-Loss (No Safe Banker)"
                >
                  <div className="compact-kpi-header">
                    <span className="compact-kpi-title">🛡️ Anti Loss</span>
                    <span className="compact-kpi-pill antiloss-pill">{scorecardStats.antiLossTotal}M</span>
                  </div>
                  <div className="compact-kpi-val-row">
                    <span className="compact-kpi-pct antiloss-text">{scorecardStats.antiLossWinRate}%</span>
                    <span className="compact-kpi-ratio">{scorecardStats.antiLossWon}W • {scorecardStats.antiLossLost}L</span>
                  </div>
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
                <span className="act-seg-val">{activeTierStats.settled}</span>
                <span className="act-seg-sub">FT</span>
              </div>

              {/* Option 2: Won */}
              <div
                className={`compact-act-segment won-seg ${settlementFilter === 'won' ? 'active-seg' : ''}`}
                onClick={() => setSettlementFilter(settlementFilter === 'won' ? 'all' : 'won')}
                title="Click to filter by won predictions"
              >
                <span className="act-seg-label">Won</span>
                <span className="act-seg-val won-text">{activeTierStats.won}</span>
                <span className="act-seg-sub">Wins</span>
              </div>

              {/* Option 3: Lost */}
              <div
                className={`compact-act-segment lost-seg ${settlementFilter === 'lost' ? 'active-seg' : ''}`}
                onClick={() => setSettlementFilter(settlementFilter === 'lost' ? 'all' : 'lost')}
                title="Click to filter by lost predictions"
              >
                <span className="act-seg-label">Lost</span>
                <span className="act-seg-val lost-text">{activeTierStats.lost}</span>
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
                <span className="act-seg-val won-text">{activeTierStats.winRate}%</span>
                <span className="act-seg-sub">{activeTierStats.won}/{activeTierStats.decided}</span>
              </div>

              {/* Option 5: In-Play */}
              <div
                className={`compact-act-segment pending-seg ${settlementFilter === 'pending' ? 'active-seg' : ''}`}
                onClick={() => setSettlementFilter(settlementFilter === 'pending' ? 'all' : 'pending')}
                title="Click to filter by in-play / pending picks"
              >
                <span className="act-seg-label">In-Play</span>
                <span className="act-seg-val pending-text">
                  {activeTierStats.pending}
                  {selectedTier === 'all' && scorecardStats.liveCount > 0 && <span className="act-live-sub"> ({scorecardStats.liveCount})</span>}
                </span>
                <span className="act-seg-sub">Active</span>
              </div>
            </div>
          </div>
        </section>


        {/* 7. MAIN DASHBOARD 3-COLUMN GRID (Left Ad Sidebar + Fixtures Stream + Watchlist Sidebar) */}
        <div className="main-dashboard-grid">
          {/* LEFT SIDEBAR: AD BANNER */}
          <LeftSidebarAd />

          {/* CENTER MAIN STREAM: DECOUPLED FOOTBALL MARKET TERMINAL */}
          <div className="fixtures-stream-column">
            {/* Scroll Target Anchor for Smooth Pagination Scrolling */}
            <div id="market-terminal-stream-top" />

            {/* DASHBOARD GENERAL FIXTURES STREAM */}

                {/* Cloud Telemetry / Error State */}
                {error && (
                  <div
                    style={{
                      padding: 16,
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: 12,
                      color: '#b91c1c',
                      fontSize: 13,
                      marginBottom: 16,
                    }}
                  >
                    <strong>Cloud Telemetry Notice:</strong> {error}
                  </div>
                )}

                {loading ? (
                  <div
                    style={{
                      padding: 40,
                      background: '#ffffff',
                      borderRadius: 16,
                      border: '1px solid var(--border-subtle)',
                      textAlign: 'center',
                    }}
                  >
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-600 mb-3" />
                    <div style={{ fontWeight: 800, color: 'var(--text-primary)' }}>
                      Synchronizing Global Prediction Queue...
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                      Fetching verified mathematical simulations and authoritative match results.
                    </div>
                  </div>
                ) : filteredFixtures.length === 0 ? (
                  <div
                    style={{
                      padding: 48,
                      background: '#ffffff',
                      borderRadius: 16,
                      border: '1px solid var(--border-subtle)',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: 32, marginBottom: 8 }}>⚽</div>
                    <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--text-primary)' }}>
                      {selectedDate !== 'all'
                        ? 'No predictions available for this date.'
                        : 'No predictions available for this selection.'}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-muted)',
                        marginTop: 4,
                        maxWidth: 460,
                        margin: '6px auto 16px',
                      }}
                    >
                      No published predictions are available for your current selection. Oddsbanta only displays
                      matches that have completed full mathematical simulations and met our publication confidence
                      thresholds.
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
                            isFavoriteItem={isFavoriteItem}
                            onToggleFavoriteItem={toggleFavoriteItem}
                            isExpanded={expandedFixtures.has(fixture.id)}
                            onToggleExpand={() => toggleFixtureExpand(fixture.id)}
                          />
                          {idx === 2 && (
                            <div style={{ margin: '14px 0' }}>
                              <AdBannerSlot slotType="native-card" />
                            </div>
                          )}
                        </Fragment>
                      );
                    })}
                  </div>
                )}
          </div>

          {/* RIGHT SIDEBAR: FAVORITES / WATCHLIST */}
          <WatchlistSidebar
            favoriteItems={favoriteItems}
            onToggleFavoriteItem={toggleFavoriteItem}
            onOpenFavoritesDrawer={() => setIsFavoritesDrawerOpen(true)}
          />
        </div>
            </>
          )}
                  </div>
                )
              }
            />
          ))}

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
          navigate(targetPredictionsPath);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        userRole={isAdmin ? 'admin' : profile?.role}
        currentUser={currentUser}
      />

      {/* MOBILE APP BOTTOM TAB BAR (Native App Experience on Mobile Screens <= 768px) */}
      <nav className="mobile-app-bottom-bar" aria-label="Mobile Navigation Bar">
        <Link to="/" className={`mobile-tab-item ${location.pathname === '/' ? 'active' : ''}`}>
          <span className="mobile-tab-icon">🏠</span>
          <span className="mobile-tab-label">Home</span>
        </Link>
        <Link to={targetPredictionsPath} className={`mobile-tab-item ${isPredictionsOrDashboard ? 'active' : ''}`}>
          <span className="mobile-tab-icon">📊</span>
          <span className="mobile-tab-label">{currentUser ? 'Dashboard' : 'Predictions'}</span>
        </Link>
        <Link
          to="/other-markets"
          className={`mobile-tab-item mobile-tab-other-markets ${location.pathname === '/other-markets' || location.pathname === '/goals' ? 'active' : ''}`}
        >
          <span className="mobile-tab-icon">🎯</span>
          <span className="mobile-tab-label">Other Markets</span>
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

      <BotHubModal
        isOpen={isBotHubModalOpen}
        onClose={() => setIsBotHubModalOpen(false)}
        currentUser={currentUser}
        profile={profile}
        onOpenAuth={(mode) => {
          setAuthModalMode(mode);
          setIsAuthModalOpen(true);
        }}
        onProfileUpdated={fetchCloudData}
        onOpenPricing={() => {
          setIsBotHubModalOpen(false);
          setIsPricingModalOpen(true);
        }}
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
      {/* Floating Draggable Favorites/Slip Widget */}
      <FloatingFavoritesWidget
        count={favoriteItems.length}
        isOpen={isFavoritesDrawerOpen}
        onToggleDrawer={() => setIsFavoritesDrawerOpen((prev) => !prev)}
      />

      {/* Slide-over Favorites Slip Drawer */}
      <FavoritesDrawer
        isOpen={isFavoritesDrawerOpen}
        onClose={() => setIsFavoritesDrawerOpen(false)}
        favorites={favoriteItems}
        onRemoveItem={toggleFavoriteItem}
        onClearAll={clearAllFavorites}
      />

      {/* Global NDPR / GDPR Cookie Consent & Attribution Banner */}
      <CookieConsentBanner />
    </div>
  );
}
