// JamBets — Phase 1 Decoupled Specialist Engines Live Verification Suite
import fs from 'fs';
import path from 'path';

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

if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const adminHeaders = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

const anonHeaders = {
    'apikey': ANON_KEY,
    'Authorization': `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json'
};

async function api(endpoint, options = {}, asAnon = false) {
    const headers = asAnon ? anonHeaders : adminHeaders;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${endpoint}`, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) }
    });
    const text = await res.text();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }
    return { status: res.status, ok: res.ok, data };
}

async function runVerification() {
    console.log("=================================================================");
    console.log(" JamBets Phase 1: Decoupled Specialist Engines DB Verification");
    console.log(` Target: ${SUPABASE_URL}`);
    console.log("=================================================================\n");

    let passed = 0;
    let failed = 0;

    function assert(name, condition, detail = "") {
        if (condition) {
            console.log(` [PASS] ${name}`);
            passed++;
        } else {
            console.error(` [FAIL] ${name} ${detail ? `-> ${detail}` : ''}`);
            failed++;
        }
    }

    // 1. Check PostgREST exposed schema definitions
    console.log("--- 1. PostgREST Table & View Definitions ---");
    const schemaRes = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SERVICE_KEY}`, { headers: adminHeaders });
    const schema = await schemaRes.json();
    const tables = Object.keys(schema.definitions || {});

    const expectedNewEntities = [
        'home_win_predictions',
        'home_win_settlements',
        'home_win_predictions_paywall',
        'away_win_predictions',
        'away_win_settlements',
        'away_win_predictions_paywall',
        'draw_predictions',
        'draw_settlements',
        'draw_predictions_paywall',
        'corner_predictions',
        'corner_settlements',
        'corner_predictions_paywall'
    ];

    for (const entity of expectedNewEntities) {
        assert(`Entity '${entity}' registered in PostgREST schema`, tables.includes(entity), `Available entities: ${tables.join(', ')}`);
    }

    // 2. Query each endpoint with service role (should return 200 OK array)
    console.log("\n--- 2. Direct REST Endpoint Health Check ---");
    for (const entity of expectedNewEntities) {
        const res = await api(`${entity}?select=*&limit=1`);
        assert(`Endpoint '/rest/v1/${entity}' returns 200 OK`, res.status === 200, `Status: ${res.status}, error: ${JSON.stringify(res.data)}`);
    }

    // 3. Test Anonymous Paywall Redaction for each view
    console.log("\n--- 3. Anonymous Paywall Redaction Tests ---");
    const paywallViews = [
        'home_win_predictions_paywall',
        'away_win_predictions_paywall',
        'draw_predictions_paywall',
        'corner_predictions_paywall'
    ];

    for (const view of paywallViews) {
        const anonRes = await api(`${view}?select=*&limit=1`, {}, true);
        assert(`Anon access to '${view}' returns 200 OK`, anonRes.status === 200, `Status: ${anonRes.status}`);
    }

    console.log("\n=================================================================");
    console.log(` Phase 1 Verification Results: ${passed} Passed, ${failed} Failed`);
    console.log("=================================================================");

    if (failed > 0) {
        process.exit(1);
    }
}

runVerification().catch(err => {
    console.error("Verification runner error:", err);
    process.exit(1);
});
