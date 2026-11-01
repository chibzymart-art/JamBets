// Behaviour test for the Bachs payment webhook.
// Replays the event pairs Bachs actually sends (checkout.completed + collection.succeeded for one
// charge, ~40 ms apart) against an in-memory Supabase and checks the plan is granted exactly once.
// Run: node tests/edge/run.mjs
import webhook from '../../api/webhooks/bachs';
import { createHmac } from 'node:crypto';

const SECRET = 'whsec_test_only';
process.env.BACHS_WEBHOOK_SECRET = SECRET;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests-only-0000';
process.env.RESEND_API_KEY = '';

type Row = Record<string, any>;
let db: Record<string, Row[]>;
let failNext: string | null = null;
const reset = () => {
  db = {
    users: [{ id: 'u1', email: 'payer@example.com', role: 'free' }],
    subscriptions: [{ user_id: 'u1', tier: 'free', status: 'active', current_period_end: null, cancel_at_period_end: false }],
    entitlements: [{ user_id: 'u1', tier: 'free', valid_until: null, features: {} }],
    payments: [],
    webhook_events_log: [],
  };
  failNext = null;
};

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const UNIQUE: Record<string, string> = { payments: 'bachs_payment_id', webhook_events_log: 'event_id', subscriptions: 'user_id', entitlements: 'user_id' };

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = new URL(String(typeof input === 'string' ? input : input.url));
  if (url.hostname === 'api.resend.com') return json({ id: 'msg' });
  const table = url.pathname.split('/rest/v1/')[1];
  if (!table || !(table in db)) throw new Error('unexpected fetch ' + url);
  await new Promise((r) => setTimeout(r, Math.random() * 5)); // interleave concurrent events
  const method = (init?.method || 'GET').toUpperCase();
  if (failNext === `${method} ${table}`) {
    failNext = null;
    return json({ message: 'boom' }, 500);
  }
  const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'limit', 'on_conflict', 'order'].includes(k));
  const match = (r: Row) => filters.every(([k, v]) => v.startsWith('eq.') && String(r[k]) === decodeURIComponent(v.slice(3)));
  const rows = db[table];
  if (method === 'GET') return json(rows.filter(match));
  if (method === 'DELETE') { db[table] = rows.filter((r) => !match(r)); return new Response(null, { status: 204 }); }
  const body = JSON.parse(init.body);
  if (method === 'PATCH') { rows.filter(match).forEach((r) => Object.assign(r, body)); return new Response(null, { status: 204 }); }
  // POST: insert, or upsert when Prefer asks to merge duplicates
  const key = UNIQUE[table];
  const existing = key ? rows.find((r) => r[key] === body[key]) : undefined;
  if (existing) {
    if (String(init.headers?.Prefer || '').includes('merge-duplicates')) { Object.assign(existing, body); return new Response(null, { status: 201 }); }
    return json({ code: '23505', message: 'duplicate key' }, 409);
  }
  rows.push({ ...body });
  return new Response(null, { status: 201 });
};

const send = (event: unknown, secret = SECRET) => {
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return webhook(new Request('https://www.oddsbanta.com/api/webhooks/bachs', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'bachs-signature': `t=${t},v1=${sig}` },
    body,
  }));
};

const meta = (tier: string, currency: string) => ({
  user_id: 'u1', user_email: 'payer@example.com', tier, currency,
  cycle: currency === 'NGN' ? '30_day_pass' : 'monthly_subscription',
});
const pair = (n: number, tier: string, currency: string, amount: string, subscriptionId?: string) => [
  { id: `evt_chk_${n}`, type: 'checkout.completed', data: {
    checkout_id: `chk_${n}`, mode: subscriptionId ? 'subscription' : 'payment', payment_status: 'paid', status: 'completed',
    amount, currency, charge: { id: `ch_${n}` }, subscription: subscriptionId ? { subscription_id: subscriptionId } : null,
    customer: { customer_id: 'cust_1', email: 'payer@example.com', name: 'Payer' }, metadata: meta(tier, currency) } },
  { id: `evt_col_${n}`, type: 'collection.succeeded', data: {
    checkout_id: `chk_${n}`, charge_id: `ch_${n}`, status: 'SUCCEEDED', amount, currency,
    product_cart: [{ product_id: currency === 'NGN' ? 'prod_b2260d0a8f214051ba4a' : 'prod_0aa1ef3ca6634e68b521' }],
    customer: { id: 'cust_1', email: 'payer@example.com', name: 'Payer' }, metadata: meta(tier, currency) } },
];

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };
const days = (iso: string | null | undefined) => (iso ? (new Date(iso).getTime() - Date.now()) / 864e5 : NaN);

// 1. NGN BigBang pass: both events at once grant 30 days, once
reset();
{
  const res = await Promise.all(pair(1, 'bigbang', 'NGN', '10000.00').map((e) => send(e)));
  const sub = db.subscriptions[0], ent = db.entitlements[0];
  check('NGN: both events answer 200', res.every((r) => r.status === 200));
  check('NGN: exactly one payment row', db.payments.length === 1);
  check('NGN: subscription is active bigbang', sub.tier === 'bigbang' && sub.status === 'active');
  check('NGN: entitlement is bigbang', ent.tier === 'bigbang' && ent.features.vip === true);
  check('NGN: 30 days, not 60', Math.abs(days(ent.valid_until) - 30) < 0.1 && Math.abs(days(sub.current_period_end) - 30) < 0.1);
  check('NGN: pass does not renew', sub.cancel_at_period_end === true);
}

// 2. USD monthly: subscription id is stored whichever event wins
for (let i = 0; i < 6; i++) {
  reset();
  await Promise.all(pair(2, 'standard', 'USD', '5.00', 'sub_abc').map((e) => send(e)));
  const sub = db.subscriptions[0];
  if (i === 0 || sub.bachs_subscription_id !== 'sub_abc' || sub.cancel_at_period_end !== false || db.payments.length !== 1) {
    check(`USD run ${i + 1}: subscription id linked, renews, one payment`, sub.bachs_subscription_id === 'sub_abc' && sub.cancel_at_period_end === false && db.payments.length === 1);
  }
  check(`USD run ${i + 1}: standard plan for 30 days`, sub.tier === 'standard' && db.entitlements[0].tier === 'standard' && Math.abs(days(sub.current_period_end) - 30) < 0.1);
}

// 3. A user with no subscription/entitlement rows still gets the plan
reset();
db.subscriptions = []; db.entitlements = [];
await send(pair(3, 'standard', 'NGN', '5000.00')[1]);
check('missing rows: subscription created', db.subscriptions.length === 1 && db.subscriptions[0].tier === 'standard');
check('missing rows: entitlement created', db.entitlements.length === 1 && db.entitlements[0].tier === 'standard');

// 4. A failed write returns 500 and leaves nothing behind, so the Bachs retry grants the plan
reset();
{
  const ev = pair(4, 'bigbang', 'NGN', '10000.00')[1];
  failNext = 'POST entitlements';
  const first = await send(ev);
  check('failure: answers 500 so Bachs retries', first.status === 500);
  check('failure: event log and payment claim released', db.webhook_events_log.length === 0 && db.payments.length === 0);
  const retry = await send(ev);
  check('failure: retry grants the plan', retry.status === 200 && db.entitlements[0].tier === 'bigbang' && db.payments.length === 1);
}

// 5. Replays and bad signatures
reset();
{
  const ev = pair(5, 'standard', 'NGN', '5000.00')[1];
  await send(ev);
  const again = await send(ev);
  check('replay: same event id is acknowledged without a second grant', again.status === 200 && db.payments.length === 1);
  const forged = await send(pair(6, 'bigbang', 'NGN', '10000.00')[1], 'wrong-secret');
  check('forged signature: rejected with 400, nothing granted', forged.status === 400 && db.entitlements[0].tier === 'standard');
}

// 6. A second pass while one is running extends from its end
reset();
await send(pair(7, 'bigbang', 'NGN', '10000.00')[1]);
await send(pair(8, 'bigbang', 'NGN', '10000.00')[1]);
check('renewal: second pass stacks to 60 days', Math.abs(days(db.entitlements[0].valid_until) - 60) < 0.1);

if (failed) { console.error(`${failed} bachs webhook check(s) failed`); process.exit(1); }
console.log('All bachs webhook checks passed');
