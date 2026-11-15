// Banter Hub push sender.
//
// GET  /api/banter-push            -> { enabled, publicKey } (the VAPID public key the browser subscribes with)
// POST /api/banter-push {kind,id}  -> sends push notifications for one new message or event
//   kind: 'reply' (Discussion reply id) | 'post' (league wall post id) | 'join' (league id just joined)
//         | 'reaction' (a reaction id: the message's writer is notified)
//   Authorization: Bearer <the member's Supabase access token>
//
// The token is checked against Supabase Auth (never trusted on its own). Recipients, text and links
// come from public.banter_push_targets() (service role only), which also confirms the caller wrote
// that message in the last 10 minutes and sends each message at most once. Dead subscriptions
// (404 / 410 from the push service) are deleted. Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (optional, defaults to mailto:support@oddsbanta.com), SUPABASE_SERVICE_ROLE_KEY.

import { sendWebPush, type SendResult, type VapidKeys } from './_lib/webpush';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ALLOWED_ORIGINS = new Set([
  'https://www.oddsbanta.com',
  'https://oddsbanta.com',
  'http://localhost:5173',
  'http://localhost:3000',
]);

const KINDS = new Set(['reply', 'post', 'join', 'reaction']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-instance burst limit on top of the database guards (one push per message, 120 per hour).
const recent = new Map<string, number[]>();
function allow(userId: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now();
  const list = (recent.get(userId) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) { recent.set(userId, list); return false; }
  list.push(now);
  recent.set(userId, list);
  if (recent.size > 5000) recent.clear();
  return true;
}

function headers(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const h: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
  if (ALLOWED_ORIGINS.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (req: Request, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: headers(req) });

function vapid(): VapidKeys | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.VAPID_PRIVATE_KEY || '';
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: process.env.VAPID_SUBJECT || 'mailto:support@oddsbanta.com' };
}

async function verifyUser(token: string): Promise<string | null> {
  if (!token || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const user = (await res.json()) as { id?: string };
    return user && typeof user.id === 'string' && UUID.test(user.id) ? user.id : null;
  } catch {
    return null;
  }
}

async function serviceRpc<T>(fn: string, args: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: T | null }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  return { ok: true, status: res.status, data: (await res.json()) as T };
}

interface Target {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(req) });

  const keys = vapid();
  if (req.method === 'GET') {
    return json(req, 200, { enabled: !!keys && !!SERVICE_KEY, publicKey: keys ? keys.publicKey : null });
  }
  if (req.method !== 'POST') return json(req, 405, { error: 'method_not_allowed' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const userId = await verifyUser(token);
  if (!userId) return json(req, 401, { error: 'not_signed_in' });

  let kind = '';
  let id = '';
  try {
    const body = (await req.json()) as { kind?: unknown; id?: unknown };
    kind = typeof body.kind === 'string' ? body.kind : '';
    id = typeof body.id === 'string' ? body.id : '';
  } catch {
    return json(req, 400, { error: 'bad_request' });
  }
  if (!KINDS.has(kind) || !UUID.test(id)) return json(req, 400, { error: 'bad_request' });

  if (!keys || !SERVICE_KEY) return json(req, 200, { sent: 0, reason: 'not_configured' });
  if (!allow(userId)) return json(req, 429, { error: 'too_many_requests' });

  const targets = await serviceRpc<Target[]>('banter_push_targets', { p_sender: userId, p_kind: kind, p_id: id });
  if (!targets.ok) {
    // 404: the push database change is not applied yet.
    return json(req, 200, { sent: 0, reason: targets.status === 404 ? 'not_ready' : 'lookup_failed' });
  }
  const list = (targets.data || []).slice(0, 1000);
  if (list.length === 0) return json(req, 200, { sent: 0 });

  const results: SendResult[] = [];
  for (let i = 0; i < list.length; i += 25) {
    const chunk = list.slice(i, i + 25);
    results.push(
      ...(await Promise.all(
        chunk.map((t) =>
          sendWebPush(
            { endpoint: t.endpoint, p256dh: t.p256dh, auth: t.auth },
            { title: t.title, body: t.body, url: t.url, tag: t.tag },
            keys,
            { urgency: kind === 'join' ? 'normal' : 'high' },
          ),
        ),
      )),
    );
  }

  const ok = results.filter((r) => r.ok).map((r) => r.endpoint);
  const gone = results.filter((r) => r.gone).map((r) => r.endpoint);
  if (ok.length || gone.length) {
    await serviceRpc<number>('banter_push_results', { p_ok: ok, p_gone: gone }).catch(() => null);
  }
  return json(req, 200, { sent: ok.length, removed: gone.length, failed: results.length - ok.length - gone.length });
}
