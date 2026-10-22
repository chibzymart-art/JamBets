// Behaviour test for the Telegram bot paywall (Phase 0, AZT-01).
// Runs the real webhook handler against a mocked Supabase and Telegram API, one chat per account
// type, and checks who gets picks and who gets the upgrade message.
// Run: node tests/edge/run.mjs
import './telegram-env';
import webhook from '../../api/telegram-webhook';

const future = new Date(Date.now() + 10 * 864e5).toISOString();
const past = new Date(Date.now() - 10 * 864e5).toISOString();

// chat id -> linked account and its rows
const accounts: Record<number, { user: any; subs: any[]; ents: any[] }> = {
  1: { user: { id: 'u-free', email: 'free@example.com', role: 'free' }, subs: [{ tier: 'free', status: 'active', current_period_end: null }], ents: [{ tier: 'free', valid_until: null, features: {} }] },
  2: { user: { id: 'u-std', email: 'std@example.com', role: 'standard' }, subs: [{ tier: 'standard', status: 'active', current_period_end: future }], ents: [] },
  3: { user: { id: 'u-exp', email: 'exp@example.com', role: 'free' }, subs: [{ tier: 'standard', status: 'active', current_period_end: past }], ents: [] },
  4: { user: { id: 'u-vip', email: 'vip@example.com', role: 'free' }, subs: [], ents: [{ tier: 'bigbang', valid_until: future, features: {} }] },
  5: { user: { id: 'u-oldent', email: 'old@example.com', role: 'free' }, subs: [], ents: [{ tier: 'bigbang', valid_until: past, features: {} }] },
  6: { user: { id: 'u-trial', email: 'trial@example.com', role: 'free' }, subs: [{ tier: 'trial', status: 'active', current_period_end: future }], ents: [{ tier: 'trial', valid_until: future, features: {} }] },
};

const sent: Record<number, string[]> = {};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const param = (url: URL, key: string) => (url.searchParams.get(key) || '').replace(/^eq\./, '');

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = new URL(String(typeof input === 'string' ? input : input.url));
  if (url.hostname === 'api.telegram.org') {
    const body = JSON.parse(init?.body || '{}');
    (sent[body.chat_id] ||= []).push(String(body.text || ''));
    return json({ ok: true, result: {} });
  }
  if (url.pathname.endsWith('/rest/v1/users')) {
    const chat = Number(param(url, 'telegram_chat_id'));
    return json(accounts[chat] ? [accounts[chat].user] : []);
  }
  const owner = Object.values(accounts).find((a) => a.user.id === param(url, 'user_id'));
  if (url.pathname.endsWith('/rest/v1/subscriptions')) {
    let rows = owner ? owner.subs : [];
    const status = param(url, 'status');
    if (status) rows = rows.filter((r) => r.status === status);
    const tierIn = (url.searchParams.get('tier') || '').match(/^in\.\((.*)\)$/);
    if (tierIn) rows = rows.filter((r) => tierIn[1].split(',').includes(r.tier));
    return json(rows);
  }
  if (url.pathname.endsWith('/rest/v1/entitlements')) return json(owner ? owner.ents.slice(0, 1) : []);
  if (url.pathname.includes('/rest/v1/')) return json([]); // predictions: none today, fine for this test
  return json({}, 404);
};

const send = (chatId: number, text: string, secret = 'test-webhook-secret') =>
  webhook(new Request('https://www.oddsbanta.com/api/telegram-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({ update_id: chatId, message: { message_id: 1, chat: { id: chatId, type: 'private' }, from: { id: chatId, username: 'u' + chatId }, text } }),
  }));

let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`); if (!ok) failed++; };
const gotUpgrade = (chat: number) => (sent[chat] || []).some((t) => /VIP Access Required/.test(t));

check('webhook: wrong secret refused', (await send(1, '/today', 'wrong')).status === 401);

for (const [chat, label, expectPaid] of [
  [1, 'free account (active "free" subscription row)', false],
  [2, 'Standard, period open', true],
  [3, 'Standard, period ended', false],
  [4, 'BigBang entitlement, open', true],
  [5, 'BigBang entitlement, expired', false],
  [6, 'trial rows', false],
] as [number, string, boolean][]) {
  await send(chat, '/today');
  check(`${label}: ${expectPaid ? 'gets picks' : 'gets the upgrade message'}`, gotUpgrade(chat) === !expectPaid, JSON.stringify(sent[chat]).slice(0, 160));
}

await send(99, '/today');
check('unlinked chat: asked to link first', (sent[99] || []).some((t) => /Authentication Required/.test(t)), JSON.stringify(sent[99]));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nTELEGRAM BOT: ALL PASSED');
