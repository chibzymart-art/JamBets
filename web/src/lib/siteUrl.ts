import { SITE_ORIGIN } from './seo';

/**
 * Origin to put in links that leave the site and come back (auth emails, Google sign-in).
 *
 * Production always uses the canonical www.oddsbanta.com, even when the visitor happens to be on
 * another host Vercel serves (jambets.vercel.app, oddsbanta.com without www). Using
 * window.location.origin there made Supabase links send people back to jambets.vercel.app.
 * Local development keeps its own origin so sign-in still works on localhost.
 */
export function authRedirectOrigin(): string {
  if (typeof window === 'undefined') return SITE_ORIGIN;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')) {
    return window.location.origin;
  }
  return SITE_ORIGIN;
}
