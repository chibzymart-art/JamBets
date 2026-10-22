// Live, read-only probe of production as a logged-out visitor.
// Uses only the public anon key (the same one shipped in the website bundle). Sends no email and
// writes nothing. Run: node tests/edge/live-anon-probe.mjs   (optional: SITE=https://preview-url)
const SUPABASE = process.env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const ANON = process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SITE = process.env.SITE || 'https://www.oddsbanta.com';
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: 'count=exact' };

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};
const total = (res) => Number((res.headers.get('content-range') || '*/0').split('/')[1] || 0);

// Tables: no rows for a visitor.
for (const t of ['corner_predictions', 'football_simulations', 'system_jobs', 'goals_predictions', 'tennis_predictions',
  'basketball_predictions', 'users', 'subscriptions', 'entitlements', 'payments', 'audit_logs', 'admin_tasks']) {
  const r = await fetch(`${SUPABASE}/rest/v1/${t}?select=*&limit=1`, { headers: H });
  check(`anon reads no ${t}`, r.status >= 400 || total(r) === 0, `${r.status} rows=${total(r)}`);
}

// Football: settled wins only, never an open pick.
{
  const r = await fetch(`${SUPABASE}/rest/v1/football_predictions?select=id&settlement_status=eq.pending&limit=1`, { headers: H });
  check('anon reads no open football picks', r.status >= 400 || total(r) === 0, `${r.status} rows=${total(r)}`);
}

// Views and retired tables: refused.
for (const v of ['goals_predictions_paywall', 'corner_predictions_paywall', 'tennis_predictions_paywall',
  'basketball_predictions_paywall', 'football_prediction_queue', 'football_prediction_teasers',
  'home_win_predictions', 'away_win_predictions', 'draw_predictions']) {
  const r = await fetch(`${SUPABASE}/rest/v1/${v}?select=*&limit=1`, { headers: H });
  check(`anon refused on ${v}`, r.status === 401 || r.status === 403 || r.status === 404, String(r.status));
}

// Admin and analytics functions: refused.
for (const fn of ['admin_engine_telemetry', 'get_platform_analytics', 'get_system_health', 'admin_get_users']) {
  const r = await fetch(`${SUPABASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}' });
  check(`anon refused on rpc ${fn}`, r.status >= 400, String(r.status));
}

// Website API: email endpoints need a signed-in caller; the old reset-link endpoint is gone.
const post = (path, body) => fetch(`${SITE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
check('welcome email refused without sign-in', (await post('/api/send-welcome-email', { email: 'probe@example.com' })).status === 401);
check('subscription email refused without sign-in', (await post('/api/send-subscription-email', { email: 'probe@example.com' })).status === 401);
check('reset-link minting retired', (await post('/api/send-password-reset-email', { email: 'probe@example.com', type: 'reset_request' })).status === 410);

// Feeds: every open pick a visitor receives is locked.
for (const feed of ['/api/predictions-feed', '/api/tennis-feed', '/api/basketball-feed']) {
  const r = await fetch(`${SITE}${feed}`);
  const j = await r.json().catch(() => ({}));
  const open = (j.predictions || []).filter((p) => !p.is_locked && p.settlement_status === 'pending');
  check(`${feed}: no unlocked open picks for a visitor`, r.ok && open.length === 0, `${r.status} unlocked=${open.length}`);
}
{
  const r = await fetch(`${SITE}/api/market-feed?market=corners`);
  const j = await r.json().catch(() => ({}));
  check('market feed: visitor gets counts, not rows', r.ok && (j.predictions || []).length === 0, `${r.status} rows=${(j.predictions || []).length}`);
  check('market feed: no retired market keys', j.counts && !('draw' in j.counts) && !('home_win' in j.counts) && !('away_win' in j.counts), JSON.stringify(j.counts));
}

console.log(failures ? `\n${failures} FAILED` : '\nLIVE ANON PROBE: ALL PASSED');
process.exit(failures ? 1 : 0);
