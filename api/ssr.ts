import { getTrackRecord, getUpcomingFixtures } from './_lib/trackRecord';
import { fallbackShell, normalizeRoute, renderPage, routeNeedsUpcoming } from './_lib/ssrRender';

/**
 * Server-rendered public pages. vercel.json rewrites the public routes here
 * (e.g. /dashboard/tennis → /api/ssr?path=/dashboard/tennis).
 *
 * Bandwidth: the HTML is CDN-cached (s-maxage=900, stale-while-revalidate=86400), the SPA
 * shell is cached per edge instance for the life of the deployment, and track record /
 * fixture data come from the 30/15-minute memory caches in _lib/trackRecord.
 */
export const config = {
  runtime: 'edge',
};

let shellCache: string | null = null;

async function getShell(req: Request): Promise<string | null> {
  if (shellCache) return shellCache;
  const origin = new URL(req.url).origin;
  const headers: Record<string, string> = {};
  // Preview deployments may sit behind Vercel Authentication; forward the visitor's cookie.
  const cookie = req.headers.get('cookie');
  if (cookie) headers.cookie = cookie;
  const bypass = req.headers.get('x-vercel-protection-bypass');
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;

  const res = await fetch(`${origin}/app-shell.html`, { headers });
  if (!res.ok) return null;
  const html = await res.text();
  if (!html.includes('<div id="root">')) return null;
  shellCache = html;
  return html;
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const route = normalizeRoute(url.searchParams.get('path'));

  const [shell, tr, upcoming] = await Promise.all([
    getShell(req).catch(() => null),
    getTrackRecord().catch(() => null),
    routeNeedsUpcoming(route) ? getUpcomingFixtures().catch(() => []) : Promise.resolve([]),
  ]);

  const html = renderPage(shell || fallbackShell(), route, tr, upcoming);
  // Only cache at the CDN when the page is complete; degraded pages are retried on the next request.
  const healthy = !!shell && !!tr;
  const cdn = healthy ? 'public, s-maxage=900, stale-while-revalidate=86400' : 'no-store';

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': healthy ? 'public, max-age=0, must-revalidate' : 'no-store',
      'CDN-Cache-Control': cdn,
      'Vercel-CDN-Cache-Control': cdn,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
