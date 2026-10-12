import { EdgeCacheRegistry } from './_lib/edge-cache';
import { checkRateLimit, getClientIp } from './rate-limiter';

export const config = {
  runtime: 'edge',
};

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const ODDSBANTA_INVALIDATION_SECRET = process.env.ODDSBANTA_INVALIDATION_SECRET || process.env.CRON_SECRET || '';

function getCorsOrigin(req: Request): string {
  const origin = req.headers.get('Origin') || '';
  const allowed = [
    'https://www.oddsbanta.com',
    'https://oddsbanta.com',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  return allowed.includes(origin) ? origin : 'https://www.oddsbanta.com';
}

function verifyAuth(req: Request): boolean {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY;
  const invalidationSecret = process.env.ODDSBANTA_INVALIDATION_SECRET || process.env.CRON_SECRET || ODDSBANTA_INVALIDATION_SECRET;
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
  const secretHeader = req.headers.get('x-invalidation-secret') || '';

  if (serviceRoleKey && (token === serviceRoleKey || secretHeader === serviceRoleKey)) {
    return true;
  }
  if (invalidationSecret && (token === invalidationSecret || secretHeader === invalidationSecret)) {
    return true;
  }
  return false;
}

export default async function handler(req: Request) {
  const corsOrigin = getCorsOrigin(req);
  const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-invalidation-secret',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Rate Limiting: 60 requests per minute per IP for invalidation endpoint
  const clientIp = getClientIp(req);
  const rateLimit = checkRateLimit(`invalidate-cache:${clientIp}`, 60, 60);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({ success: false, error: 'Rate limit exceeded. Please retry shortly.' }),
      { status: 429, headers: corsHeaders }
    );
  }

  // Authentication check
  if (!verifyAuth(req)) {
    return new Response(
      JSON.stringify({ success: false, error: 'Unauthorized: valid service key or invalidation secret required' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const url = new URL(req.url);

  // GET: Health / Diagnostic Cache Stats
  if (req.method === 'GET') {
    const stats = EdgeCacheRegistry.stats();
    return new Response(
      JSON.stringify({
        success: true,
        status: 'active',
        stats,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: corsHeaders }
    );
  }

  // POST: Invalidate cache entries
  try {
    let feedsToInvalidate: string[] = [];
    const queryFeed = url.searchParams.get('feed');
    const isAll = url.searchParams.get('all') === 'true';

    let bodyData: any = {};
    try {
      bodyData = await req.json();
    } catch {
      // Body may be empty if query params used
    }

    if (isAll || bodyData.all === true) {
      feedsToInvalidate = []; // Empty string/undefined means invalidate all in registry
    } else if (queryFeed) {
      feedsToInvalidate = [queryFeed];
    } else if (Array.isArray(bodyData.feeds)) {
      feedsToInvalidate = bodyData.feeds;
    } else if (typeof bodyData.feed === 'string') {
      feedsToInvalidate = [bodyData.feed];
    }

    let results: string[] = [];
    if (feedsToInvalidate.length === 0) {
      // Invalidate all registered caches
      results = EdgeCacheRegistry.invalidate();
    } else {
      for (const feed of feedsToInvalidate) {
        results.push(...EdgeCacheRegistry.invalidate(feed));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Dynamic edge cache invalidation completed',
        invalidated: results,
        stats: EdgeCacheRegistry.stats(),
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: err.message || 'Cache invalidation error' }),
      { status: 500, headers: corsHeaders }
    );
  }
}
