// QA Verification Script: Phase 2 Auth Concurrency & Rate Limiting Test
import { strict as assert } from 'assert';

function isRetryableAuthError(error) {
  if (!error) return false;
  const status = error.status || error.statusCode;
  if (status === 429 || status === 503 || status === 504 || status === 502) {
    return true;
  }
  const msg = (error.message || error.error_description || '').toLowerCase();
  if (
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('over_request_rate_limit') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('gateway timeout') ||
    msg.includes('service unavailable')
  ) {
    return true;
  }
  return false;
}

async function executeAuthWithRetry(action, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.initialDelayMs ?? 50; // fast for unit testing
  const maxDelay = options.maxDelayMs ?? 200;

  let attempt = 0;
  while (true) {
    try {
      return await action();
    } catch (err) {
      attempt++;
      if (attempt > maxRetries || !isRetryableAuthError(err)) {
        throw err;
      }
      const backoff = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
      const jitter = Math.floor(Math.random() * 20);
      const delayMs = backoff + jitter;

      if (options.onRetry) {
        options.onRetry(attempt, maxRetries, delayMs);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function runTests() {
  console.log('🧪 Starting Phase 2 Concurrency & Rate-Limiting QA Suite...');

  // Test 1: Retryable error recognition
  console.log('\n[1/5] Testing error classifications...');
  assert.equal(isRetryableAuthError({ status: 429 }), true, 'Status 429 should be retryable');
  assert.equal(isRetryableAuthError({ status: 503 }), true, 'Status 503 should be retryable');
  assert.equal(isRetryableAuthError({ status: 504 }), true, 'Status 504 should be retryable');
  assert.equal(isRetryableAuthError({ message: 'over_request_rate_limit: too many requests' }), true, 'Rate limit msg should be retryable');
  assert.equal(isRetryableAuthError({ message: 'TypeError: Failed to fetch' }), true, 'Network fetch drop should be retryable');
  assert.equal(isRetryableAuthError({ message: 'Invalid login credentials' }), false, 'Bad password should NOT be retryable');
  assert.equal(isRetryableAuthError({ message: 'User already registered' }), false, 'Existing user should NOT be retryable');
  console.log('  ✓ Error classification assertions passed.');

  // Test 2: Transient 429 recovery via backoff retry
  console.log('\n[2/5] Testing transient 429 recovery simulation...');
  let callsA = 0;
  const retryEvents = [];
  const resultA = await executeAuthWithRetry(async () => {
    callsA++;
    if (callsA < 3) {
      const err = new Error('rate limit reached: 429');
      err.status = 429;
      throw err;
    }
    return { user: { id: 'usr_test_123', email: 'test@oddsbanta.com' } };
  }, {
    maxRetries: 3,
    initialDelayMs: 20,
    onRetry: (attempt, max, delay) => {
      retryEvents.push({ attempt, max, delay });
    }
  });

  assert.equal(callsA, 3, 'Should have retried 2 times and succeeded on 3rd attempt');
  assert.equal(retryEvents.length, 2, 'Should have emitted 2 retry events');
  assert.equal(retryEvents[0].attempt, 1, 'First retry attempt should be 1');
  assert.equal(retryEvents[1].attempt, 2, 'Second retry attempt should be 2');
  assert.equal(resultA.user.id, 'usr_test_123', 'Result should be returned upon recovery');
  console.log('  ✓ Successfully absorbed 2 consecutive 429 spikes and recovered.');

  // Test 3: Non-retryable error stops immediately without wasting retries
  console.log('\n[3/5] Testing non-retryable credentials rejection...');
  let callsB = 0;
  let caughtB = null;
  try {
    await executeAuthWithRetry(async () => {
      callsB++;
      throw new Error('Invalid login credentials');
    }, { maxRetries: 3, initialDelayMs: 20 });
  } catch (err) {
    caughtB = err;
  }
  assert.equal(callsB, 1, 'Non-retryable error must fail on call 1 without looping');
  assert.equal(caughtB?.message, 'Invalid login credentials');
  console.log('  ✓ Immediate exit for bad credentials without retry overhead.');

  // Test 4: Exhaustion after maximum retries
  console.log('\n[4/5] Testing persistent outage retry exhaustion...');
  let callsC = 0;
  let caughtC = null;
  try {
    await executeAuthWithRetry(async () => {
      callsC++;
      const err = new Error('Gateway Timeout');
      err.status = 504;
      throw err;
    }, { maxRetries: 3, initialDelayMs: 20 });
  } catch (err) {
    caughtC = err;
  }
  assert.equal(callsC, 4, 'Initial attempt + 3 retries = 4 total attempts');
  assert.equal(caughtC?.status, 504);
  console.log('  ✓ Retry ceiling safely enforced after 3 retry attempts.');

  // Test 5: Verify live Supabase GoTrue endpoint ping with apikey
  console.log('\n[5/6] Testing live Supabase GoTrue endpoint ping...');
  const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
  const res = await fetch('https://vepcoopomlfjageijsew.supabase.co/auth/v1/health', {
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`
    }
  });
  console.log('  Supabase Auth Health HTTP Status:', res.status);
  const healthJson = await res.json().catch(() => ({}));
  console.log('  Supabase Auth Health payload:', healthJson);
  assert.equal(res.status, 200, 'Supabase auth health should be HTTP 200');

  // Test 6: Verify live server-side disclaimer rejection on auth.signUp
  console.log('\n[6/6] Testing server-side disclaimer enforcement on auth.signUp...');
  const signupRes = await fetch('https://vepcoopomlfjageijsew.supabase.co/auth/v1/signup', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY
    },
    body: JSON.stringify({
      email: `disclaimer_test_${Date.now()}@oddsbanta-qa.com`,
      password: 'TestPassword123!',
      data: {
        disclaimer_age_accepted: false, // Invalid: must be true
        disclaimer_financial_accepted: true
      }
    })
  });
  const signupJson = await signupRes.json();
  console.log('  Signup rejection response status:', signupRes.status);
  console.log('  Signup rejection message:', signupJson.msg || signupJson.error_description || signupJson.message);
  assert.equal(signupRes.status >= 400, true, 'Registration without disclaimers must return HTTP 4xx/5xx');
  const errorText = (signupJson.msg || signupJson.error_description || signupJson.message || '').toLowerCase();
  assert.equal(errorText.includes('registration rejected') || errorText.includes('database error saving new user'), true, 'Database trigger must reject unacknowledged registration');
  console.log('  ✓ Server-side trigger strictly enforced mandatory disclaimer compliance.');

  console.log('\n🎉 ALL 6 QA CONCURRENCY & AUTH TESTS PASSED SUCCESSFULLY!');
}

runTests().catch((err) => {
  console.error('❌ QA Test failed:', err);
  process.exit(1);
});
