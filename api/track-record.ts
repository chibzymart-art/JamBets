import { getTrackRecord } from './_lib/trackRecord';
import { verifyEdgeAccess } from './_lib/jwt-verifier';

/**
 * Admin-only track record JSON (settled results per product and 0–10 score tier).
 * Used by the Track Record tab in the Admin panel. Requires an admin Bearer token and is never
 * cached by shared caches; the underlying data is still backed by a 30-minute per-instance
 * memory cache with in-flight de-duplication.
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json',
    Vary: 'Origin, Authorization',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), { status: 405, headers });
  }

  // Admin-only: the track record is no longer public. Responses are never cached by shared caches.
  const privateHeaders = {
    ...headers,
    'Cache-Control': 'private, no-store',
    'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store',
  };
  const authHeader = req.headers.get('Authorization');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim() || null;
  if (!rawToken) {
    return new Response(JSON.stringify({ success: false, error: 'Authentication required' }), { status: 401, headers: privateHeaders });
  }
  const level = await verifyEdgeAccess(rawToken);
  if (level !== 'admin') {
    return new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403, headers: privateHeaders });
  }

  try {
    const data = await getTrackRecord();
    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200,
      headers: privateHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: 'Track record temporarily unavailable' }), {
      status: 503,
      headers: { ...headers, 'Cache-Control': 'no-store' },
    });
  }
}
