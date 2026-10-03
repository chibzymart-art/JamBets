import { getTrackRecord } from './_lib/trackRecord';

/**
 * Public track record JSON (settled results per product and 0–10 score tier).
 * Used by the Track Record page and the landing page instead of direct Supabase queries.
 *
 * Bandwidth: ~5 KB response, CDN-cached 30 minutes with a day of stale-while-revalidate,
 * and backed by a 30-minute per-instance memory cache with in-flight de-duplication.
 */
export const config = {
  runtime: 'edge',
};

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('Origin') || '';
  const allowed = ['https://www.oddsbanta.com', 'https://oddsbanta.com', 'http://localhost:5173', 'http://localhost:3000'];
  return allowed.includes(origin) ? origin : 'https://www.oddsbanta.com';
}

export default async function handler(req: Request): Promise<Response> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': getCorsOrigin(req),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const data = await getTrackRecord();
    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200,
      headers: {
        ...headers,
        'Cache-Control': 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400',
        'CDN-Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Track record temporarily unavailable' }), {
      status: 503,
      headers: { ...headers, 'Cache-Control': 'no-store' },
    });
  }
}
