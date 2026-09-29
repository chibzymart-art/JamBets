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

async function findDuplicates() {
    console.log("=== Finding Tennis Fixture Duplicates in Cloud Supabase ===");
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/tennis_fixtures?select=id,canonical_key,tournament_id,player1_id,player2_id,target_kickoff_at,status,tournament:tennis_tournaments(name)&order=target_kickoff_at.asc`, { headers });
    const fixtures = await res.json();
    console.log(`Total fixtures loaded: ${fixtures.length}`);

    const pairsMap = new Map();
    const duplicates = [];

    for (const f of fixtures) {
        const p1 = f.player1_id || '';
        const p2 = f.player2_id || '';
        const pMin = p1 < p2 ? p1 : p2;
        const pMax = p1 < p2 ? p2 : p1;
        const dateKey = (f.target_kickoff_at || '').substring(0, 10);
        const pairKey = `${pMin}:${pMax}:${dateKey}`;

        if (!pairsMap.has(pairKey)) {
            pairsMap.set(pairKey, [f]);
        } else {
            pairsMap.get(pairKey).push(f);
        }
    }

    for (const [key, group] of pairsMap.entries()) {
        if (group.length > 1) {
            duplicates.push(group);
        }
    }

    console.log(`\nFound ${duplicates.length} duplicate groups!`);
    for (const group of duplicates) {
        console.log(`\n--- Duplicate Group (${group.length} fixtures) ---`);
        for (const f of group) {
            console.log(`• ID: ${f.id} | Tourney: ${f.tournament?.name} | Kickoff: ${f.target_kickoff_at} | Status: ${f.status} | Key: ${f.canonical_key}`);
            
            // Check predictions for this fixture
            const pRes = await fetch(`${env.SUPABASE_URL}/rest/v1/tennis_predictions?fixture_id=eq.${f.id}&select=id,prediction,probability,confidence_category`, { headers });
            const preds = await pRes.json();
            console.log(`   Predictions (${preds.length}):`, preds.map(p => `${p.id} (${p.prediction})`));

            // Check settlements for this fixture
            const sRes = await fetch(`${env.SUPABASE_URL}/rest/v1/tennis_settlements?fixture_id=eq.${f.id}&select=id,status`, { headers });
            const settles = await sRes.json();
            console.log(`   Settlements (${settles.length}):`, settles.map(s => `${s.id} (${s.status})`));
        }
    }
}

findDuplicates();
