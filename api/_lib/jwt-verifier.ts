// Cryptographic Edge JWT & 3-Day Trial Verifier for Oddsbanta
// Runs on Vercel Edge Runtime (Zero-Latency Web Crypto API)
//
// SINGLE SOURCE OF TRUTH for feed entitlements (server side):
//
//   level      | football (general / 1H Blitz / O2.5 / Corners) | multi-sport (tennis / basketball)
//   -----------|------------------------------------------------|-----------------------------------
//   visitor    | locked                                         | locked
//   expired    | locked                                         | locked
//   trial      | UNLOCKED (first 72h after account creation)    | locked
//   standard   | UNLOCKED                                       | locked
//   vip        | UNLOCKED (BigBang VIP)                         | UNLOCKED
//   admin      | UNLOCKED                                       | UNLOCKED

export type AuthStatus = 'paid_or_trial' | 'expired' | 'visitor';
export type AccessLevel = 'visitor' | 'expired' | 'trial' | 'standard' | 'vip' | 'admin';

const LEVEL_RANK: Record<AccessLevel, number> = {
  visitor: 0,
  expired: 1,
  trial: 2,
  standard: 3,
  vip: 4,
  admin: 5,
};

interface CachedAccess {
  level: AccessLevel;
  userId?: string;
  email?: string;
  expiresAt: number;
}

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://vepcoopomlfjageijsew.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const ADMIN_EMAILS = new Set([
  'chibzymart@gmail.com',
  'whizzchibz@gmail.com',
  'chibuezec.amuchie@gmail.com',
  'nnamdiamuchie@gmail.com',
]);

const TRIAL_DURATION_MS = 3 * 24 * 60 * 60 * 1000; // 72 hours

// Sliding-window memory cache to eliminate repeated Supabase roundtrips
const accessCache = new Map<string, CachedAccess>();
const inflightAccessChecks = new Map<string, Promise<AccessLevel>>();

// Cache TTLs (short enough that an upgrade/payment is reflected within seconds)
const VALID_AUTH_TTL_MS = 120 * 1000; // 2 minutes for trial/standard/vip/admin
const EXPIRED_AUTH_TTL_MS = 15 * 1000; // 15 seconds for expired users (so an upgrade unlocks quickly)
const INVALID_AUTH_TTL_MS = 60 * 1000; // 1 minute for invalid/malformed tokens

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

/** Maps a tier / role string onto the access level it grants (never 'trial'). */
function levelFromTier(raw: unknown): AccessLevel | null {
  const tier = String(raw || '').toLowerCase().trim();
  if (tier === 'admin') return 'admin';
  if (['bigbang', 'big_bang', 'vip', 'pro', 'premium'].includes(tier)) return 'vip';
  if (tier === 'standard') return 'standard';
  if (tier === 'trial' || tier === 'free_trial') return 'trial';
  return null;
}

function maxLevel(a: AccessLevel, b: AccessLevel | null): AccessLevel {
  if (!b) return a;
  return LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a;
}

/** True when an entitlement/subscription window is still open. `null` means open-ended. */
function windowOpen(until: unknown, allowOpenEnded: boolean): boolean {
  if (!until) return allowOpenEnded;
  const ms = new Date(String(until)).getTime();
  return Number.isFinite(ms) && ms > Date.now();
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Reads the user's tier records. Direct own-row selects through the user's JWT are
 * blocked by RLS in production (they return []), so we use:
 *   1. the SECURITY DEFINER bootstrap RPC with the user's own token (always works), and
 *   2. direct service-role reads when SUPABASE_SERVICE_ROLE_KEY is configured.
 * Results are merged and the HIGHEST valid level wins.
 */
async function resolveDbLevel(userId: string, rawToken: string): Promise<AccessLevel> {
  let level: AccessLevel = 'expired';

  const applyUserRow = (u: any) => {
    if (!u) return;
    if (u.is_deleted === true || String(u.status || '').toLowerCase() === 'disabled') return;
    const roleLevel = levelFromTier(u.role);
    if (roleLevel && roleLevel !== 'trial' && windowOpen(u.valid_until, true)) {
      level = maxLevel(level, roleLevel);
    }
  };

  const applySubscription = (s: any) => {
    if (!s) return;
    if (String(s.status || '').toLowerCase() !== 'active') return;
    const subLevel = levelFromTier(s.tier);
    if (subLevel && subLevel !== 'trial' && windowOpen(s.current_period_end, true)) {
      level = maxLevel(level, subLevel);
    }
  };

  const applyEntitlement = (e: any) => {
    if (!e) return;
    const feats = e.features || {};
    const tierLevel = levelFromTier(e.tier);
    if (tierLevel === 'trial') {
      // Explicit admin-granted / extended trial window
      if (windowOpen(e.valid_until, false)) level = maxLevel(level, 'trial');
    } else if (tierLevel) {
      // Paid tiers: open-ended entitlement is treated as active; dated ones must be in the future
      if (windowOpen(e.valid_until, true)) level = maxLevel(level, tierLevel);
    }
    // Feature-flag grants are always time-boxed
    if (windowOpen(e.valid_until, false)) {
      if (feats.admin === true) level = maxLevel(level, 'admin');
      if (feats.bigbang === true || feats.vip === true || feats.all_sports === true) {
        level = maxLevel(level, 'vip');
      }
      if (
        feats.football_predictions === true ||
        feats.specialist_markets === true ||
        feats.goals === true ||
        feats.corners === true ||
        feats.trial === true
      ) {
        level = maxLevel(level, 'trial');
      }
    }
  };

  const tasks: Promise<void>[] = [];

  // 1. SECURITY DEFINER bootstrap RPC (user's own token)
  tasks.push(
    (async () => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_session_bootstrap`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${rawToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ p_user_id: userId }),
        });
        if (!res.ok) return;
        const data = await safeJson(res);
        if (!data || typeof data !== 'object') return;
        applyUserRow(data.user);
        applySubscription(data.subscription);
        applyEntitlement(data.entitlement);
      } catch (err) {
        console.warn('Edge bootstrap RPC check failed:', err);
      }
    })()
  );

  // 2. Service-role direct reads (full history, bypass RLS)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    const svcHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: 'application/json',
    };
    const read = async (path: string, apply: (row: any) => void) => {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: svcHeaders });
        if (!res.ok) return;
        const rows = await safeJson(res);
        if (Array.isArray(rows)) rows.forEach(apply);
      } catch (err) {
        console.warn('Edge service-role check failed:', path, err);
      }
    };
    tasks.push(read(`users?id=eq.${userId}&select=role,status,is_deleted&limit=1`, applyUserRow));
    tasks.push(
      read(
        `subscriptions?user_id=eq.${userId}&status=eq.active&select=tier,status,current_period_end&order=created_at.desc&limit=10`,
        applySubscription
      )
    );
    tasks.push(
      read(
        `entitlements?user_id=eq.${userId}&select=tier,valid_until,features&order=created_at.desc&limit=10`,
        applyEntitlement
      )
    );
  }

  await Promise.all(tasks);
  return level;
}

/**
 * Tier-aware edge access resolver.
 * The JWT payload is NEVER trusted on its own: every non-trivial token is validated
 * against Supabase Auth (/auth/v1/user, ES256/HS256 agnostic), and only server-controlled
 * data (app_metadata, DB rows, ADMIN_EMAILS, verified account creation date) grants access.
 */
export async function verifyEdgeAccess(authToken: string | null): Promise<AccessLevel> {
  if (!authToken) return 'visitor';
  const rawToken = authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken.trim();
  if (!rawToken || rawToken.length < 10) return 'visitor';

  // 1. Direct Service Role Key Match (internal cron/admin backend workers)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && rawToken === serviceKey) {
    return 'admin';
  }

  // 2. Check In-Memory Edge Cache (0ms response)
  const cached = accessCache.get(rawToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.level;
  }

  // 3. Promise deduplication: Thundering herd protection for concurrent user requests
  const inflight = inflightAccessChecks.get(rawToken);
  if (inflight) {
    return inflight;
  }

  const store = (level: AccessLevel, userId?: string, email?: string): AccessLevel => {
    const ttl =
      level === 'visitor' ? INVALID_AUTH_TTL_MS : level === 'expired' ? EXPIRED_AUTH_TTL_MS : VALID_AUTH_TTL_MS;
    accessCache.set(rawToken, { level, userId, email, expiresAt: Date.now() + ttl });
    return level;
  };

  const checkPromise = (async (): Promise<AccessLevel> => {
    try {
      // 4. Structural Token Parse & Expiration Check (0ms, Zero-Network)
      const parts = rawToken.split('.');
      if (parts.length !== 3) return store('visitor');

      const payload = decodeBase64UrlJson(parts[1]);
      if (!payload || typeof payload !== 'object') return store('visitor');

      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSec) return store('visitor');

      // The public anon key is a JWT too, but it identifies nobody.
      if (payload.role === 'anon' || !payload.sub) return store('visitor');

      // 5. Authoritative verification against Supabase Auth (works for ES256 and HS256 keys)
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${rawToken}`,
        },
      });
      if (!authRes.ok) return store('visitor');

      const authUser = await safeJson(authRes);
      if (!authUser || !authUser.id) return store('visitor');

      const verifiedEmail = String(authUser.email || '').toLowerCase().trim();

      // 6. Admin: whitelist or server-controlled app_metadata (user_metadata is user-editable -> ignored)
      const appRole = String(authUser.app_metadata?.role || '').toLowerCase();
      if ((verifiedEmail && ADMIN_EMAILS.has(verifiedEmail)) || appRole === 'admin') {
        return store('admin', authUser.id, verifiedEmail);
      }

      let level: AccessLevel = 'expired';
      level = maxLevel(level, levelFromTier(appRole) === 'trial' ? null : levelFromTier(appRole));

      // 7. Database tiers (admin role, BigBang VIP, Standard, explicit trial grants)
      if (level !== 'vip') {
        level = maxLevel(level, await resolveDbLevel(authUser.id, rawToken));
      }

      // 8. 3-Day Free Trial: first 72h after the email was confirmed (Google sign-ins arrive confirmed).
      //    Same start as public.is_football_entitled(). Works with or without DB rows.
      const trialStart = authUser.email_confirmed_at || authUser.created_at;
      if (LEVEL_RANK[level] < LEVEL_RANK.trial && trialStart) {
        const createdMs = new Date(trialStart).getTime();
        if (Number.isFinite(createdMs) && Date.now() - createdMs < TRIAL_DURATION_MS) {
          level = 'trial';
        }
      }

      return store(level, authUser.id, verifiedEmail);
    } catch (err) {
      console.error('Edge auth verification error:', err);
      return 'visitor';
    } finally {
      inflightAccessChecks.delete(rawToken);
    }
  })();

  inflightAccessChecks.set(rawToken, checkPromise);
  return checkPromise;
}

/** Football scope (general, 1H Blitz, Over 2.5, Corners): trial + standard + vip + admin. */
export function hasFootballAccess(level: AccessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK.trial;
}

/** Multi-sport scope (tennis, basketball, ...): BigBang VIP + admin ONLY. */
export function hasMultiSportAccess(level: AccessLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK.vip;
}

/**
 * Backward-compatible football-scope status used by the football feeds
 * (predictions-feed, goals-feed, market-feed).
 */
export async function verifyEdgeAuth(authToken: string | null): Promise<AuthStatus> {
  const level = await verifyEdgeAccess(authToken);
  if (hasFootballAccess(level)) return 'paid_or_trial';
  return level === 'expired' ? 'expired' : 'visitor';
}
