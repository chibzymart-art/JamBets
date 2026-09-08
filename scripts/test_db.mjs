// JamBets — Phase 1 Cloud Supabase Verification & Test Suite
// Verifies live Cloud Supabase schemas, relationships, constraints, provenance, and RLS

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
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        env[key] = val;
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

async function runTests() {
    console.log("=================================================================");
    console.log(" JamBets Phase 1: Live Cloud Supabase Direct Verification Suite");
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

    // 1. Verify all 19 required tables are exposed in PostgREST schema
    console.log("--- 1. Schema & Table Verification ---");
    const schemaRes = await fetch(`${SUPABASE_URL}/rest/v1/?apikey=${SERVICE_KEY}`, { headers: adminHeaders });
    const schema = await schemaRes.json();
    const tables = Object.keys(schema.definitions || {});

    const expectedTables = [
        'users', 'subscriptions', 'payments', 'entitlements', 'data_sources',
        'system_jobs', 'audit_logs', 'football_leagues', 'football_teams',
        'football_fixtures', 'football_fixture_sources', 'football_simulations',
        'football_predictions', 'football_prediction_markets', 'football_live_events',
        'football_results', 'football_result_sources', 'football_settlements',
        'football_data_conflicts'
    ];

    for (const t of expectedTables) {
        assert(`Table '${t}' exists in Cloud Supabase`, tables.includes(t), `Found tables: ${tables.join(', ')}`);
    }

    // 2. Verify Seed Data in data_sources
    console.log("\n--- 2. Verified Source Registry Seed Data ---");
    const dsRes = await api('data_sources?select=name,slug,is_active');
    assert("Query data_sources successful", dsRes.ok && Array.isArray(dsRes.data));
    const sourceSlugs = (dsRes.data || []).map(s => s.slug);
    assert("ESPN registered", sourceSlugs.includes('espn'));
    assert("LiveScore registered", sourceSlugs.includes('livescore'));
    assert("Flashscore registered", sourceSlugs.includes('flashscore'));
    assert("Football-Data.org registered", sourceSlugs.includes('football-data-org'));
    assert("API-Football registered", sourceSlugs.includes('api-football'));

    // 3. Verify Seed Data in football_leagues
    console.log("\n--- 3. Football Leagues Seed Data ---");
    const leaguesRes = await api('football_leagues?select=name,country,code');
    assert("Query football_leagues successful", leaguesRes.ok && Array.isArray(leaguesRes.data));
    const leagueCodes = (leaguesRes.data || []).map(l => l.code);
    assert("Premier League registered", leagueCodes.includes('ENG_PL'));
    assert("Champions League registered", leagueCodes.includes('EUR_CL'));

    // 4. Test Simulation Engine & 250,000 constraint
    console.log("\n--- 4. Simulation Engine Constraints (TARGET = 250,000) ---");
    const premLeague = (leaguesRes.data || []).find(l => l.code === 'ENG_PL');
    
    // Create test teams for testing relationships
    const team1Res = await api('football_teams', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Arsenal Test FC',
            short_name: 'ARS'
        })
    });
    const team2Res = await api('football_teams', {
        method: 'POST',
        body: JSON.stringify({
            name: 'Chelsea Test FC',
            short_name: 'CHE'
        })
    });
    assert("Insert test teams", team1Res.ok && team2Res.ok);

    const team1 = Array.isArray(team1Res.data) ? team1Res.data[0] : team1Res.data;
    const team2 = Array.isArray(team2Res.data) ? team2Res.data[0] : team2Res.data;

    // Create test fixture
    const now = new Date();
    const kickoff = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days from now (within 4-day window)
    const fixtureRes = await api('football_fixtures', {
        method: 'POST',
        body: JSON.stringify({
            league_id: premLeague ? premLeague.id : undefined,
            home_team_id: team1.id,
            away_team_id: team2.id,
            target_kickoff_at: kickoff.toISOString(),
            status: 'scheduled'
        })
    });
    assert("Insert test fixture", fixtureRes.ok);
    const fixture = Array.isArray(fixtureRes.data) ? fixtureRes.data[0] : fixtureRes.data;

    // Test simulation record with non-250k target (should fail check constraint)
    const badSimRes = await api('football_simulations', {
        method: 'POST',
        body: JSON.stringify({
            fixture_id: fixture.id,
            target_simulations: 100000 // VIOLATES CHECK (target_simulations = 250000)
        })
    });
    assert("Simulation target != 250000 rejected by CHECK constraint", !badSimRes.ok, `Status: ${badSimRes.status}`);

    // Test valid 250k simulation record
    const validSimRes = await api('football_simulations', {
        method: 'POST',
        body: JSON.stringify({
            fixture_id: fixture.id,
            target_simulations: 250000,
            completed_simulations: 250000,
            status: 'completed',
            run_tracking: { seed: 42, iterations: 250000 }
        })
    });
    assert("Simulation target = 250,000 accepted and verified", validSimRes.ok);
    const sim = Array.isArray(validSimRes.data) ? validSimRes.data[0] : validSimRes.data;

    // 5. Test Four-Day Rule on Fixtures
    console.log("\n--- 5. Four-Day Rule Constraint ---");
    const distantKickoff = new Date(now.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days from now (> 4 days)
    const badFixtureRes = await api('football_fixtures', {
        method: 'POST',
        body: JSON.stringify({
            home_team_id: team1.id,
            away_team_id: team2.id,
            target_kickoff_at: distantKickoff.toISOString(), // VIOLATES 4-day window
            status: 'scheduled'
        })
    });
    assert("Fixture beyond 4 days rejected by check_four_day_rule", !badFixtureRes.ok, `Status: ${badFixtureRes.status}`);

    // 6. Test Minimum Published Probability (>= 45%) Constraint on Predictions
    console.log("\n--- 6. Minimum Published Probability (>= 45%) Constraint ---");
    const lowProbPredRes = await api('football_predictions', {
        method: 'POST',
        body: JSON.stringify({
            fixture_id: fixture.id,
            simulation_id: sim.id,
            market: '1x2',
            prediction: 'draw',
            probability: 0.3200, // < 45%
            confidence_category: 'low',
            publication_status: 'published', // Published with < 45% should fail!
            target_kickoff_at: kickoff.toISOString()
        })
    });
    assert("Published prediction with probability < 45% rejected by CHECK constraint", !lowProbPredRes.ok, `Status: ${lowProbPredRes.status}`);

    // Test valid published prediction (>= 45%)
    const validPredRes = await api('football_predictions', {
        method: 'POST',
        body: JSON.stringify({
            fixture_id: fixture.id,
            simulation_id: sim.id,
            market: '1x2',
            prediction: 'home',
            probability: 0.5820,
            confidence_category: 'high',
            publication_status: 'published',
            tier_required: 'free',
            target_kickoff_at: kickoff.toISOString()
        })
    });
    assert("Valid published prediction (58.2% prob) accepted", validPredRes.ok);
    const pred = Array.isArray(validPredRes.data) ? validPredRes.data[0] : validPredRes.data;

    // 7. Test Real Data Principle on Results (NO VERIFIED DATA = NO SETTLEMENT)
    console.log("\n--- 7. Real Data Principle (>= 2 agreeing sources required for verified status) ---");
    const badResultRes = await api('football_results', {
        method: 'POST',
        body: JSON.stringify({
            fixture_id: fixture.id,
            home_score: 2,
            away_score: 1,
            status: 'verified',
            agreeing_sources_count: 0,
            verification_timestamp: new Date().toISOString()
        })
    });
    assert("Result marked 'verified' with 0 sources rejected by CHECK constraint", !badResultRes.ok, `Status: ${badResultRes.status}`);

    // Valid result with >= 2 sources and timestamp
    const validResultRes = await api('football_results', {
        method: 'POST',
        body: JSON.stringify({
            fixture_id: fixture.id,
            home_score: 2,
            away_score: 1,
            status: 'verified',
            agreeing_sources_count: 2,
            verification_timestamp: new Date().toISOString()
        })
    });
    assert("Result marked 'verified' with 2 sources and timestamp accepted", validResultRes.ok);
    const result = Array.isArray(validResultRes.data) ? validResultRes.data[0] : validResultRes.data;

    // 8. Test Settlements & Provenance
    console.log("\n--- 8. Settlement Records & Provenance ---");
    const settlementRes = await api('football_settlements', {
        method: 'POST',
        body: JSON.stringify({
            prediction_id: pred.id,
            result_id: result.id,
            status: 'won',
            outcome: 'home_win',
            result_source: 'espn + livescore',
            provider_event_id: 'espn-12345',
            verification_timestamp: new Date().toISOString(),
            actual_score: '2-1',
            settlement_timestamp: new Date().toISOString()
        })
    });
    assert("Settlement record with verification provenance stored", settlementRes.ok);

    // 9. Test RLS Protection
    console.log("\n--- 9. Row-Level Security (RLS) Enforcement ---");
    // Anonymous user can read public fixtures
    const anonFixturesRes = await api('football_fixtures?select=id,status', {}, true);
    assert("Anon user can read public fixtures (RLS policy)", anonFixturesRes.ok && Array.isArray(anonFixturesRes.data));

    // Anonymous user can read published predictions
    const anonPredsRes = await api('football_predictions?select=id,probability', {}, true);
    assert("Anon user can read published predictions (RLS policy)", anonPredsRes.ok && Array.isArray(anonPredsRes.data));

    // Anonymous user should NOT be able to insert fixtures
    const anonInsertFixtureRes = await api('football_fixtures', {
        method: 'POST',
        body: JSON.stringify({
            home_team_id: team1.id,
            away_team_id: team2.id,
            target_kickoff_at: kickoff.toISOString()
        })
    }, true);
    assert("Anon user BLOCKED from inserting fixtures (RLS write policy enforced)", !anonInsertFixtureRes.ok);

    // Cleanup test data
    console.log("\n--- Cleanup Test Records ---");
    await api(`football_settlements?prediction_id=eq.${pred.id}`, { method: 'DELETE' });
    await api(`football_predictions?id=eq.${pred.id}`, { method: 'DELETE' });
    await api(`football_results?id=eq.${result.id}`, { method: 'DELETE' });
    await api(`football_simulations?id=eq.${sim.id}`, { method: 'DELETE' });
    await api(`football_fixtures?id=eq.${fixture.id}`, { method: 'DELETE' });
    await api(`football_teams?id=eq.${team1.id}`, { method: 'DELETE' });
    await api(`football_teams?id=eq.${team2.id}`, { method: 'DELETE' });
    console.log(" [INFO] Cleaned up temporary test fixture & teams.");

    console.log("\n=================================================================");
    console.log(` Summary: ${passed} PASSED, ${failed} FAILED`);
    console.log("=================================================================");

    if (failed > 0) process.exit(1);
}

runTests().catch(err => {
    console.error("Test execution failed:", err);
    process.exit(1);
});
