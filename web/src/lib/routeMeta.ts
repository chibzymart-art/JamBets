/**
 * Per-route <title>/description for client-side navigation.
 * Mirrors META in api/_lib/ssrRender.ts (server-rendered first paint); keep both in sync.
 */
export interface RouteSeo {
  title: string;
  description: string;
}

export const ROUTE_SEO: Record<string, RouteSeo> = {
  '/': {
    title: 'Oddsbanta: Football, Tennis & Basketball Predictions with a 0–10 Confidence Score',
    description:
      'Sports predictions rated on a 0–10 confidence score. Every pick is published before kickoff and settled on a public track record that shows wins and losses.',
  },
  '/dashboard': {
    title: 'Football Predictions Today | Oddsbanta Dashboard',
    description:
      'Today’s football predictions with a 0–10 confidence score per pick, published before kickoff. See the settled hit rate for every score tier on the track record.',
  },
  '/dashboard/goals': {
    title: 'Over 2.5 Goals & First-Half Goals Predictions | Oddsbanta',
    description:
      'Football goals predictions for Over 2.5 goals and first-half goals, rated on a 0–10 confidence score and settled publicly after every match.',
  },
  '/dashboard/tennis': {
    title: 'Tennis Predictions Today: ATP & WTA | Oddsbanta',
    description:
      'ATP and WTA tennis match predictions rated on a 0–10 confidence score, published before the first serve and settled on a public track record.',
  },
  '/dashboard/basketball': {
    title: 'Basketball Predictions Today | Oddsbanta',
    description:
      'Basketball predictions rated on a 0–10 confidence score, published before tip-off and settled on a public track record.',
  },
  '/track-record': {
    title: 'Track Record: Settled Results by Confidence Score | Oddsbanta',
    description:
      'Every settled Oddsbanta pick, wins and losses, grouped by 0–10 confidence score tier with sample sizes. Live results only, not a backtest.',
  },
  '/dashboard/american-football': {
    title: 'American Football Predictions: Coming Soon | Oddsbanta',
    description: 'American football predictions with a 0–10 confidence score are coming soon to Oddsbanta.',
  },
  '/dashboard/cricket': {
    title: 'Cricket Predictions: Coming Soon | Oddsbanta',
    description: 'Cricket predictions with a 0–10 confidence score are coming soon to Oddsbanta.',
  },
  '/subscription': {
    title: 'Plans & Pricing | Oddsbanta',
    description:
      'Oddsbanta plans unlock every pick and its 0–10 confidence score across football, tennis and basketball. Check the public track record before you subscribe.',
  },
  '/admin': {
    title: 'Admin | Oddsbanta',
    description: 'Internal operations.',
  },
};

export function seoForPath(pathname: string): RouteSeo {
  const p = pathname.replace(/\/+$/, '') || '/';
  return ROUTE_SEO[p] || ROUTE_SEO['/'];
}

/** Dashboard sub-routes; the dashboard is public (paid content stays locked inside cards). */
export const DASHBOARD_PATHS = {
  football: '/dashboard',
  goals: '/dashboard/goals',
  tennis: '/dashboard/tennis',
  basketball: '/dashboard/basketball',
  american_football: '/dashboard/american-football',
  cricket: '/dashboard/cricket',
  /** Public, indexable page: deliberately outside /dashboard. */
  trackRecord: '/track-record',
} as const;
