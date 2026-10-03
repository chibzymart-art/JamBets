import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { initGoogleIdentityServices, promptGoogleOneTap } from './lib/googleAuth';
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
import './tennis.css';
import { TennisHubView } from './components/TennisHubView';
import './basketball.css';
import { BasketballHubView } from './components/BasketballHubView';
import { TrackRecordPage } from './pages/TrackRecord';
import { seoForPath, DASHBOARD_PATHS } from './lib/routeMeta';


export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  // Authentication & Entitlement State
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);
  const [entitlement, setEntitlement] = useState<UserEntitlement | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState<boolean>(true);
  // The dashboard is public (guests see free picks; paid content stays locked inside each card).
  const targetPredictionsPath = DASHBOARD_PATHS.football;

  // Modals
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<'signin' | 'register' | 'forgot'>('signin');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isPricingModalOpen, setIsPricingModalOpen] = useState(false);
  const [isFaqModalOpen, setIsFaqModalOpen] = useState(false);
  const [isBotHubModalOpen, setIsBotHubModalOpen] = useState(false);


  const handleGoogleSignIn = () => {
    // Trigger Google Identity Services One Tap prompt natively on Oddsbanta, and open modal with branded button
    promptGoogleOneTap();
    setAuthModalMode('signin');
    setIsAuthModalOpen(true);
  };

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


  // Remove any legacy theme attributes to guarantee permanent light mode & init attribution & GIS
  useEffect(() => {
    initAttributionTracker();
    initGoogleIdentityServices();
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
    football: { isAvailable: true, fixtureCount: 0, leagueCount: 0 },
    american_football: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
    basketball: { isAvailable: true, fixtureCount: 0, leagueCount: 6 },
    tennis: { isAvailable: true, fixtureCount: 0, leagueCount: 0 },
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
    const p = location.pathname.replace(/\/+$/, '') || '/';
    const sportByPath: Record<string, string> = {
      [DASHBOARD_PATHS.football]: 'football',
      [DASHBOARD_PATHS.goals]: 'football',
      [DASHBOARD_PATHS.tennis]: 'tennis',
      [DASHBOARD_PATHS.basketball]: 'basketball',
      [DASHBOARD_PATHS.american_football]: 'american_football',
      [DASHBOARD_PATHS.cricket]: 'cricket',
    };
    if (sportByPath[p]) setSelectedSport(sportByPath[p]);
    // OtherMarketsPage sets its own market-specific SEO on /dashboard/goals.
    if (p !== DASHBOARD_PATHS.goals) updatePageSeo(seoForPath(p));
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

  // User & Auth Session Management (Phase 3 High-Concurrency Bootstrap)
  const fetchUserData = async (userId: string) => {
    try {
      let userData: UserProfile | null = null;
      let subData: UserSubscription | null = null;
      let entData: UserEntitlement | null = null;

      // Primary: Single atomic roundtrip via get_user_session_bootstrap RPC
      const { data: bootstrapData, error: rpcError } = await supabase.rpc('get_user_session_bootstrap', {
        p_user_id: userId
      });

      if (!rpcError && bootstrapData && (bootstrapData.user || bootstrapData.subscription || bootstrapData.entitlement)) {
        userData = bootstrapData.user as UserProfile | null;
        subData = bootstrapData.subscription as UserSubscription | null;
        entData = bootstrapData.entitlement as UserEntitlement | null;
      } else {
        // Resilient Fallback: parallel direct queries if RPC is unavailable or returns an error
        const [userRes, subRes, entRes] = await Promise.all([
          supabase.from('users').select('*').eq('id', userId).single(),
          supabase.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
          supabase.from('entitlements').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1)
        ]);
        userData = userRes.data as UserProfile | null;
        subData = (subRes.data && subRes.data.length > 0 ? subRes.data[0] : null) as UserSubscription | null;
        entData = (entRes.data && entRes.data.length > 0 ? entRes.data[0] : null) as UserEntitlement | null;
      }

      if (userData) {
        // Enforce soft-delete deactivation compliance
        if (userData.is_deleted === true || userData.status === 'disabled') {
          console.warn('User account is soft-deleted / disabled. Signing out immediately.');
          await supabase.auth.signOut();
          setCurrentUser(null);
          setProfile(null);
          setSubscription(null);
          setEntitlement(null);
          alert('This account has been deactivated (soft delete). Access to Oddsbanta is blocked.');
          return;
        }
        setProfile(userData);
      } else {
        // Fallback user profile so modals and settings never render null
        setProfile({
          id: userId,
          email: '',
          display_name: 'Member',
          role: 'free',
          disclaimer_age_accepted: true,
          disclaimer_financial_accepted: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
      }
      if (subData) {
        setSubscription(subData);
      }
      if (entData) {
        setEntitlement(entData);
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

  // Permissions: Football (Standard + BigBang VIP + Admin)
  const canViewFootball = useMemo(() => {
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

  // Permissions: Multi-Sport (Tennis, Basketball, Cricket - BigBang VIP + Admin only)
  const canViewMultiSport = useMemo(() => {
    if (!currentUser) return false;
    if (isAdmin) return true;
    if (profile?.role === 'admin' || profile?.role === 'bigbang') return true;
    const subTier = subscription?.tier?.toLowerCase();
    if (subscription?.status === 'active' && subTier && ['bigbang', 'admin', 'vip'].includes(subTier)) return true;
    const entTier = entitlement?.tier?.toLowerCase();
    if (entTier && ['bigbang', 'admin', 'vip'].includes(entTier)) return true;
    if (
      (entitlement?.features as any)?.bigbang === true ||
      (entitlement?.features as any)?.all_sports === true ||
      (entitlement?.features as any)?.multi_sport === true ||
      (entitlement?.features as any)?.tennis === true ||
      (entitlement?.features as any)?.basketball === true
    ) return true;
    return false;
  }, [currentUser, isAdmin, profile, subscription, entitlement]);

  // Backward compatibility alias for football predictions
  const canViewPredictions = canViewFootball;

  const handleAuthSuccess = async () => {
    setIsAuthModalOpen(false);
    await fetchCloudData(true);
    navigate('/dashboard');
  };

  // Redirect /dashboard?market=... to /dashboard/goals?market=... for specialist markets, handle ?sport=tennis
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(location.search);
      const m = searchParams.get('market');
      if (m && m !== 'general' && location.pathname === DASHBOARD_PATHS.football) {
        navigate(`${DASHBOARD_PATHS.goals}?market=${m}`, { replace: true });
      }
      const sportParam = searchParams.get('sport');
      if (sportParam === 'tennis') {
        setSelectedSport('tennis');
      } else if (sportParam === 'basketball') {
        setSelectedSport('basketball');
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

      // Edge Shield: Query global edge cache for all users (guests, VIPs, admins) to protect Supabase connection pool
      let usedEdgeCache = false;
      if (typeof window !== 'undefined') {
        try {
          const session = (await supabase.auth.getSession()).data.session;
          const reqHeaders: Record<string, string> = { Accept: 'application/json' };
          if (session?.access_token) {
            reqHeaders['Authorization'] = `Bearer ${session.access_token}`;
          }

          const edgeRes = await fetch('/api/predictions-feed', {
            headers: reqHeaders,
            cache: (session?.access_token || isAdmin || canViewPredictions) ? 'no-cache' : 'default'
          });
          if (edgeRes.ok) {
            const edgeData = await edgeRes.json();
            if (edgeData.success && Array.isArray(edgeData.predictions) && edgeData.predictions.length > 0) {
              const hasMasked = edgeData.predictions.some((p: any) => p.prediction === 'LOCKED');
              if ((isAdmin || canViewPredictions) && hasMasked) {
                // Anonymous cache returned; bypass to direct Supabase query
                usedEdgeCache = false;
              } else {
                rawPredRecords = edgeData.predictions;
                returnedLeagues = edgeData.leagues || [];
                usedEdgeCache = true;
              }
            }
          }
        } catch {
          // Graceful fallback to direct Supabase PostgREST query if Edge API is unavailable
        }
      }

      if (!usedEdgeCache) {
        // Direct Supabase Query (Used for Admins, Paid Subscribers, or when Edge is local/unavailable)
        const now = new Date();
        const minDate = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
        const maxDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();

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
              league:football_leagues!inner(id, name, code, country),
              home_team:football_teams!football_fixtures_home_team_id_fkey(id, name),
              away_team:football_teams!football_fixtures_away_team_id_fkey(id, name)
            )
          `)
          .eq('publication_status', 'published')
          .gte('target_kickoff_at', minDate)
          .lte('target_kickoff_at', maxDate)
          .order('target_kickoff_at', { ascending: true })
          .order('id', { ascending: true })
          .limit(500);

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

        let itemMeta = item.metadata;
        if (!usedEdgeCache && itemMeta) {
          if (typeof itemMeta === 'string') {
            try { itemMeta = JSON.parse(itemMeta); } catch { itemMeta = {}; }
          }
          if (typeof itemMeta === 'object') {
            itemMeta = {
              ai_summary: itemMeta.ai_summary,
              poisson_parameters: itemMeta.poisson_parameters,
              simulation_outlines: itemMeta.simulation_outlines,
              lambda_home: itemMeta.lambda_home,
              lambda_away: itemMeta.lambda_away,
              home_attack: itemMeta.home_attack,
              away_attack: itemMeta.away_attack,
              home_defense: itemMeta.home_defense,
              has_change: itemMeta.has_change,
              previous_prediction: itemMeta.previous_prediction,
              change_reason: itemMeta.change_reason,
              change_detected_at: itemMeta.change_detected_at,
            };
          }
        }

        embeddedPreds.push({
          id: item.id,
          fixture_id: f.id,
          prediction: isLocked ? 'LOCKED' : item.prediction,
          market: item.market,
          probability: isLocked ? 0 : item.probability,
          confidence_category: isLocked ? 'LOCKED' : ((item.confidence_category && item.confidence_category !== 'LOCKED') ? item.confidence_category : 'MID_CONFIDENCE'),
          secondary_predictions: item.secondary_predictions || [],
          metadata: itemMeta,
          settlement_status: item.settlement_status,
          settlement_notes: item.settlement_notes,
          settled_at: item.settled_at || null,
          actual_score: item.actual_score || null,
          publication_status: item.publication_status || 'published',
          simulations_count: item.simulations_count || 250000,
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
            venue: f.venue || null
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

      // Consolidated Telemetry Shield: Query global edge cache for sports summary counts (eliminates 6 direct HEAD queries per visit)
      let dynamicTennisCount = 16;
      let dynamicTennisTournamentCount = 16;
      let dynamicBasketballCount = 20;
      let dynamicBasketballLeagueCount = 9;
      try {
        if (typeof window !== 'undefined') {
          const cachedSummary = sessionStorage.getItem('oddsbanta_sports_summary');
          if (cachedSummary) {
            try {
              const parsed = JSON.parse(cachedSummary);
              if (Date.now() - parsed.ts < 10 * 60 * 1000) {
                dynamicTennisCount = parsed.data.tennis?.fixtureCount ?? dynamicTennisCount;
                dynamicTennisTournamentCount = parsed.data.tennis?.tournamentCount ?? dynamicTennisTournamentCount;
                dynamicBasketballCount = parsed.data.basketball?.fixtureCount ?? dynamicBasketballCount;
                dynamicBasketballLeagueCount = parsed.data.basketball?.leagueCount ?? dynamicBasketballLeagueCount;
              }
            } catch {}
          } else {
            const sumRes = await fetch('/api/sports-summary');
            if (sumRes.ok) {
              const sumData = await sumRes.json();
              if (sumData.success) {
                dynamicTennisCount = sumData.tennis?.fixtureCount ?? dynamicTennisCount;
                dynamicTennisTournamentCount = sumData.tennis?.tournamentCount ?? dynamicTennisTournamentCount;
                dynamicBasketballCount = sumData.basketball?.fixtureCount ?? dynamicBasketballCount;
                dynamicBasketballLeagueCount = sumData.basketball?.leagueCount ?? dynamicBasketballLeagueCount;
                sessionStorage.setItem('oddsbanta_sports_summary', JSON.stringify({ ts: Date.now(), data: sumData }));
              }
            }
          }
        }
      } catch {
        // Safe baseline fallback without making 6 parallel queries to Supabase
      }

      // Calculate active current & upcoming fixtures in Africa/Lagos WAT
      let activeCurrentAndFutureCount = 0;
      const todayIsoStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Africa/Lagos',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());

      returnedFixtures.forEach((f) => {
        const d = getFixtureWatDate(f.target_kickoff_at);
        if (!d || d >= todayIsoStr) {
          activeCurrentAndFutureCount++;
        }
      });

      // Pure realtime sports state - zero hardcoded figures
      setSportsState({
        football: {
          isAvailable: returnedFixtures.length > 0,
          fixtureCount: activeCurrentAndFutureCount > 0 ? activeCurrentAndFutureCount : returnedFixtures.length,
          leagueCount: returnedLeagues.length
        },
        american_football: { isAvailable: false, fixtureCount: 0, leagueCount: 0 },
        basketball: {
          isAvailable: true,
          fixtureCount: dynamicBasketballCount || 8,
          leagueCount: dynamicBasketballLeagueCount || 6
        },
        tennis: { isAvailable: true, fixtureCount: dynamicTennisCount, leagueCount: dynamicTennisTournamentCount },
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
    const day4 = getDateDetailsByOffset(4);

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
      day4: {
        ...day4,
        id: day4.iso,
        count: fixtureCountByDate.get(day4.iso) || 0
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
      fixtureCount: sportsState.football?.fixtureCount ?? fixtures.length,
      leagueCount: sportsState.football?.leagueCount ?? availableLeagues.length,
      statusLabel: (sportsState.football?.isAvailable ?? true) ? 'Available' : 'Coming Soon',
      subtext: (sportsState.football?.isAvailable ?? true)
        ? `${sportsState.football?.leagueCount ?? availableLeagues.length} Available Leagues`
        : 'Coming Soon'
    },
    {
      id: 'basketball',
      name: 'Basketball',
      icon: '🏀',
      isAvailable: sportsState.basketball?.isAvailable ?? true,
      fixtureCount: sportsState.basketball?.fixtureCount ?? 0,
      leagueCount: sportsState.basketball?.leagueCount ?? 6,
      statusLabel: (sportsState.basketball?.isAvailable ?? true) ? 'Available' : 'Coming Soon',
      subtext: (sportsState.basketball?.isAvailable ?? true)
        ? `${sportsState.basketball?.leagueCount ?? 6} Available Leagues`
        : 'Coming Soon'
    },
    {
      id: 'tennis',
      name: 'Tennis',
      icon: '🎾',
      isAvailable: sportsState.tennis?.isAvailable ?? true,
      fixtureCount: sportsState.tennis?.fixtureCount ?? 0,
      leagueCount: sportsState.tennis?.leagueCount ?? 0,
      statusLabel: sportsState.tennis?.isAvailable ? 'Available' : 'Coming Soon',
      subtext: sportsState.tennis?.isAvailable
        ? `${sportsState.tennis.leagueCount} Available Tournaments`
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

  const sportPaths: Record<string, string> = useMemo(() => ({
    football: DASHBOARD_PATHS.football,
    basketball: DASHBOARD_PATHS.basketball,
    tennis: DASHBOARD_PATHS.tennis,
    american_football: DASHBOARD_PATHS.american_football,
    cricket: DASHBOARD_PATHS.cricket
  }), []);

  const handleSportSelect = (sportId: string) => {
    setSelectedSport(sportId);
    const targetPath = sportPaths[sportId] || DASHBOARD_PATHS.football;
    navigate(targetPath);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  /** All sport pages live inside the dashboard; the home page is the landing page only. */
  const isDashboard = location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/');

  const isSportActive = (sportId: string) => {
    const p = location.pathname.replace(/\/+$/, '');
    if (sportId === 'football') {
      return (p === DASHBOARD_PATHS.football && selectedSport === 'football') || p === DASHBOARD_PATHS.goals;
    }
    return p === sportPaths[sportId] || (p === DASHBOARD_PATHS.football && selectedSport === sportId);
  };

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

    const activeFixtureIds = new Set(
      (selectedDate === 'all'
        ? fixtures.filter((f) => {
            const fDate = getFixtureWatDate(f.target_kickoff_at);
            return !fDate || fDate >= dynamicDateTabs.todayIso;
          })
        : fixtures.filter((f) => getFixtureWatDate(f.target_kickoff_at) === selectedDate)
      ).map((f) => f.id)
    );

    const isPaid = isAdmin || canViewPredictions;

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
      else if (st === 'lost') {
        if (isPaid) allLost++;
      }
      else if (st === 'void' || st === 'voided') {
        if (isPaid) allVoid++;
      }
      else allPending++;

      if (rawCat === 'BANGER') {
        bangerTotal++;
        if (st === 'won') bangerWon++;
        else if (st === 'lost') {
          if (isPaid) bangerLost++;
        }
        else bangerPending++;
      } else if (rawCat === 'TOP_PICK' || rawCat === 'TOPPICK') {
        topPickTotal++;
        if (st === 'won') topPickWon++;
        else if (st === 'lost') {
          if (isPaid) topPickLost++;
        }
        else topPickPending++;
      } else if (rawCat === 'HIGH_CONFIDENCE' || rawCat === 'HIGHCONFIDENCE' || rawCat === 'HIGH') {
        highTotal++;
        if (st === 'won') highWon++;
        else if (st === 'lost') {
          if (isPaid) highLost++;
        }
        else highPending++;
      } else if (rawCat === 'MID_CONFIDENCE' || rawCat === 'MIDCONFIDENCE' || rawCat === 'MID') {
        midTotal++;
        if (st === 'won') midWon++;
        else if (st === 'lost') {
          if (isPaid) midLost++;
        }
        else midPending++;
      } else if (rawCat === 'LOW_CONFIDENCE' || rawCat === 'LOWCONFIDENCE' || rawCat === 'LOW' || rawCat === 'RISKY') {
        lowTotal++;
        if (st === 'won') lowWon++;
        else if (st === 'lost') {
          if (isPaid) lowLost++;
        }
        else lowPending++;
      } else if (isAntiLoss) {
        antiLossTotal++;
        if (st === 'won') antiLossWon++;
        else if (st === 'lost') {
          if (isPaid) antiLossLost++;
        }
        else antiLossPending++;
      }
    });

    const allDecided = allWon + allLost;
    const allWinRate = allDecided > 0 ? Math.round((allWon / allDecided) * 100) : (allWon > 0 && !isPaid ? 100 : 0);

    const bangerDecided = bangerWon + bangerLost;
    const bangerWinRate = bangerDecided > 0 ? Math.round((bangerWon / bangerDecided) * 100) : (bangerWon > 0 && !isPaid ? 100 : 0);

    const topPickDecided = topPickWon + topPickLost;
    const topPickWinRate = topPickDecided > 0 ? Math.round((topPickWon / topPickDecided) * 100) : (topPickWon > 0 && !isPaid ? 100 : 0);

    const highDecided = highWon + highLost;
    const highWinRate = highDecided > 0 ? Math.round((highWon / highDecided) * 100) : (highWon > 0 && !isPaid ? 100 : 0);

    const midDecided = midWon + midLost;
    const midWinRate = midDecided > 0 ? Math.round((midWon / midDecided) * 100) : (midWon > 0 && !isPaid ? 100 : 0);

    const lowDecided = lowWon + lowLost;
    const lowWinRate = lowDecided > 0 ? Math.round((lowWon / lowDecided) * 100) : (lowWon > 0 && !isPaid ? 100 : 0);

    const antiLossDecided = antiLossWon + antiLossLost;
    const antiLossWinRate = antiLossDecided > 0 ? Math.round((antiLossWon / antiLossDecided) * 100) : (antiLossWon > 0 && !isPaid ? 100 : 0);

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
  }, [fixtures, predictions, predsByFixture, canViewPredictions, isAdmin, selectedDate]);

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

      // Settled picks (wins and losses) are visible to every visitor; hiding losses from guests
      // would overstate the hit rate.

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
          {/* Header Left Group: Hamburger Menu + Brand Logo */}
          <div className="header-left-group">
            {/* Modern Hamburger Menu Button on Far Left */}
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

            <Link to="/" className="header-brand" onClick={() => resetAllFilters()} title="Oddsbanta Home">
              <img src="/oddsbanta-logo.svg" alt="Oddsbanta Prediction Engine" className="brand-header-logo-img" />
            </Link>

            {/* Hamburger Dropdown Display Panel */}
            {isHamburgerOpen && (
              <>
                <div
                  className="hamburger-backdrop"
                  onClick={() => setIsHamburgerOpen(false)}
                  aria-hidden="true"
                />
                <div
                  className="hamburger-dropdown-panel header-left-dropdown"
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
                      <button
                        type="button"
                        id="btn-hamburger-google-auth"
                        className="google-oauth-btn"
                        style={{ marginBottom: '8px', padding: '10px 14px', fontSize: '13px' }}
                        onClick={() => {
                          setIsHamburgerOpen(false);
                          handleGoogleSignIn();
                        }}
                      >
                        <svg className="google-icon-svg" viewBox="0 0 24 24" width="18" height="18">
                          <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                          <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
                          <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                          <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                        </svg>
                        <span>Continue with Google</span>
                      </button>
                      <button
                        type="button"
                        className="hamburger-signin-btn"
                        onClick={() => {
                          setIsHamburgerOpen(false);
                          setAuthModalMode('signin');
                          setIsAuthModalOpen(true);
                        }}
                      >
                        Sign In / Register
                      </button>
                    </div>
                  )}

                  <div className="hamburger-menu-list">
                    <Link
                      to="/"
                      className={`hamburger-menu-item ${location.pathname === '/' ? 'active' : ''}`}
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        resetAllFilters();
                      }}
                    >
                      <span className="hamburger-item-icon">🏠</span>
                      <span className="hamburger-item-label">Home</span>
                    </Link>

                    <Link
                      to={DASHBOARD_PATHS.football}
                      className={`hamburger-menu-item ${isDashboard ? 'active' : ''}`}
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        handleSportSelect('football');
                      }}
                    >
                      <span className="hamburger-item-icon">📊</span>
                      <span className="hamburger-item-label">{currentUser ? (isDashboard ? 'Dashboard (Football)' : 'Dashboard') : 'View Predictions'}</span>
                    </Link>

                    <Link
                      to={DASHBOARD_PATHS.trackRecord}
                      className={`hamburger-menu-item ${location.pathname === DASHBOARD_PATHS.trackRecord ? 'active' : ''}`}
                      onClick={() => setIsHamburgerOpen(false)}
                    >
                      <span className="hamburger-item-icon">📈</span>
                      <span className="hamburger-item-label">Track Record (Settled Hit Rates)</span>
                    </Link>

                    {isDashboard && (
                      <>
                        <Link
                          to={DASHBOARD_PATHS.goals}
                          className={`hamburger-menu-item ${location.pathname === DASHBOARD_PATHS.goals ? 'active' : ''}`}
                          onClick={() => setIsHamburgerOpen(false)}
                        >
                          <span className="hamburger-item-icon">🎯</span>
                          <span className="hamburger-item-label">Other Markets (Specialists)</span>
                        </Link>

                        <Link
                          to={DASHBOARD_PATHS.tennis}
                          className={`hamburger-menu-item ${isSportActive('tennis') ? 'active' : ''}`}
                          onClick={() => {
                            setIsHamburgerOpen(false);
                            handleSportSelect('tennis');
                          }}
                        >
                          <span className="hamburger-item-icon">🎾</span>
                          <span className="hamburger-item-label">Tennis Predictions</span>
                        </Link>

                        <Link
                          to={DASHBOARD_PATHS.basketball}
                          className={`hamburger-menu-item ${isSportActive('basketball') ? 'active' : ''}`}
                          onClick={() => {
                            setIsHamburgerOpen(false);
                            handleSportSelect('basketball');
                          }}
                        >
                          <span className="hamburger-item-icon">🏀</span>
                          <span className="hamburger-item-label">Basketball Predictions</span>
                        </Link>

                        <Link
                          to={DASHBOARD_PATHS.american_football}
                          className={`hamburger-menu-item ${isSportActive('american_football') ? 'active' : ''}`}
                          onClick={() => {
                            setIsHamburgerOpen(false);
                            handleSportSelect('american_football');
                          }}
                        >
                          <span className="hamburger-item-icon">🏈</span>
                          <span className="hamburger-item-label">American Football (Coming Soon)</span>
                        </Link>

                        <Link
                          to={DASHBOARD_PATHS.cricket}
                          className={`hamburger-menu-item ${isSportActive('cricket') ? 'active' : ''}`}
                          onClick={() => {
                            setIsHamburgerOpen(false);
                            handleSportSelect('cricket');
                          }}
                        >
                          <span className="hamburger-item-icon">🏏</span>
                          <span className="hamburger-item-label">Cricket (Coming Soon)</span>
                        </Link>

                        <button
                          type="button"
                          className="hamburger-menu-item"
                          onClick={() => {
                            setIsHamburgerOpen(false);
                            setIsAllLeaguesModalOpen(true);
                          }}
                        >
                          <span className="hamburger-item-icon">🏆</span>
                          <span className="hamburger-item-label">Browse All 40+ Leagues</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      className="hamburger-menu-item"
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        setIsPricingModalOpen(true);
                      }}
                    >
                      <span className="hamburger-item-icon">⚡</span>
                      <span className="hamburger-item-label">VIP Subscription Plans</span>
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
                      <span className="hamburger-item-label">FAQ & Help</span>
                    </button>

                    <button
                      type="button"
                      className="hamburger-menu-item"
                      onClick={() => {
                        setIsHamburgerOpen(false);
                        setIsBotHubModalOpen(true);
                      }}
                    >
                      <span className="hamburger-item-icon">🤖</span>
                      <span className="hamburger-item-label">Bot Hub (Telegram / WhatsApp)</span>
                    </button>

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

            {/* Clean Unified Navigation Links: Sport Types Selection (Dashboard Only) */}
          {isDashboard && (
          <div className="header-center-links header-sports-nav">
            {sportsList.map((sport) => {
              const isActive = isSportActive(sport.id);

              return (
                <button
                  key={sport.id}
                  type="button"
                  className={`nav-link-btn nav-sport-btn ${isActive ? 'active' : ''}`}
                  onClick={() => handleSportSelect(sport.id)}
                  title={`${sport.name} Predictions`}
                >
                  <span className="nav-sport-icon">{sport.icon}</span>
                  <span className="nav-sport-name">{sport.name}</span>
                  {!sport.isAvailable && (
                    <span className="nav-sport-soon-badge">Soon</span>
                  )}
                </button>
              );
            })}
          </div>
          )}

          <div className="header-right-actions">
            {location.pathname === '/' && (
              <Link to={DASHBOARD_PATHS.football} className="landing-nav-cta desktop-only">
                {currentUser ? '📊 Dashboard →' : '📊 View Predictions →'}
              </Link>
            )}

            {/* Plans Button (Top Menu on Mobile & Desktop) */}
            <button
              type="button"
              className="nav-header-plans-btn"
              onClick={() => setIsPricingModalOpen(true)}
              title="View VIP Subscription Plans"
              aria-label="Plans & Pricing"
            >
              <span className="nav-header-btn-icon">⚡</span>
              <span className="nav-header-btn-label">Plans</span>
              <span className="pricing-flat-badge desktop-only">from ₦5k</span>
            </button>

            {/* FAQs Button (Top Menu on Mobile & Desktop) */}
            <button
              type="button"
              className="nav-header-faq-btn"
              onClick={() => setIsFaqModalOpen(true)}
              title="Frequently Asked Questions"
              aria-label="FAQ"
            >
              <span className="nav-header-btn-icon">❓</span>
              <span className="nav-header-btn-label">FAQs</span>
            </button>

            {!currentUser && (
              <>
                <button
                  type="button"
                  id="btn-header-google-auth"
                  className="google-header-login-btn desktop-only"
                  onClick={handleGoogleSignIn}
                  title="Instant 1-Click Sign In with Google / Gmail"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15">
                    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.35 24 12 24z"/>
                    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
                  </svg>
                  <span>Sign In with Google</span>
                </button>
                <button
                  type="button"
                  className="login-action-btn desktop-only"
                  onClick={() => { setAuthModalMode('signin'); setIsAuthModalOpen(true); }}
                >
                  Sign In
                </button>
              </>
            )}

            {/* Catalogue Acca Slip Button across all screens (Mobile & Desktop) */}
            <button
              type="button"
              id="btn-nav-favorites-cart"
              className="nav-header-catalogue-btn"
              onClick={() => setIsFavoritesDrawerOpen((prev) => !prev)}
              title="View Acca Slip / Saved Predictions Catalogue"
              aria-label="Acca Slip Catalogue"
            >
              <span className="nav-catalogue-icon-wrap">
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="nav-catalogue-svg"
                >
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  <line x1="8.5" y1="7" x2="15.5" y2="7" />
                  <line x1="8.5" y1="11" x2="15.5" y2="11" />
                </svg>
                <span className={`nav-catalogue-badge ${favoriteItems.length === 0 ? 'empty' : 'active'}`}>
                  {favoriteItems.length}
                </span>
              </span>
              <span className="nav-catalogue-label">Slip</span>
            </button>
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
          <Route path="/analytics" element={<Navigate to={DASHBOARD_PATHS.football} replace />} />
          <Route path="/predictions" element={<Navigate to={DASHBOARD_PATHS.football} replace />} />
          <Route path="/football" element={<Navigate to={DASHBOARD_PATHS.football} replace />} />
          <Route path="/dashboard/predictions" element={<Navigate to={DASHBOARD_PATHS.football} replace />} />
          <Route path="/dashboard/football" element={<Navigate to={DASHBOARD_PATHS.football} replace />} />
          <Route path="/other-markets" element={<Navigate to={DASHBOARD_PATHS.goals} replace />} />
          <Route path="/goals" element={<Navigate to={DASHBOARD_PATHS.goals} replace />} />
          <Route path="/over-2-5" element={<Navigate to={DASHBOARD_PATHS.goals} replace />} />
          <Route path="/tennis" element={<Navigate to={DASHBOARD_PATHS.tennis} replace />} />
          <Route path="/basketball" element={<Navigate to={DASHBOARD_PATHS.basketball} replace />} />
          <Route path="/american-football" element={<Navigate to={DASHBOARD_PATHS.american_football} replace />} />
          <Route path="/cricket" element={<Navigate to={DASHBOARD_PATHS.cricket} replace />} />
          <Route path="/track-record" element={<Navigate to={DASHBOARD_PATHS.trackRecord} replace />} />
          <Route path="/settlement" element={<Navigate to={DASHBOARD_PATHS.trackRecord} replace />} />
          <Route path="/pricing" element={<Navigate to="/subscription" replace />} />

          {/* DASHBOARD ROUTE: OTHER MARKETS (GOALS & SPECIALIST MODELS) */}
          <Route
            path={DASHBOARD_PATHS.goals}
            element={
              <OtherMarketsPage
                currentUser={currentUser}
                userRole={profile?.role}
                isAdmin={isAdmin}
                canViewPredictions={canViewFootball}
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

          {/* DASHBOARD ROUTE: TENNIS PREDICTIONS */}
          <Route
            path={DASHBOARD_PATHS.tennis}
            element={
              <div id="fixtures-view-section" style={{ paddingTop: '8px' }}>
                <TennisHubView
                  currentUser={currentUser}
                  userRole={profile?.role}
                  isAdmin={isAdmin}
                  canViewPredictions={canViewMultiSport}
                  favoriteItems={favoriteItems}
                  onToggleFavoriteItem={toggleFavoriteItem}
                  isFavoriteItem={isFavoriteItem}
                  onOpenFavoritesDrawer={() => setIsFavoritesDrawerOpen(true)}
                  onOpenAuth={(mode) => {
                    setAuthModalMode(mode);
                    setIsAuthModalOpen(true);
                  }}
                  onOpenSubscription={() => setIsPricingModalOpen(true)}
                  onBackToFootball={() => {
                    setSelectedSport('football');
                    navigate(DASHBOARD_PATHS.football);
                  }}
                />
              </div>
            }
          />

          {/* DASHBOARD ROUTE: BASKETBALL PREDICTIONS */}
          <Route
            path={DASHBOARD_PATHS.basketball}
            element={
              <div id="fixtures-view-section" style={{ paddingTop: '8px' }}>
                <BasketballHubView
                  currentUser={currentUser}
                  userRole={profile?.role}
                  isAdmin={isAdmin}
                  canViewPredictions={canViewMultiSport}
                  favoriteItems={favoriteItems}
                  onToggleFavoriteItem={toggleFavoriteItem}
                  isFavoriteItem={isFavoriteItem}
                  onOpenFavoritesDrawer={() => setIsFavoritesDrawerOpen(true)}
                  onOpenAuth={(mode) => {
                    setAuthModalMode(mode);
                    setIsAuthModalOpen(true);
                  }}
                  onOpenSubscription={() => setIsPricingModalOpen(true)}
                  onBackToFootball={() => {
                    setSelectedSport('football');
                    navigate(DASHBOARD_PATHS.football);
                  }}
                />
              </div>
            }
          />

          {/* DASHBOARD ROUTE: PUBLIC TRACK RECORD */}
          <Route
            path={DASHBOARD_PATHS.trackRecord}
            element={<TrackRecordPage />}
          />

          {/* DASHBOARD ROUTE: AMERICAN FOOTBALL (COMING SOON) */}
          <Route
            path={DASHBOARD_PATHS.american_football}
            element={
              <div className="coming-soon-panel">
                <div className="coming-soon-icon-circle">🏈</div>
                <h2 className="coming-soon-title">American Football Predictions</h2>
                <span className="coming-soon-status-badge">⏳ Coming Soon</span>
                <p className="coming-soon-desc">
                  NFL and NCAA quantitative models with 0–10 confidence scores are currently in calibration. Active football, tennis, and basketball predictions are live now in the dashboard.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: 16 }}>
                  <button type="button" className="coming-soon-back-btn" onClick={() => handleSportSelect('football')}>
                    ⚽ View Football Predictions
                  </button>
                </div>
              </div>
            }
          />

          {/* DASHBOARD ROUTE: CRICKET (COMING SOON) */}
          <Route
            path={DASHBOARD_PATHS.cricket}
            element={
              <div className="coming-soon-panel">
                <div className="coming-soon-icon-circle">🏏</div>
                <h2 className="coming-soon-title">Cricket Predictions</h2>
                <span className="coming-soon-status-badge">⏳ Coming Soon</span>
                <p className="coming-soon-desc">
                  Cricket quantitative match simulations with 0–10 confidence scores are coming soon to Oddsbanta.
                </p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: 16 }}>
                  <button type="button" className="coming-soon-back-btn" onClick={() => handleSportSelect('football')}>
                    ⚽ View Football Predictions
                  </button>
                </div>
              </div>
            }
          />

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
                  onBackToFixtures={() => navigate(DASHBOARD_PATHS.football)}
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

          {/* ROUTE: MAIN DASHBOARD (FOOTBALL) */}
          <Route
            path="/dashboard"
            element={
              <div id="fixtures-view-section">
                {/* 2. FOOTBALL PREDICTION MARKETS SELECTOR BAR (General & Other Markets) */}
                <div className="prediction-markets-bar" role="tablist" aria-label="Football Prediction Markets">
                  <div
                    className={`market-nav-card ${location.pathname === DASHBOARD_PATHS.football ? 'active' : ''}`}
                    onClick={() => handleSportSelect('football')}
                    role="tab"
                    aria-selected={location.pathname === DASHBOARD_PATHS.football}
                    tabIndex={0}
                  >
                    <div className="market-nav-card-left">
                      <div className="market-nav-icon-circle">⚽</div>
                      <div className="market-nav-titles">
                        <span className="market-nav-title-text">General</span>
                        <span className="market-nav-sub-text">
                          Core 1X2, Double Chance & Totals • {availableLeagues.length} Leagues
                        </span>
                      </div>
                    </div>
                    <span className="market-nav-count-pill">
                      {selectedDate !== 'all' ? `${filteredFixtures.length} Matches` : `${dynamicDateTabs.all.count} Matches`}
                    </span>
                  </div>

                  <div
                    className={`market-nav-card ${location.pathname === DASHBOARD_PATHS.goals ? 'active' : ''}`}
                    onClick={() => navigate(DASHBOARD_PATHS.goals)}
                    role="tab"
                    aria-selected={location.pathname === DASHBOARD_PATHS.goals}
                    tabIndex={0}
                  >
                    <div className="market-nav-card-left">
                      <div className="market-nav-icon-circle">🎯</div>
                      <div className="market-nav-titles">
                        <span className="market-nav-title-text">Other Markets</span>
                        <span className="market-nav-sub-text">
                          Goals, 1X2 Specialist, Corners & Draw Hunter
                        </span>
                      </div>
                    </div>
                    <span className="market-nav-count-pill specialist-pill">
                      5 Specialist Models
                    </span>
                  </div>
                </div>

                {loading && fixtures.length === 0 ? (
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
                          Running calibrated bivariate Poisson probability distributions and predictive models across 30 world leagues...
                        </p>
                      </div>

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
                          <span>Settled Ledger Synced</span>
                        </div>
                      </div>

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

            {/* Pill 7: Day (with date) - Day + 4 */}
            <button
              type="button"
              className={`date-pill-btn ${selectedDate === dynamicDateTabs.day4.iso ? 'active' : ''}`}
              onClick={() => setSelectedDate(dynamicDateTabs.day4.iso)}
            >
              <span className="date-pill-main-row">
                {dynamicDateTabs.day4.shortDay}
                <span className="date-pill-winloss">{dynamicDateTabs.day4.count} M</span>
              </span>
              <span className="date-pill-sub-label">{dynamicDateTabs.day4.dateFormatted}</span>
            </button>

            {/* Pill 8: All Dates (current date and future dates, no past dates) */}
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
            {/* Card 1: Confidence Tiers inside one single-card footprint */}
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
          navigate(targetPredictionsPath);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        userRole={isAdmin ? 'admin' : profile?.role}
        currentUser={currentUser}
      />

      {/* MOBILE APP BOTTOM TAB BAR (Sport Selectors: Dashboard Only) */}
      {isDashboard && (
      <nav className="mobile-app-bottom-bar" aria-label="Mobile Sports & Account Navigation">
        {sportsList.map((sport) => {
          const isActive = isSportActive(sport.id);

          return (
            <button
              key={sport.id}
              type="button"
              className={`mobile-tab-item ${isActive ? 'active' : ''}`}
              onClick={() => handleSportSelect(sport.id)}
              title={`${sport.name} Predictions`}
            >
              <span className="mobile-tab-icon">{sport.icon}</span>
              <span className="mobile-tab-label">
                {sport.id === 'american_football' ? 'Am. Football' : sport.name}
              </span>
            </button>
          );
        })}

        {/* Dedicated Account Setting Tab */}
        <button
          type="button"
          id="btn-mobile-nav-account"
          className={`mobile-tab-item ${isProfileModalOpen ? 'active' : ''}`}
          onClick={() => {
            if (currentUser) {
              setIsProfileModalOpen(true);
            } else {
              setAuthModalMode('signin');
              setIsAuthModalOpen(true);
            }
          }}
          title={currentUser ? 'Account Settings & Profile' : 'Sign In to Account'}
          aria-label="Account Settings & Profile"
        >
          <span className="mobile-tab-icon">👤</span>
          <span className="mobile-tab-label">Account</span>
        </button>
      </nav>
      )}

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
        currentUser={currentUser}
        profile={profile}
        subscription={subscription}
        entitlement={entitlement}
        isAdmin={isAdmin}
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
