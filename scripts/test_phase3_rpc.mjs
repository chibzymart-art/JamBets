// Test Phase 3 get_user_session_bootstrap RPC
import fs from 'fs';
import path from 'path';
import { strict as assert } from 'assert';

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

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY;

async function run() {
  console.log('🧪 Testing Phase 3: get_user_session_bootstrap RPC on Live Supabase...');

  // Test 1: Anonymous call must be blocked
  console.log('\n[1/3] Testing Anonymous call rejection...');
  const anonRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_session_bootstrap`, {
    method: 'POST',
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user_id: '00000000-0000-0000-0000-000000000000' })
  });
  console.log('  Anon response HTTP status:', anonRes.status);
  const anonJson = await anonRes.json().catch(() => ({}));
  console.log('  Anon response message:', anonJson.message || anonJson.hint || anonJson);
  assert.equal(anonRes.status >= 400, true, 'Anon caller must be rejected');
  console.log('  ✓ Anonymous snooping correctly blocked with HTTP 4xx/permission denied.');

  // Test 2: Fetch a valid user ID from public.users using service role
  console.log('\n[2/3] Fetching a registered user to test bootstrap payload...');
  const usersRes = await fetch(`${SUPABASE_URL}/rest/v1/users?select=id,email,role&limit=1`, {
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`
    }
  });
  const users = await usersRes.json();
  assert.equal(users.length > 0, true, 'Should find at least 1 registered user');
  const sampleUser = users[0];
  console.log(`  Target user: ${sampleUser.email} (id: ${sampleUser.id})`);

  // Test 3: Call get_user_session_bootstrap via service_role
  console.log('\n[3/3] Calling get_user_session_bootstrap with target user ID...');
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_user_session_bootstrap`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_user_id: sampleUser.id })
  });
  console.log('  RPC response HTTP status:', rpcRes.status);
  const bootstrap = await rpcRes.json();
  console.log('  Bootstrap keys:', Object.keys(bootstrap));
  console.log('  User in payload:', bootstrap.user?.email, '| Role:', bootstrap.user?.role);
  console.log('  Subscription present:', !!bootstrap.subscription);
  console.log('  Entitlement present:', !!bootstrap.entitlement);

  assert.equal(rpcRes.status, 200, 'RPC must return HTTP 200');
  assert.equal(bootstrap.user?.id, sampleUser.id, 'User ID in payload must match target');
  assert.ok('user' in bootstrap, 'Must contain user key');
  assert.ok('subscription' in bootstrap, 'Must contain subscription key');
  assert.ok('entitlement' in bootstrap, 'Must contain entitlement key');

  console.log('\n🎉 PHASE 3 RPC VERIFICATION PASSED PERFECTLY!');
}

run().catch((err) => {
  console.error('❌ Phase 3 RPC test failed:', err);
  process.exit(1);
});
