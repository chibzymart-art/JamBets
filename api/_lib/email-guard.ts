// Caller checks for the transactional email endpoints (welcome, subscription, password notice).
//
// These endpoints send mail from the oddsbanta.com domain through Resend, so an open endpoint is a
// free spam and phishing relay. Every caller must prove who they are with a Supabase access token:
//   - verifyEmailCaller() validates the token against Supabase Auth (/auth/v1/user), never trusting
//     the JWT payload on its own, and reports the verified email and whether the caller is an admin.
//   - The service role key is accepted as an internal caller (webhooks, cron).
// CORS is limited to Oddsbanta origins. CORS is not a security boundary (curl ignores it); the
// token check is what protects the endpoint.

import { ADMIN_EMAILS } from './jwt-verifier';

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';

const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

const ALLOWED_ORIGINS = new Set([
  'https://www.oddsbanta.com',
  'https://oddsbanta.com',
  'http://localhost:5173',
  'http://localhost:3000',
]);

export function emailCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export interface EmailCaller {
  kind: 'service' | 'user';
  userId?: string;
  email?: string;
  createdAt?: string;
  appMetadata?: Record<string, unknown>;
  isAdmin: boolean;
}

function bearer(req: Request): string {
  const raw = req.headers.get('authorization') || '';
  return raw.startsWith('Bearer ') ? raw.slice(7).trim() : '';
}

/** Returns the verified caller, or null when the request carries no valid token. */
export async function verifyEmailCaller(req: Request): Promise<EmailCaller | null> {
  const token = bearer(req);
  if (!token || token.length < 20) return null;

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (serviceKey && token === serviceKey) return { kind: 'service', isAdmin: true };

  const apikey = SUPABASE_ANON_KEY || token;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    if (!user || !user.id) return null;

    const email = String(user.email || '').trim().toLowerCase();
    let isAdmin = (email !== '' && ADMIN_EMAILS.has(email)) || String(user.app_metadata?.role || '').toLowerCase() === 'admin';

    if (!isAdmin) {
      // Same check the database uses for the Admin panel functions.
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
        method: 'POST',
        headers: { apikey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => null);
      if (rpc && rpc.ok) isAdmin = (await rpc.json().catch(() => false)) === true;
    }

    return { kind: 'user', userId: user.id, email, createdAt: user.created_at, appMetadata: user.app_metadata || {}, isAdmin };
  } catch (err) {
    console.error('[EMAIL-GUARD] caller verification failed');
    return null;
  }
}

export function jsonError(status: number, error: string, headers: Record<string, string>): Response {
  return new Response(JSON.stringify({ success: false, error }), { status, headers });
}
