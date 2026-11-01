// Behaviour test for /api/unsubscribe. Mocks Supabase, then checks that GET never writes and POST
// writes only the fields for the chosen scope. Run: node tests/edge/run.mjs
import unsubscribe from '../../api/unsubscribe';

process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-for-tests-only-0000';

const GOOD = 'a'.repeat(36);
const patches: { url: string; body: any }[] = [];
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  if (url.includes('/rest/v1/email_preferences') && init?.method === 'PATCH') {
    patches.push({ url, body: JSON.parse(init.body) });
    return json(url.includes(GOOD) ? [{ user_id: 'u1' }] : []);
  }
  throw new Error('unexpected fetch ' + url);
};

const call = (method: string, qs: string, body?: string) =>
  unsubscribe(new Request(`https://www.oddsbanta.com/api/unsubscribe?${qs}`, { method, body }));

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); if (!ok) failed++; };

check('unsubscribe: bad token -> 400', (await call('GET', 'token=nothex&scope=daily')).status === 400);
const g = await call('GET', `token=${GOOD}&scope=daily`);
check('unsubscribe: GET shows confirmation page', g.status === 200 && (await g.text()).includes('<form method="post"'));
check('unsubscribe: GET writes nothing', patches.length === 0);

const p = await call('POST', `token=${GOOD}&scope=daily`, 'List-Unsubscribe=One-Click');
check('unsubscribe: one-click POST -> 200', p.status === 200);
check('unsubscribe: daily scope only turns off daily_results',
  patches.length === 1 && patches[0].body.daily_results === false && !('lifecycle' in patches[0].body) && !('unsubscribed_all_at' in patches[0].body));

patches.length = 0;
await call('POST', `token=${GOOD}&scope=all`);
check('unsubscribe: all scope turns everything off',
  patches[0].body.daily_results === false && patches[0].body.lifecycle === false && typeof patches[0].body.unsubscribed_all_at === 'string');

patches.length = 0;
await call('POST', `token=${GOOD}&scope=weird`);
check('unsubscribe: unknown scope falls back to all', patches[0].body.lifecycle === false && patches[0].body.daily_results === false);

check('unsubscribe: unknown token -> 404', (await call('POST', `token=${'b'.repeat(36)}&scope=all`)).status === 404);
check('unsubscribe: PUT -> 405', (await call('PUT', `token=${GOOD}`)).status === 405);

if (failed) {
  console.error(`${failed} unsubscribe check(s) failed`);
  process.exit(1);
}
