// Regression test: with new-style keys (sb_publishable_ / sb_secret_) the tennis feed must send the
// same project key as apikey and Bearer. Supabase rejects a publishable apikey with an sb_secret_
// bearer (401 PGRST301 "Expected 3 parts in JWT; got 1"), which emptied the tennis page on 9 Nov 2026.
// Run: node tests/edge/run.mjs
import './new-keys-env';
import tennis from '../../api/tennis-feed';

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const kickoff = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
const row = { id: 'tk1', fixture_id: 'f1', market: 'match_winner', prediction: 'A to win', probability: 0.8, confidence_category: 'TOP PICK',
  settlement_status: 'pending', target_kickoff_at: kickoff, publication_status: 'published',
  fixture: { id: 'f1', status: 'scheduled', target_kickoff_at: kickoff, tournament: { id: 't1', name: 'T' }, player1: { id: 'p1' }, player2: { id: 'p2' } } };

let mismatched = 0;
(globalThis as any).fetch = async (input: any, init?: any) => {
  const url = String(typeof input === 'string' ? input : input.url);
  const h = init?.headers || {};
  const apikey = String(h.apikey || '');
  const bearer = String(h.Authorization || h.authorization || '').replace(/^Bearer\s+/i, '');
  // Mimic Supabase: a non-JWT bearer is only accepted when it is the same key as apikey.
  if (url.includes('/rest/v1/') && bearer && bearer.split('.').length !== 3 && bearer !== apikey) {
    mismatched++;
    return json({ code: 'PGRST301', message: 'Expected 3 parts in JWT; got 1' }, 401);
  }
  if (url.includes('cached_feeds') && url.includes('feed:tennis')) {
    return json([{ payload: { predictions: [row], tournaments: [{ id: 't1', name: 'T' }], settlements: [], stats: {} }, updated_at: new Date().toISOString() }]);
  }
  if (url.includes('tennis_tournaments')) return json([{ id: 't1', name: 'T' }]);
  if (url.includes('/rest/v1/')) return json([]);
  return json({}, 404);
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures++;
};

(async () => {
  const res = await tennis(new Request('https://www.oddsbanta.com/api/tennis-feed?tz=Africa/Lagos', {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36', origin: 'https://www.oddsbanta.com', 'x-forwarded-for': '10.0.9.1' },
  }));
  const body: any = await res.json();
  check('tennis new keys: request ok', res.status === 200, String(res.status));
  check('tennis new keys: no mismatched apikey/bearer sent', mismatched === 0, `${mismatched} rejected calls`);
  check('tennis new keys: snapshot predictions reach the response', (body.predictions || []).length === 1, JSON.stringify(body).slice(0, 200));
  if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
  console.log('TENNIS KEYS: ALL PASSED');
})();
