// Stale-while-revalidate refresh must be handed to Vercel's waitUntil, otherwise the Edge runtime
// drops it when the response is sent and an instance serves its first snapshot for up to an hour.
// Run: node tests/edge/run.mjs
import { EdgeSwrCache } from '../../api/_lib/edge-cache';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
  if (!ok) failures++;
};

(async () => {
  // Fake the request context Vercel exposes (the one @vercel/functions reads).
  const registered: Promise<unknown>[] = [];
  (globalThis as any)[Symbol.for('@vercel/request-context')] = { get: () => ({ waitUntil: (p: Promise<unknown>) => registered.push(p) }) };

  const cache = new EdgeSwrCache<string>(50, 60_000); // 50 ms fresh, 60 s stale
  let version = 'old';
  const fetcher = async () => version;

  const first = await cache.getOrFetch('k', fetcher);
  check('cold read fetches', first.data === 'old' && !first.isStale);
  check('cold read registers nothing in the background', registered.length === 0, String(registered.length));

  await new Promise((r) => setTimeout(r, 80)); // let it go stale
  version = 'new';
  const stale = await cache.getOrFetch('k', fetcher);
  check('stale read returns old data at once', stale.data === 'old' && stale.isStale);
  check('background refresh handed to waitUntil', registered.length === 1, String(registered.length));

  await Promise.all(registered);
  const fresh = await cache.getOrFetch('k', fetcher);
  check('next read serves refreshed data', fresh.data === 'new' && !fresh.isStale, JSON.stringify(fresh));

  // A failing refresh must not reject the waitUntil promise, and old data stays served.
  await new Promise((r) => setTimeout(r, 80));
  const failing = async (): Promise<string> => { throw new Error('upstream down'); };
  const warn = console.warn; console.warn = () => {};
  await cache.getOrFetch('k', failing);
  let rejected = false;
  await Promise.all(registered).catch(() => { rejected = true; });
  console.warn = warn;
  check('failed refresh does not reject the waitUntil promise', !rejected);
  check('failed refresh keeps last good data', cache.get('k') === 'new');

  // Without a request context (local dev) nothing throws.
  delete (globalThis as any)[Symbol.for('@vercel/request-context')];
  const plain = new EdgeSwrCache<string>(1, 60_000);
  await plain.getOrFetch('x', async () => 'a');
  await new Promise((r) => setTimeout(r, 10));
  let threw = false;
  try { await plain.getOrFetch('x', async () => 'b'); } catch { threw = true; }
  check('works without a Vercel request context', !threw);

  if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
  console.log('EDGE CACHE: ALL PASSED');
})();
