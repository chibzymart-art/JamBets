// JamBets / Oddsbanta — Phase 3 Market Feed Edge API Test Suite
import fs from 'fs';
import path from 'path';

// Read environment
const envContent = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
}

process.env.VITE_SUPABASE_URL = env.SUPABASE_URL;
process.env.VITE_SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

// Import the Edge API handler
import * as marketFeedModule from '../api/market-feed.ts';
const handler =
  typeof marketFeedModule.default === 'function'
    ? marketFeedModule.default
    : typeof marketFeedModule.default?.default === 'function'
    ? marketFeedModule.default.default
    : marketFeedModule;

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  [PASS] ${name}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${name} ${detail ? `-> ${detail}` : ''}`);
    failed++;
  }
}

async function makeRequest(url, headers = {}) {
  const req = new Request(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  });
  const t0 = performance.now();
  const res = await handler(req);
  const latency = performance.now() - t0;
  const json = await res.json();
  return { status: res.status, json, latency };
}

async function runTests() {
  console.log('=================================================================');
  console.log(' 🧪 Oddsbanta — Phase 3: Market Feed Edge API Test Suite');
  console.log('=================================================================\n');

  // Test 1: Curated Market (Default)
  console.log('--- 1. Market: Curated Top Edge ---');
  const rCurated = await makeRequest('https://oddsbanta.com/api/market-feed?market=curated&page=1&limit=10');
  assert('HTTP 200 OK', rCurated.status === 200, `Got status: ${rCurated.status}`);
  assert('Response success = true', rCurated.json.success === true);
  assert('Predictions array returned', Array.isArray(rCurated.json.predictions));
  assert('Strictly max 10 items per viewport', rCurated.json.predictions.length <= 10);
  assert('Counts object has all 7 market counters', Object.keys(rCurated.json.counts).length >= 7);
  assert(`Cold-start initial fetch latency < 3000ms (got ${rCurated.latency.toFixed(1)}ms)`, rCurated.latency < 3000);

  // Test 2: Specialist Markets
  const specialistMarkets = [
    { market: 'home_win', category: 'home_win', label: 'Home Win Dominance' },
    { market: 'away_win', category: 'away_win', label: 'Away Win Specialist' },
    { market: 'draw', category: 'draw', label: 'Draw Hunter' },
    { market: 'corners', category: 'corners', label: 'Corners Specialist' },
    { market: 'over_2.5_goals', category: 'goals', label: 'Over 2.5 Goals' },
    { market: 'ht_over_0.5_goals', category: 'goals', label: '1H Blitz (Over 0.5)' },
  ];

  for (const s of specialistMarkets) {
    console.log(`\n--- 2. Market: ${s.market} ---`);
    const res = await makeRequest(`https://oddsbanta.com/api/market-feed?market=${s.market}&page=1&limit=10`);
    assert(`HTTP 200 for market=${s.market}`, res.status === 200);
    assert(`Market matches '${s.market}'`, res.json.market === s.market);
    assert(`Predictions count > 0 for ${s.market}`, res.json.predictions.length > 0, `Count: ${res.json.predictions.length}`);
    if (res.json.predictions.length > 0) {
      const first = res.json.predictions[0];
      assert(`Category matches '${s.category}'`, first.market_category === s.category, `Got: ${first.market_category}`);
      assert(`Market label matches '${s.label}'`, first.market_label === s.label, `Got: ${first.market_label}`);
      assert('Fixture details present', Boolean(first.fixture && first.fixture.home_team && first.fixture.away_team));
    }
  }

  // Test 3: Pagination Logic
  console.log('\n--- 3. Pagination Engine ---');
  const p1 = await makeRequest('https://oddsbanta.com/api/market-feed?market=home_win&page=1&limit=5');
  const p2 = await makeRequest('https://oddsbanta.com/api/market-feed?market=home_win&page=2&limit=5');
  assert('Page 1 returns 5 items', p1.json.predictions.length === 5);
  assert('Page 2 returns 5 items', p2.json.predictions.length === 5);
  assert('Page 1 page field is 1', p1.json.page === 1);
  assert('Page 2 page field is 2', p2.json.page === 2);
  assert('Has next page on page 1', p1.json.has_next === true);
  assert('Has prev page on page 2', p2.json.has_prev === true);
  if (p1.json.predictions[0] && p2.json.predictions[0]) {
    assert('Page 1 and Page 2 contain distinct fixtures', p1.json.predictions[0].id !== p2.json.predictions[0].id);
  }

  // Test 4: Freemium 3/7 Paywall Rule for Unauthenticated Visitors
  console.log('\n--- 4. Freemium 3/7 Rule (Guest User) ---');
  const guestRes = await makeRequest('https://oddsbanta.com/api/market-feed?market=corners&page=1&limit=10');
  const preds = guestRes.json.predictions;
  if (preds.length >= 5) {
    assert('Pick 1 is UNLOCKED for guest', preds[0].is_locked === false && preds[0].probability !== null);
    assert('Pick 2 is UNLOCKED for guest', preds[1].is_locked === false && preds[1].probability !== null);
    assert('Pick 3 is UNLOCKED for guest', preds[2].is_locked === false && preds[2].probability !== null);
    assert('Pick 4 is LOCKED teaser for guest', preds[3].is_locked === true && preds[3].probability === null && preds[3].prediction === 'LOCKED');
    assert('Pick 5 is LOCKED teaser for guest', preds[4].is_locked === true && preds[4].probability === null && preds[4].prediction === 'LOCKED');
    assert('Pick 4 retains fixture details', Boolean(preds[3].fixture && preds[3].fixture.home_team));
  }

  // Test 5: Full VIP / Admin Unlocked View
  console.log('\n--- 5. VIP / Admin Full Unlock ---');
  const adminToken = env.SUPABASE_SERVICE_ROLE_KEY;
  const vipRes = await makeRequest(
    'https://oddsbanta.com/api/market-feed?market=corners&page=1&limit=10',
    { Authorization: `Bearer ${adminToken}` }
  );
  const vipPreds = vipRes.json.predictions;
  if (vipPreds.length >= 5) {
    assert('VIP Pick 1 is UNLOCKED', vipPreds[0].is_locked === false && vipPreds[0].probability !== null);
    assert('VIP Pick 4 is UNLOCKED', vipPreds[3].is_locked === false && vipPreds[3].probability !== null);
    assert('VIP Pick 5 is UNLOCKED', vipPreds[4].is_locked === false && vipPreds[4].probability !== null);
  }

  // Test 6: Memory Cache Latency
  console.log('\n--- 6. Memory Cache Latency Benchmark ---');
  const cachedCall = await makeRequest('https://oddsbanta.com/api/market-feed?market=curated&page=1&limit=10');
  assert(`Cache hit latency < 10ms (got ${cachedCall.latency.toFixed(2)}ms)`, cachedCall.latency < 10);

  console.log('\n=================================================================');
  console.log(` Phase 3 API Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('=================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Test Suite Exception:', err);
  process.exit(1);
});
