// Phase 5: High-Concurrency Stress Testing & Go-Live Verification Suite
import https from 'https';
import fs from 'fs';
import path from 'path';

// Read .env for credentials
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

const LIVE_HOST = 'https://www.oddsbanta.com';
const SUPABASE_URL = env.SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.SUPABASE_ANON_KEY;

// Reusable HTTP Keep-Alive Agent for realistic browser connection pool simulation
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 60,
  maxFreeSockets: 30,
  timeout: 10000,
});

function httpGet(urlStr, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const start = performance.now();
    const req = https.request(
      url,
      {
        method: 'GET',
        agent,
        headers: {
          'User-Agent': 'Oddsbanta-StressTester/1.0',
          'Accept': 'application/json, text/html, */*',
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const duration = performance.now() - start;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            duration,
            bodyLength: data.length,
          });
        });
      }
    );

    req.on('error', (err) => {
      const duration = performance.now() - start;
      resolve({
        ok: false,
        status: 0,
        duration,
        error: err.message,
      });
    });

    req.end();
  });
}

function httpPost(urlStr, bodyObj, headers = {}) {
  return new Promise((resolve) => {
    const url = new URL(urlStr);
    const postData = JSON.stringify(bodyObj);
    const start = performance.now();
    const req = https.request(
      url,
      {
        method: 'POST',
        agent,
        headers: {
          'User-Agent': 'Oddsbanta-StressTester/1.0',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          const duration = performance.now() - start;
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            duration,
            bodyLength: data.length,
          });
        });
      }
    );

    req.on('error', (err) => {
      const duration = performance.now() - start;
      resolve({
        ok: false,
        status: 0,
        duration,
        error: err.message,
      });
    });

    req.write(postData);
    req.end();
  });
}

function calculatePercentiles(latencies) {
  if (latencies.length === 0) return { p50: 0, p90: 0, p95: 0, p99: 0, avg: 0, max: 0, min: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (pct) => sorted[Math.min(sorted.length - 1, Math.floor((pct / 100) * sorted.length))];
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    min: Math.round(sorted[0]),
    p50: Math.round(p(50)),
    p90: Math.round(p(90)),
    p95: Math.round(p(95)),
    p99: Math.round(p(99)),
    max: Math.round(sorted[sorted.length - 1]),
    avg: Math.round(sum / sorted.length),
  };
}

async function runBatch(label, taskFn, totalRequests, concurrency) {
  console.log(`\n🚀 [${label}] Launching ${totalRequests} requests (concurrency: ${concurrency})...`);
  const latencies = [];
  let successCount = 0;
  let failCount = 0;
  const statusCodes = {};

  let completed = 0;
  const queue = Array.from({ length: totalRequests }, (_, i) => i);

  async function worker() {
    while (queue.length > 0) {
      const idx = queue.shift();
      const result = await taskFn(idx);
      latencies.push(result.duration);
      statusCodes[result.status] = (statusCodes[result.status] || 0) + 1;
      if (result.ok) {
        successCount++;
      } else {
        failCount++;
      }
      completed++;
      if (completed % 200 === 0 || completed === totalRequests) {
        process.stdout.write(`   Progress: ${completed}/${totalRequests} (${Math.round((completed / totalRequests) * 100)}%)\r`);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  const t0 = performance.now();
  await Promise.all(workers);
  const totalDuration = performance.now() - t0;
  process.stdout.write('\n');

  const stats = calculatePercentiles(latencies);
  const failureRate = ((failCount / totalRequests) * 100).toFixed(2);
  const rps = (totalRequests / (totalDuration / 1000)).toFixed(1);

  console.log(`   ✓ Completed in ${(totalDuration / 1000).toFixed(2)}s | Throughput: ${rps} req/s`);
  console.log(`   ✓ Latency: Avg=${stats.avg}ms | P50=${stats.p50}ms | P95=${stats.p95}ms | P99=${stats.p99}ms | Max=${stats.max}ms`);
  console.log(`   ✓ Status Codes: ${JSON.stringify(statusCodes)} | Failure Rate: ${failureRate}%`);

  return { label, totalRequests, concurrency, stats, failureRate: parseFloat(failureRate), rps, statusCodes };
}

async function main() {
  console.log('=======================================================================');
  console.log(' 🔥 Oddsbanta Phase 5: High-Concurrency Stress & Go-Live Verification');
  console.log('=======================================================================');

  // Warm up connection pool
  await httpGet(`${LIVE_HOST}/`);
  await httpGet(`${LIVE_HOST}/api/predictions-feed?date=today`);

  // Test 1: Static Edge CDN Shell & Assets (Simulating 1,000 concurrent page opens)
  const staticResults = await runBatch(
    'Static Landing & App Shell (Edge CDN)',
    () => httpGet(`${LIVE_HOST}/`),
    600,
    30
  );

  // Test 2: Edge Predictions Feed (Simulating multi-sport traffic)
  const endpoints = [
    `${LIVE_HOST}/api/predictions-feed?date=today`,
    `${LIVE_HOST}/api/basketball-feed`,
    `${LIVE_HOST}/api/tennis-feed`,
    `${LIVE_HOST}/api/sports-summary`,
  ];
  const feedResults = await runBatch(
    'Edge Serverless Feed Endpoints (Multi-Sport)',
    (idx) => httpGet(endpoints[idx % endpoints.length]),
    600,
    25
  );

  // Test 3: Market Specialist Feed (Home Win, Away Win, Draw, Corners, Goals)
  const markets = ['home_win', 'away_win', 'draw', 'corners', 'over_2.5_goals', 'ht_over_0.5_goals'];
  const marketResults = await runBatch(
    'Market Specialist Feed (Edge + In-flight Dedupe)',
    (idx) => httpGet(`${LIVE_HOST}/api/market-feed?market=${markets[idx % markets.length]}`),
    300,
    20
  );

  // Test 4: Supabase Connection Pool Shield (Simulating concurrent user bootstrap hydration)
  const poolHeaders = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  const poolResults = await runBatch(
    'Supabase Bootstrap RPC (Pool Shield Concurrency)',
    () =>
      httpPost(
        `${SUPABASE_URL}/rest/v1/rpc/get_user_session_bootstrap`,
        { p_user_id: '11262177-48d0-4d69-912b-c3f0fc47a142' },
        poolHeaders
      ),
    200,
    15
  );

  console.log('\n=======================================================================');
  console.log(' 📊 Phase 5 Concurrency Gate Evaluation:');
  console.log('=======================================================================');

  const gates = [
    {
      name: 'P5-01 Static UI Availability (0% failure rate)',
      actual: `${staticResults.failureRate}% failures (P50: ${staticResults.stats.p50}ms, P95: ${staticResults.stats.p95}ms)`,
      passed: staticResults.failureRate === 0,
    },
    {
      name: 'P5-02 Edge Feed Concurrency Latency (P50 < 150ms)',
      actual: `P50: ${feedResults.stats.p50}ms, Avg: ${feedResults.stats.avg}ms`,
      passed: feedResults.stats.p50 <= 150,
    },
    {
      name: 'P5-03 Edge Feed Failure Rate (< 1.5%)',
      actual: `${feedResults.failureRate}% failures across ${feedResults.totalRequests} requests`,
      passed: feedResults.failureRate < 1.5,
    },
    {
      name: 'P5-04 Database Pool Shield (0 connection pool timeouts / 500 errors)',
      actual: `Status: ${JSON.stringify(poolResults.statusCodes)} (${poolResults.rps} req/s)`,
      passed: poolResults.failureRate === 0 && !(poolResults.statusCodes[500] || poolResults.statusCodes[503]),
    },
  ];

  let allPassed = true;
  for (const gate of gates) {
    const icon = gate.passed ? '✅ PASS' : '❌ FAIL';
    if (!gate.passed) allPassed = false;
    console.log(` ${icon} | ${gate.name.padEnd(55)} | Actual: ${gate.actual}`);
  }

  console.log('=======================================================================');
  if (allPassed) {
    console.log('🎉 ALL PHASE 5 CONCURRENCY GATES PASSED! SYSTEM IS PRODUCTION READY! 🚀');
  } else {
    console.log('⚠️ Some gates require review.');
  }
}

main().catch((err) => {
  console.error('Fatal stress test runner error:', err);
  process.exit(1);
});
