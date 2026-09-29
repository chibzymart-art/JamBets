import fs from 'fs';
import path from 'path';

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

const headers = {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
};

async function auditPendingCorners() {
    console.log("=================================================================");
    console.log(" JamBets Corner Prediction Backlog Deep Audit");
    console.log("=================================================================\n");

    const now = new Date();
    const nowIso = now.toISOString();

    // Fetch all pending corner predictions
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/corner_predictions?settlement_status=eq.pending&select=id,fixture_id,market,prediction,target_kickoff_at,publication_status&order=target_kickoff_at.asc`, { headers });
    const pending = await res.json();
    console.log(`Total Pending Corner Predictions: ${pending.length}`);

    // Separate future from past
    const future = pending.filter(p => p.target_kickoff_at >= nowIso);
    const past = pending.filter(p => p.target_kickoff_at < nowIso);

    console.log(`• Future / Upcoming (Active): ${future.length}`);
    console.log(`• Past Kickoff (Backlog Candidates): ${past.length}\n`);

    // Fetch all corresponding fixtures
    const fixIds = Array.from(new Set(past.map(p => p.fixture_id).filter(Boolean)));
    console.log(`Unique fixture IDs to evaluate: ${fixIds.length}`);

    const fixturesMap = new Map();
    // Batch in chunks of 50
    for (let i = 0; i < fixIds.length; i += 50) {
        const chunk = fixIds.slice(i, i + 50);
        const fRes = await fetch(`${env.SUPABASE_URL}/rest/v1/football_fixtures?id=in.(${chunk.join(',')})&select=id,status,target_kickoff_at,home_score,away_score,corners_home,corners_away,home_team:football_teams!football_fixtures_home_team_id_fkey(name),away_team:football_teams!football_fixtures_away_team_id_fkey(name),league:football_leagues(name,country)`, { headers });
        const fList = await fRes.json();
        if (Array.isArray(fList)) {
            fList.forEach(f => fixturesMap.set(f.id, f));
        }
    }

    const catA = []; // Ready to settle (has corners_home & corners_away)
    const catB = []; // Finished, but corners are null
    const catC = []; // Orphaned (no fixture found in football_fixtures)
    const catD = []; // Match status still scheduled or in-play or cancelled

    for (const p of past) {
        const f = fixturesMap.get(p.fixture_id);
        if (!f) {
            catC.push(p);
            continue;
        }

        const ch = f.corners_home;
        const ca = f.corners_away;
        const hasCorners = ch !== null && ca !== null && (Number(ch) > 0 || Number(ca) > 0);
        const status = (f.status || '').toLowerCase();
        const isFinished = ['finished', 'ft', 'aet', 'pen', 'completed'].includes(status);

        if (hasCorners && isFinished) {
            catA.push({ pred: p, fixture: f });
        } else if (isFinished && !hasCorners) {
            catB.push({ pred: p, fixture: f });
        } else if (['cancelled', 'postponed', 'abandoned'].includes(status)) {
            catD.push({ pred: p, fixture: f, reason: status });
        } else {
            catB.push({ pred: p, fixture: f });
        }
    }

    console.log("=== Category Breakdown ===");
    console.log(`• Category A (Has verified corners, ready to settle immediately): ${catA.length}`);
    console.log(`• Category B (Finished, needs corner boxscore enrichment or void if unrecorded): ${catB.length}`);
    console.log(`• Category C (Orphaned fixture IDs not in football_fixtures): ${catC.length}`);
    console.log(`• Category D (Cancelled / Postponed matches): ${catD.length}`);

    if (catA.length > 0) {
        console.log("\nSample Category A (Ready to settle):");
        catA.slice(0, 3).forEach(x => {
            console.log(`  - Match: ${x.fixture.home_team?.name} vs ${x.fixture.away_team?.name} | Kickoff: ${x.pred.target_kickoff_at} | Corners: ${x.fixture.corners_home}-${x.fixture.corners_away} | Pick: ${x.pred.prediction}`);
        });
    }

    if (catB.length > 0) {
        console.log("\nSample Category B (Needs corner boxscore):");
        catB.slice(0, 5).forEach(x => {
            console.log(`  - Match: ${x.fixture.home_team?.name} vs ${x.fixture.away_team?.name} (${x.fixture.league?.name || 'League'}) | Score: ${x.fixture.home_score}-${x.fixture.away_score} | Kickoff: ${x.pred.target_kickoff_at} | Pick: ${x.pred.prediction}`);
        });
    }

    if (catC.length > 0) {
        console.log("\nSample Category C (Orphaned predictions):");
        catC.slice(0, 5).forEach(x => {
            console.log(`  - Pred ID: ${x.id} | Fixture ID: ${x.fixture_id} | Kickoff: ${x.target_kickoff_at} | Pick: ${x.prediction}`);
        });
    }
}

auditPendingCorners().catch(console.error);
