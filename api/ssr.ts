import { getTrackRecord, getUpcomingFixtures } from './_lib/trackRecord';
import { fallbackShell, normalizeRoute, renderPage, routeNeedsUpcoming } from './_lib/ssrRender';

/**
 * Server-rendered public pages. vercel.json rewrites the public routes here
 * (e.g. /dashboard/tennis → /api/ssr?path=/dashboard/tennis).
 *
 * Edge Cache: 60s CDN cache with 120s stale-while-revalidate ensures fresh deployment
 * rollouts propagate within 1 minute, preventing stale JS asset 404s.
 */
export const config = {
  runtime: 'edge',
};

// Deployment-aware shell cache: in-memory cache tied strictly to current deployment ID/commit SHA
const DEPLOY_ID =
  (typeof process !== 'undefined' && (process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA)) ||
  'dev';

let shellCache: string | null = null;
let cachedDeployId: string | null = null;

async function getShell(req: Request): Promise<string | null> {
  if (shellCache && cachedDeployId === DEPLOY_ID) {
    return shellCache;
  }

  const origin = new URL(req.url).origin;
  const headers: Record<string, string> = {};
  // Preview deployments may sit behind Vercel Authentication; forward the visitor's cookie.
  const cookie = req.headers.get('cookie');
  if (cookie) headers.cookie = cookie;
  const bypass = req.headers.get('x-vercel-protection-bypass');
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;

  // Append deployment ID parameter and cache: no-cache to bypass stale edge cache across deployments
  const res = await fetch(`${origin}/app-shell.html?v=${encodeURIComponent(DEPLOY_ID)}`, {
    headers,
    cache: 'no-cache',
  });
  if (!res.ok) return null;
  const html = await res.text();
  if (!html.includes('<div id="root">')) return null;
  shellCache = html;
  cachedDeployId = DEPLOY_ID;
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
  // Fast 60s CDN cache with 120s revalidation: keeps response times fast while ensuring newly
  // deployed JavaScript bundle hashes reach visitors in under 1 minute.
  const healthy = !!shell && !!tr;
  const cdn = healthy ? 'public, s-maxage=60, stale-while-revalidate=120' : 'no-store';

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

