// Vercel Edge Runtime Sliding-Window In-Memory Rate Limiter
// CGNAT-Aware: Supports User-Centric Rate Limiting for mobile carriers & hotspots (MTN, Airtel, Starlink, etc.)

function decodeBase64UrlJson(str: string): any {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const jsonStr = decodeURIComponent(
      Array.prototype.map
        .call(atob(base64 + pad), (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export function decodeJwtPayloadUnsafe(token: string): any {
  const raw = token.startsWith('Bearer ') ? token.slice(7).trim() : token.trim();
  const parts = raw.split('.');
  if (parts.length < 2) return null;
  return decodeBase64UrlJson(parts[1]);
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup > windowMs * 2) {
    lastCleanup = now;
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetAt) {
        rateLimitStore.delete(key);
      }
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetSec: number;
}

export interface AdaptiveRateLimitOptions {
  userLimit?: number; // default: 180 req/min
  ipLimit?: number;   // default: 120 req/min
  windowSec?: number; // default: 60s
}

export interface AdaptiveRateLimitResult extends RateLimitResult {
  limit: number;
  key: string;
  isUser: boolean;
}

/**
 * Standard sliding-window rate limit check by key.
 */
export function checkRateLimit(
  key: string,
  limit: number = 120,
  windowSec: number = 60
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  cleanup(windowMs);

  const record = rateLimitStore.get(key);
  if (!record || now > record.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetSec: windowSec };
  }

  if (record.count >= limit) {
    const resetSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    return { allowed: false, remaining: 0, resetSec };
  }

  record.count += 1;
  const resetSec = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
  return { allowed: true, remaining: Math.max(0, limit - record.count), resetSec };
}

/**
 * Derives client IP from standard proxy headers (Cloudflare, Vercel, Nginx).
 */
export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * Derives CGNAT-safe rate limit identifier:
 * - Internal services (Service Role Key or CRON_SECRET) => 'exempt'
 * - Authenticated users (valid JWT with user id) => `${prefix}:user:${userId}`
 * - Anonymous / Visitors / Bots => `${prefix}:ip:${clientIp}`
 */
export function getRateLimitKey(
  req: Request,
  prefix: string,
  clientIp?: string
): { key: string; isExempt: boolean; isUser: boolean; defaultLimit: number } {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
  const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader?.trim() || null;

  // 1. Check for Internal Service Exemption (Service Role or Cron Secret)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const cronSecret = process.env.CRON_SECRET;
  const headerCronSecret = req.headers.get('x-cron-secret');

  if (
    (serviceKey && rawToken === serviceKey) ||
    (cronSecret && (rawToken === cronSecret || headerCronSecret === cronSecret))
  ) {
    return {
      key: `${prefix}:service`,
      isExempt: true,
      isUser: false,
      defaultLimit: 999999,
    };
  }

  // 2. Check for Authenticated User via fast-path JWT decode (0ms network)
  if (rawToken && rawToken.length > 20) {
    try {
      const payload = decodeJwtPayloadUnsafe(rawToken);
      if (payload && typeof payload === 'object') {
        const userId = payload.sub || payload.id;
        const role = payload.role;
        const nowSec = Math.floor(Date.now() / 1000);
        const isNotExpired = !payload.exp || payload.exp > nowSec;

        if (typeof userId === 'string' && userId.length > 5 && role !== 'anon' && isNotExpired) {
          return {
            key: `${prefix}:user:${userId}`,
            isExempt: false,
            isUser: true,
            defaultLimit: 180,
          };
        }
      }
    } catch {
      // Fall through to IP-based rate limiting
    }
  }

  // 3. Fallback: IP-based rate limiting for anonymous visitors & scrapers
  const resolvedIp = clientIp || getClientIp(req);
  return {
    key: `${prefix}:ip:${resolvedIp}`,
    isExempt: false,
    isUser: false,
    defaultLimit: 120,
  };
}

/**
 * CGNAT-Safe Adaptive Rate Limiter:
 * - Internal services (Service Role Key or CRON_SECRET) => Exempt (999,999 limit)
 * - Authenticated users (valid JWT with user id) => Keyed by `${prefix}:user:${userId}` (180 req/min)
 * - Anonymous / Visitors / Bots => Keyed by `${prefix}:ip:${clientIp}` (120 req/min)
 */
export function checkAdaptiveRateLimit(
  req: Request,
  prefix: string,
  options?: AdaptiveRateLimitOptions
): AdaptiveRateLimitResult {
  const { key, isExempt, isUser, defaultLimit } = getRateLimitKey(req, prefix);
  const windowSec = options?.windowSec ?? 60;

  if (isExempt) {
    return {
      allowed: true,
      remaining: 999999,
      resetSec: 0,
      limit: 999999,
      key,
      isUser: false,
    };
  }

  const limit = isUser
    ? (options?.userLimit ?? defaultLimit)
    : (options?.ipLimit ?? defaultLimit);

  const res = checkRateLimit(key, limit, windowSec);
  return {
    ...res,
    limit,
    key,
    isUser,
  };
}
