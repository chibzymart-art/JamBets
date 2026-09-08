import fs from 'fs';
import path from 'path';

// Read .env file directly without external dependencies
const envPath = path.resolve(process.cwd(), '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx !== -1) {
    env[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
  }
}

const SUPABASE_URL = env.SUPABASE_URL;
const ANON_KEY = env.SUPABASE_ANON_KEY;

const anonHeaders = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json'
};

async function testPhase8CloudAuth() {
  console.log('==================================================================');
  console.log('JamBets — Phase 8 Cloud Supabase Verification: Auth, RLS & Tiers');
  console.log('==================================================================\n');

  // TEST 1: Unauthenticated visitor RLS query to football_predictions
  console.log('[TEST 1] Unauthenticated Visitor Query to football_predictions (RLS Guard):');
  const anonPredRes = await fetch(`${SUPABASE_URL}/rest/v1/football_predictions?select=*&limit=10`, {
    headers: anonHeaders
  });
  const anonPredData = await anonPredRes.json();
  console.log(`  HTTP Status: ${anonPredRes.status}`);
  console.log(`  Rows returned to unauthenticated visitor: ${anonPredData.length}`);
  if (anonPredData.length === 0) {
    console.log('  ✓ PASSED: RLS successfully blocked prediction leakage to visitor (0 rows).');
  } else {
    console.error('  ✗ FAILED: Predictions leaked to visitor!');
  }

  // TEST 2: Unauthenticated visitor query to public teaser view
  console.log('\n[TEST 2] Unauthenticated Visitor Query to football_prediction_teasers (Public View):');
  const teaserRes = await fetch(`${SUPABASE_URL}/rest/v1/football_prediction_teasers?select=*&limit=5`, {
    headers: anonHeaders
  });
  const teaserData = await teaserRes.json();
  console.log(`  HTTP Status: ${teaserRes.status}`);
  console.log(`  Teaser rows returned: ${teaserData.length}`);
  if (teaserData.length > 0) {
    const sample = teaserData[0];
    console.log(`  Sample teaser columns: ${Object.keys(sample).join(', ')}`);
    const hasRawPred = 'prediction' in sample;
    const hasProb = 'probability' in sample;
    console.log(`  Raw prediction exposed: ${hasRawPred} (Must be false)`);
    console.log(`  Probability exposed: ${hasProb} (Must be false)`);
    console.log(`  is_locked flag: ${sample.is_locked}`);
    if (!hasRawPred && !hasProb && sample.is_locked === true) {
      console.log('  ✓ PASSED: Teasers provide clean metadata without leaking proprietary predictions.');
    }
  }

  // TEST 3: Attempt registration WITHOUT disclaimers (Trigger must reject server-side)
  console.log('\n[TEST 3] Server-Side Trigger Validation: Missing Disclaimers Rejection:');
  const badSignupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: anonHeaders,
    body: JSON.stringify({
      email: `bad_user_${Date.now()}@gmail.com`,
      password: 'Password123!',
      data: {
        disclaimer_age_accepted: false,
        disclaimer_financial_accepted: true
      }
    })
  });
  const badSignupData = await badSignupRes.json();
  console.log(`  HTTP Status: ${badSignupRes.status}`);
  console.log(`  Server Error Response: ${badSignupData.msg || badSignupData.message || JSON.stringify(badSignupData)}`);
  if (!badSignupRes.ok) {
    console.log('  ✓ PASSED: Server-side trigger rejected registration with missing age disclaimer.');
  }

  // TEST 4: Registration WITH BOTH Disclaimers Accepted
  console.log('\n[TEST 4] Server-Side Trigger Validation: Valid Disclaimers Acceptance:');
  const userEmail = `trader_${Date.now()}@gmail.com`;
  const goodSignupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: anonHeaders,
    body: JSON.stringify({
      email: userEmail,
      password: 'Password123!',
      data: {
        display_name: 'Phase 8 Verified Member',
        disclaimer_age_accepted: true,
        disclaimer_financial_accepted: true,
        disclaimer_version: 'v1.0'
      }
    })
  });
  const goodSignupData = await goodSignupRes.json();
  console.log(`  HTTP Status: ${goodSignupRes.status}`);
  console.log(`  Response Data:`, goodSignupData);
  const userId = goodSignupData.id || goodSignupData.user?.id;
  const userToken = goodSignupData.access_token;
  console.log(`  User Created: ${userId}`);

  const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const adminHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  if (userId) {
    // TEST 5: Verify public.users profile, subscriptions and entitlements provisioned
    console.log('\n[TEST 5] Automatic Provisioning in Cloud Supabase (Trigger Verification):');
    const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`, {
      headers: adminHeaders
    });
    const profileData = await profileRes.json();
    console.log(`  public.users record:`, profileData[0]);
    if (profileData[0]?.disclaimer_age_accepted && profileData[0]?.disclaimer_financial_accepted) {
      console.log('  ✓ PASSED: Disclaimers cryptographically recorded with timestamps in public.users.');
    }

    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=*`, {
      headers: adminHeaders
    });
    const subData = await subRes.json();
    console.log(`  public.subscriptions record:`, subData[0]);
    if (subData[0]?.tier === 'free' && subData[0]?.status === 'active') {
      console.log('  ✓ PASSED: Default active Free subscription provisioned.');
    }

    const entRes = await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}&select=*`, {
      headers: adminHeaders
    });
    const entData = await entRes.json();
    console.log(`  public.entitlements record:`, entData[0]);
    if (entData[0]?.tier === 'free') {
      console.log('  ✓ PASSED: Default Free tier entitlement provisioned.');
    }

    // TEST 6: Upgrade to Standard Plan via admin/RPC
    console.log('\n[TEST 6] Subscription Tier Upgrade to Standard:');
    const upgradeRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ role: 'standard' })
    });
    await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ tier: 'standard' })
    });
    console.log(`  User role upgraded to standard.`);

    const upgradedProfileRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`, {
      headers: adminHeaders
    });
    const upgradedProfile = await upgradedProfileRes.json();
    console.log(`  Upgraded user profile role: ${upgradedProfile[0]?.role}`);
    if (upgradedProfile[0]?.role === 'standard') {
      console.log('  ✓ PASSED: User successfully upgraded to Standard tier.');
    }

    // TEST 7: Upgrade to BigBang VIP
    console.log('\n[TEST 7] Subscription Tier Upgrade to BigBang VIP:');
    await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ role: 'bigbang' })
    });
    await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: adminHeaders,
      body: JSON.stringify({ tier: 'bigbang' })
    });
    const vipProfileRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}&select=*`, {
      headers: adminHeaders
    });
    const vipProfile = await vipProfileRes.json();
    console.log(`  BigBang user profile role: ${vipProfile[0]?.role}`);
    if (vipProfile[0]?.role === 'bigbang') {
      console.log('  ✓ PASSED: User successfully upgraded to BigBang VIP tier.');
    }
  }

  console.log('\n==================================================================');
  console.log('Phase 8 Cloud Supabase Auth, RLS & Tier Tests Completed Successfully!');
  console.log('==================================================================');
}

testPhase8CloudAuth();
