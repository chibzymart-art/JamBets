/**
 * Unsubscribe from Oddsbanta lifecycle / daily results emails.
 *
 *   GET  /api/unsubscribe?token=...&scope=daily|lifecycle|all  -> confirmation page with a button
 *   POST /api/unsubscribe?token=...&scope=...                  -> unsubscribes (button, or the
 *        RFC 8058 one-click POST that Gmail/Yahoo send for the List-Unsubscribe header)
 *
 * GET never changes anything, so link scanners that open every URL in an email can't unsubscribe
 * people. The token is the random email_preferences.unsubscribe_token written by the email job
 * (python/src/email_engine/lifecycle.py); it identifies the row and nothing else. The row is read and
 * written with the service role because the table has no Data API grants.
 */
export const config = {
  runtime: 'edge',
};

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';

type Scope = 'daily' | 'lifecycle' | 'all';

const SCOPE_TEXT: Record<Scope, { ask: string; done: string }> = {
  daily: { ask: 'Stop the daily results email?', done: "You won't get the daily results email any more." },
  lifecycle: { ask: 'Stop plan and trial reminders?', done: "You won't get plan and trial reminders any more." },
  all: { ask: 'Stop all Oddsbanta marketing and reminder emails?', done: "You won't get Oddsbanta marketing or reminder emails any more." },
};

const TOKEN_RE = /^[a-f0-9]{36}$/;

function page(title: string, body: string, status = 200): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head>
<body style="margin:0;background:#090d16;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<main style="max-width:480px;margin:64px auto;padding:32px 24px;background:#0f172a;border:1px solid #1e293b;border-radius:14px;">
<div style="font-size:22px;font-weight:900;color:#fff;margin-bottom:18px;">ODDS<span style="color:#10b981;">BANTA</span></div>
${body}
</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}

const btn =
  'display:inline-block;margin:6px 8px 6px 0;padding:11px 18px;border:0;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;';

function confirmPage(token: string, scope: Scope): Response {
  const action = (s: Scope) => `/api/unsubscribe?token=${token}&scope=${s}`;
  const allButton =
    scope === 'all'
      ? ''
      : `<form method="post" action="${action('all')}" style="display:inline"><button style="${btn}background:#1e293b;color:#e2e8f0;">Unsubscribe from everything</button></form>`;
  return page(
    'Unsubscribe',
    `<h1 style="font-size:20px;color:#fff;margin:0 0 12px;">${SCOPE_TEXT[scope].ask}</h1>
<p style="color:#94a3b8;line-height:1.6;margin:0 0 18px;">Account emails such as password resets and payment receipts will still arrive.</p>
<form method="post" action="${action(scope)}" style="display:inline"><button style="${btn}background:#10b981;color:#04211a;">Unsubscribe</button></form>${allButton}`
  );
}

async function applyUnsubscribe(token: string, scope: Scope): Promise<'ok' | 'not_found' | 'error'> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) return 'error';
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (scope === 'daily' || scope === 'all') patch.daily_results = false;
  if (scope === 'lifecycle' || scope === 'all') patch.lifecycle = false;
  if (scope === 'all') patch.unsubscribed_all_at = now;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/email_preferences?unsubscribe_token=eq.${token}`, {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return 'error';
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) && rows.length > 0 ? 'ok' : 'not_found';
  } catch {
    return 'error';
  }
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = (url.searchParams.get('token') || '').toLowerCase();
  const rawScope = url.searchParams.get('scope') || 'all';
  const scope: Scope = rawScope === 'daily' || rawScope === 'lifecycle' ? rawScope : 'all';

  if (!TOKEN_RE.test(token)) {
    return page('Link not valid', '<p style="line-height:1.6;">This unsubscribe link is not valid. Reply to any Oddsbanta email and we will take you off the list.</p>', 400);
  }

  if (req.method === 'GET' || req.method === 'HEAD') return confirmPage(token, scope);
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const result = await applyUnsubscribe(token, scope);
  if (result === 'error') {
    return page('Something went wrong', '<p style="line-height:1.6;">We could not update your settings just now. Please try again in a minute.</p>', 500);
  }
  if (result === 'not_found') {
    return page('Link not valid', '<p style="line-height:1.6;">We could not find this subscription. It may already have been removed.</p>', 404);
  }
  return page(
    'Unsubscribed',
    `<h1 style="font-size:20px;color:#fff;margin:0 0 12px;">You're unsubscribed</h1><p style="color:#94a3b8;line-height:1.6;margin:0;">${SCOPE_TEXT[scope].done}</p>`
  );
}
