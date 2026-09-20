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

import * as predFeedModule from '../api/predictions-feed.ts';
import * as marketFeedModule from '../api/market-feed.ts';

const predHandler =
  typeof predFeedModule.default === 'function'
    ? predFeedModule.default
    : typeof predFeedModule.default?.default === 'function'
    ? predFeedModule.default.default
    : predFeedModule;

const marketHandler =
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

async function run() {
  console.log('====================================================');
  console.log('🧪 Strict Paywall Enforcement Test Suite');
  console.log('====================================================\n');

  // 1. Predictions Feed - Guest / Non-Paid Request
  console.log('--- 1. Testing /api/predictions-feed (Guest / Non-Paid) ---');
  const guestReq = new Request('https://www.oddsbanta.com/api/predictions-feed', {
    method: 'GET',
    headers: { Origin: 'https://www.oddsbanta.com' }
  });
  const guestRes = await predHandler(guestReq);
  assert('HTTP 200 OK', guestRes.status === 200);
  assert('CORS origin is oddsbanta.com', guestRes.headers.get('Access-Control-Allow-Origin') === 'https://www.oddsbanta.com');
  const guestData = await guestRes.json();
  assert('Response success is true', guestData.success === true);
  assert('Predictions is array', Array.isArray(guestData.predictions));

  console.log('Sample item:', guestData.predictions[0]);
  console.log('Settlement statuses found:', [...new Set(guestData.predictions.map(p => p.settlement_status))]);
  console.log('Is locked values found:', [...new Set(guestData.predictions.map(p => p.is_locked))]);

  let lostCount = 0;
  let wonCount = 0;
  let pendingUnlockedCount = 0;
  let pendingLockedCount = 0;

  for (const p of guestData.predictions) {
    if (p.settlement_status === 'lost') {
      lostCount++;
    } else if (p.settlement_status === 'won') {
      wonCount++;
      if (p.is_locked) {
        console.error('Won prediction was locked!');
      }
    } else {
      if (p.is_locked) {
        pendingLockedCount++;
      } else {
        pendingUnlockedCount++;
      }
    }
  }

  assert('Zero lost predictions shown to guest', lostCount === 0, `Got ${lostCount} lost`);
  assert('Zero pending predictions unlocked for guest', pendingUnlockedCount === 0, `Got ${pendingUnlockedCount} unlocked pending`);
  assert('All pending predictions are locked for guest', pendingLockedCount > 0, `Got ${pendingLockedCount} locked pending`);
  console.log(`   Summary: Won: ${wonCount}, Lost: ${lostCount}, Pending Locked: ${pendingLockedCount}, Pending Unlocked: ${pendingUnlockedCount}`);

  // 2. Market Feed - Guest / Non-Paid Request
  console.log('\n--- 2. Testing /api/market-feed (Guest / Non-Paid) ---');
  const marketGuestReq = new Request('https://www.oddsbanta.com/api/market-feed?market=draw', {
    method: 'GET',
    headers: { Origin: 'https://www.oddsbanta.com' }
  });
  const marketGuestRes = await marketHandler(marketGuestReq);
  assert('HTTP 200 OK for market feed', marketGuestRes.status === 200);
  const marketGuestData = await marketGuestRes.json();

  let mLostCount = 0;
  let mPendingUnlocked = 0;
  let mPendingLocked = 0;
  let mWonCount = 0;

  for (const p of marketGuestData.predictions) {
    if (p.settlement_status === 'lost') {
      mLostCount++;
    } else if (p.settlement_status === 'won') {
      mWonCount++;
    } else {
      if (p.is_locked) {
        mPendingLocked++;
      } else {
        mPendingUnlocked++;
      }
    }
  }

  assert('Zero lost predictions in market feed for guest', mLostCount === 0, `Got ${mLostCount} lost`);
  assert('Zero pending predictions unlocked in market feed for guest', mPendingUnlocked === 0, `Got ${mPendingUnlocked} unlocked pending`);
  assert('All pending predictions locked in market feed for guest', mPendingLocked > 0, `Got ${mPendingLocked} locked pending`);
  console.log(`   Summary: Won: ${mWonCount}, Lost: ${mLostCount}, Pending Locked: ${mPendingLocked}, Pending Unlocked: ${mPendingUnlocked}`);

  // 3. Admin / Service Role Request
  console.log('\n--- 3. Testing VIP / Admin Full Unredacted Access ---');
  const adminReq = new Request('https://www.oddsbanta.com/api/predictions-feed', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Origin: 'https://www.oddsbanta.com'
    }
  });
  const adminRes = await predHandler(adminReq);
  assert('HTTP 200 OK for admin', adminRes.status === 200);
  const adminData = await adminRes.json();
  let adminLockedCount = 0;
  for (const p of adminData.predictions) {
    if (p.is_locked) adminLockedCount++;
  }
  assert('Zero locked predictions for Admin / VIP', adminLockedCount === 0, `Got ${adminLockedCount} locked`);

  console.log('\n====================================================');
  console.log(`Results: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');
  if (failed > 0) process.exit(1);
}

run().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
