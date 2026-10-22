// Behaviour test for the transactional email endpoints (Phase 0).
// Mocks Supabase Auth and Resend, then checks who may send what to whom.
// Run: node tests/edge/run.mjs
import welcome from '../../api/send-welcome-email';
import subscription from '../../api/send-subscription-email';
import password from '../../api/send-password-reset-email';

process.env.RESEND_API_KEY = 'test-resend';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests-only-0000';

const sent: { to: string[]; subject: string }[] = [];
const marked: string[] = [];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

// Tokens: NEW = account created now, OLD = 90 days old, ADMIN = admin via is_admin()
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const auth = String(init?.headers?.Authorization || init?.headers?.authorization || '');
  if (url.includes('/auth/v1/user')) {
    if (auth.includes('NEW')) return json({ id: 'u-new', email: 'new@example.com', created_at: new Date().toISOString(), app_metadata: {} });
    if (auth.includes('OLD')) return json({ id: 'u-old', email: 'old@example.com', created_at: new Date(Date.now() - 90 * 864e5).toISOString(), app_metadata: {} });
    if (auth.includes('SENT')) return json({ id: 'u-sent', email: 'sent@example.com', created_at: new Date().toISOString(), app_metadata: { welcome_sent_at: '2026-10-22T00:00:00Z' } });
    if (auth.includes('ADMIN')) return json({ id: 'u-adm', email: 'staff@example.com', created_at: new Date(Date.now() - 90 * 864e5).toISOString(), app_metadata: {} });
    return json({ msg: 'invalid' }, 401);
  }
  if (url.includes('rpc/is_admin')) return json(auth.includes('ADMIN'));
  if (url.includes('api.resend.com')) {
    const body = JSON.parse(init.body);
    sent.push({ to: body.to, subject: body.subject });
    return json({ id: 'msg_1' });
  }
  if (url.includes('/auth/v1/admin/users/')) {
    marked.push(url.split('/').pop() || '');
    return json({ id: url.split('/').pop() });
  }
  if (url.includes('generate_link')) throw new Error('generate_link must never be called');
  throw new Error('unexpected fetch ' + url);
};

const tok = (t: string) => `Bearer ${t}.aaaaaaaaaaaaaaaaaaaaaaaa.bbbbbbbb`;
const post = (h: (r: Request) => Promise<Response>, body: unknown, token?: string, origin = 'https://www.oddsbanta.com') =>
  h(new Request('https://www.oddsbanta.com/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, ...(token ? { authorization: token } : {}) },
    body: JSON.stringify(body),
  }));

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };

// Welcome
check('welcome: no token -> 401', (await post(welcome, { email: 'victim@example.com' })).status === 401);
check('welcome: bad token -> 401', (await post(welcome, { email: 'victim@example.com' }, tok('BAD'))).status === 401);
sent.length = 0;
const w = await post(welcome, { email: 'victim@example.com', name: 'x' }, tok('NEW'));
check('welcome: new account -> 200', w.status === 200);
check('welcome: goes to caller, not body email', sent.length === 1 && sent[0].to[0] === 'new@example.com');
check('welcome: marks the account (welcome_sent_at)', marked.includes('u-new'));
check('welcome: account already marked -> 409', (await post(welcome, {}, tok('SENT'))).status === 409);
check('welcome: second send for same account -> 409', (await post(welcome, {}, tok('NEW'))).status === 409);
check('welcome: old account -> 409', (await post(welcome, {}, tok('OLD'))).status === 409);

// Subscription
check('subscription: no token -> 401', (await post(subscription, { email: 'a@example.com' })).status === 401);
check('subscription: non-admin -> 403', (await post(subscription, { email: 'a@example.com' }, tok('OLD'))).status === 403);
sent.length = 0;
check('subscription: admin -> 200', (await post(subscription, { email: 'member@example.com', tier: 'standard' }, tok('ADMIN'))).status === 200);
check('subscription: admin mail to target', sent.length === 1 && sent[0].to[0] === 'member@example.com');
check('subscription: service role -> 200', (await post(subscription, { email: 'member@example.com' }, `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`)).status === 200);

// Password
check('password: reset_request -> 410 (no link minting)', (await post(password, { email: 'victim@example.com', type: 'reset_request' })).status === 410);
check('password: changed_notice without token -> 401', (await post(password, { email: 'victim@example.com', type: 'changed_notice' })).status === 401);
sent.length = 0;
check('password: changed_notice signed in -> 200', (await post(password, { email: 'victim@example.com', type: 'changed_notice' }, tok('OLD'))).status === 200);
check('password: notice goes to caller only', sent.length === 1 && sent[0].to[0] === 'old@example.com');

// CORS
const evil = await post(welcome, {}, undefined, 'https://evil.example');
check('cors: foreign origin gets no allow-origin', evil.headers.get('access-control-allow-origin') === null);
const good = await post(welcome, {}, undefined);
check('cors: oddsbanta origin allowed', good.headers.get('access-control-allow-origin') === 'https://www.oddsbanta.com');

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nEMAIL ENDPOINTS: ALL PASSED');
