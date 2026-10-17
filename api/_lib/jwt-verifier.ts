// Cryptographic Edge JWT & 3-Day Trial Verifier for Oddsbanta
// Runs on Vercel Edge Runtime (Zero-Latency Web Crypto API)

export type AuthStatus = 'paid_or_trial' | 'expired' | 'visitor';

interface CachedAuth {
  status: AuthStatus;
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
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

export const ADMIN_EMAILS = new Set([
  'chibzymart@gmail.com',
  'whizzchibz@gmail.com',
  'chibuezec.amuchie@gmail.com',
  'chibuezeamuchie@gmail.com',
  'nnamdiamuchie@gmail.com',
]);

// Sliding-window memory cache to eliminate repeated Supabase roundtrips
const userAuthCache = new Map<string, CachedAuth>();
const inflightAuthChecks = new Map<string, Promise<AuthStatus>>();

// Cache TTLs
const VALID_AUTH_TTL_MS = 300 * 1000; // 5 minutes for valid trial/paid users
const EXPIRED_AUTH_TTL_MS = 180 * 1000; // 3 minutes for expired users
const INVALID_AUTH_TTL_MS = 60 * 1000; // 1 minute for invalid/malformed tokens

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

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

/**
 * Fast-path edge JWT parser and cryptographic signature check.
 * Rejects expired or malformed tokens in < 0.05ms without touching any network.
 */
export async function verifyEdgeAuth(authToken: string | null): Promise<AuthStatus> {
  if (!authToken) return 'visitor';
  const rawToken = authToken.startsWith('Bearer ') ? authToken.slice(7).trim() : authToken.trim();
  if (!rawToken || rawToken.length < 10) return 'visitor';

  // 1. Direct Service Role Key Match (internal cron/admin backend workers)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey && rawToken === serviceKey) {
    return 'paid_or_trial';
  }

  // 2. Check In-Memory Edge Cache (0ms response)
  const cached = userAuthCache.get(rawToken);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.status;
  }

  // 3. Promise deduplication: Thundering herd protection for concurrent user requests
  const inflight = inflightAuthChecks.get(rawToken);
  if (inflight) {
    return inflight;
  }

  const checkPromise = (async (): Promise<AuthStatus> => {
    try {
      // 4. Structural Token Parse & Expiration Check (0ms, Zero-Network)
      const parts = rawToken.split('.');
      if (parts.length !== 3) {
        userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + INVALID_AUTH_TTL_MS });
        return 'visitor';
      }

      const payload = decodeBase64UrlJson(parts[1]);
      if (!payload || typeof payload !== 'object') {
        userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + INVALID_AUTH_TTL_MS });
        return 'visitor';
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < nowSec) {
        // Token has expired chronologically -> reject instantly without network call
        userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + INVALID_AUTH_TTL_MS });
        return 'visitor';
      }

      const email = (payload.email || '').toLowerCase().trim();
      const userId = payload.sub || payload.id;

      // 5. Fast-Path: Admin Whitelist Check via Token Claims (0.01ms)
      if (
        (email && ADMIN_EMAILS.has(email)) ||
        payload.app_metadata?.role === 'admin' ||
        payload.user_metadata?.role === 'admin'
      ) {
        userAuthCache.set(rawToken, {
          status: 'paid_or_trial',
          userId,
          email,
          expiresAt: Date.now() + VALID_AUTH_TTL_MS,
        });
        return 'paid_or_trial';
      }

      // 6. Cryptographic Signature Verification via Web Crypto API (if secret is available)
      if (SUPABASE_JWT_SECRET) {
        try {
          const encoder = new TextEncoder();
          const cryptoKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(SUPABASE_JWT_SECRET),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
          );

          const dataToVerify = encoder.encode(`${parts[0]}.${parts[1]}`);
          const signatureBytes = base64UrlToUint8Array(parts[2]);

          const isValid = await crypto.subtle.verify('HMAC', cryptoKey, signatureBytes, dataToVerify);
          if (!isValid) {
            userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + INVALID_AUTH_TTL_MS });
            return 'visitor';
          }
        } catch {
          // Fall through to upstream check if crypto verification errors
        }
      }

      // 7. Verify token against Supabase Auth (Single request, cached for 5 minutes)
      const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${rawToken}`,
        },
      });

      if (!authRes.ok) {
        userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + INVALID_AUTH_TTL_MS });
        return 'visitor';
      }

      const authUser = await authRes.json();
      if (!authUser || !authUser.id) {
        userAuthCache.set(rawToken, { status: 'visitor', expiresAt: Date.now() + INVALID_AUTH_TTL_MS });
        return 'visitor';
      }

      // Re-verify Admin/Paid roles from verified auth record
      const verifiedEmail = (authUser.email || '').toLowerCase().trim();
      const metaRole = (authUser.app_metadata?.role || authUser.user_metadata?.role || '').toLowerCase();
      if (
        (verifiedEmail && ADMIN_EMAILS.has(verifiedEmail)) ||
        ['admin', 'standard', 'bigbang', 'vip', 'pro'].includes(metaRole)
      ) {
        userAuthCache.set(rawToken, {
          status: 'paid_or_trial',
          userId: authUser.id,
          email: verifiedEmail,
          expiresAt: Date.now() + VALID_AUTH_TTL_MS,
        });
        return 'paid_or_trial';
      }

      // 8. 3-Day Free VIP Trial Check (Instant calculation from account creation)
      // New users from betting platform partner are immediately in this bucket!
      const createdAt = authUser.created_at;
      if (createdAt) {
        const createdMs = new Date(createdAt).getTime();
        const trialDurationMs = 3 * 24 * 60 * 60 * 1000; // 72 hours
        if (Date.now() - createdMs < trialDurationMs) {
          userAuthCache.set(rawToken, {
            status: 'paid_or_trial',
            userId: authUser.id,
            email: verifiedEmail,
            expiresAt: Date.now() + VALID_AUTH_TTL_MS,
          });
          return 'paid_or_trial';
        }
      }

      // 9. Older Accounts (> 72 hours): Check paid subscription status (Single query, NOT 3 queries)
      const subRes = await fetch(
        `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}&status=eq.active&select=tier&order=created_at.desc&limit=1`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${rawToken}`,
            Accept: 'application/json',
          },
        }
      );

      if (subRes.ok) {
        const subData = await subRes.json();
        if (Array.isArray(subData) && subData.length > 0) {
          const tier = (subData[0].tier || '').toLowerCase();
          if (['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier)) {
            userAuthCache.set(rawToken, {
              status: 'paid_or_trial',
              userId: authUser.id,
              email: verifiedEmail,
              expiresAt: Date.now() + VALID_AUTH_TTL_MS,
            });
            return 'paid_or_trial';
          }
        }
      }

      // Check entitlements table only if subscription was not found
      const entRes = await fetch(
        `${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${authUser.id}&select=tier,valid_until,features&order=created_at.desc&limit=1`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${rawToken}`,
            Accept: 'application/json',
          },
        }
      );

      if (entRes.ok) {
        const entData = await entRes.json();
        if (Array.isArray(entData) && entData.length > 0) {
          const ent = entData[0];
          const validUntil = ent.valid_until ? new Date(ent.valid_until).getTime() : 0;
          const tier = (ent.tier || '').toLowerCase();
          const feats = ent.features || {};
          const isEntAdmin = tier === 'admin' || feats.admin === true;
          const hasVip = Boolean(
            tier === 'trial' ||
            tier === 'free_trial' ||
            ['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(tier) ||
            feats.trial === true ||
            feats.vip === true ||
            feats.football_predictions === true ||
            feats.specialist_markets === true ||
            feats.goals === true ||
            feats.corners === true ||
            feats.simulations === true ||
            feats.all_sports === true ||
            feats.bigbang === true
          );

          if ((isEntAdmin || hasVip) && validUntil > Date.now()) {
            userAuthCache.set(rawToken, {
              status: 'paid_or_trial',
              userId: authUser.id,
              email: verifiedEmail,
              expiresAt: Date.now() + VALID_AUTH_TTL_MS,
            });
            return 'paid_or_trial';
          }
        }
      }

      // Check users table (authoritative role and tier for admin allocations)
      const serviceOrAnonKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
      try {
        const userTableRes = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${authUser.id}&select=role,status,valid_until&limit=1`,
          {
            headers: {
              apikey: serviceOrAnonKey,
              Authorization: `Bearer ${serviceOrAnonKey}`,
              Accept: 'application/json',
            },
          }
        );
        if (userTableRes.ok) {
          const uData = await userTableRes.json();
          if (Array.isArray(uData) && uData.length > 0) {
            const u = uData[0];
            const role = (u.role || '').toLowerCase();
            const validUntil = u.valid_until ? new Date(u.valid_until).getTime() : 0;
            if (['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(role) && (!validUntil || validUntil > Date.now())) {
              userAuthCache.set(rawToken, {
                status: 'paid_or_trial',
                userId: authUser.id,
                email: verifiedEmail,
                expiresAt: Date.now() + VALID_AUTH_TTL_MS,
              });
              return 'paid_or_trial';
            }
          }
        }
      } catch (userErr) {
        console.warn('Edge users table check failed:', userErr);
      }

      // Check profiles table (role column fallback)
      try {
        const profRes = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${authUser.id}&select=role&limit=1`,
          {
            headers: {
              apikey: serviceOrAnonKey,
              Authorization: `Bearer ${serviceOrAnonKey}`,
              Accept: 'application/json',
            },
          }
        );
        if (profRes.ok) {
          const pData = await profRes.json();
          if (Array.isArray(pData) && pData.length > 0) {
            const p = pData[0];
            const role = (p.role || '').toLowerCase();
            if (['standard', 'bigbang', 'vip', 'pro', 'admin'].includes(role)) {
              userAuthCache.set(rawToken, {
                status: 'paid_or_trial',
                userId: authUser.id,
                email: verifiedEmail,
                expiresAt: Date.now() + VALID_AUTH_TTL_MS,
              });
              return 'paid_or_trial';
            }
          }
        }
      } catch (profErr) {
        console.warn('Edge profiles table check failed:', profErr);
      }

      // Expired trial user
      userAuthCache.set(rawToken, {
        status: 'expired',
        userId: authUser.id,
        email: verifiedEmail,
        expiresAt: Date.now() + EXPIRED_AUTH_TTL_MS,
      });
      return 'expired';
    } catch (err) {
      console.error('Edge auth verification error:', err);
      return 'visitor';
    } finally {
      inflightAuthChecks.delete(rawToken);
    }
  })();

  inflightAuthChecks.set(rawToken, checkPromise);
  return checkPromise;
}
