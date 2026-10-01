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
        env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
    }
}

const SUPABASE_URL = env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const headers = {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
};

const TODAY_ISO = '2026-10-01T00:00:00Z';

async function wipeTable(predTable, settTable, name) {
    console.log(`\n======================================================`);
    console.log(`Processing ${name} (${predTable})...`);
    
    // 1. Fetch all predictions with target_kickoff_at >= TODAY_ISO
    const fetchUrl = `${SUPABASE_URL}/rest/v1/${predTable}?select=id,target_kickoff_at&target_kickoff_at=gte.${TODAY_ISO}`;
    const fetchRes = await fetch(fetchUrl, { headers });
    if (!fetchRes.ok) {
        console.error(`Failed to fetch ${predTable}: ${fetchRes.status} ${await fetchRes.text()}`);
        return;
    }
    const preds = await fetchRes.json();
    console.log(`Found ${preds.length} ${predTable} records with target_kickoff_at >= ${TODAY_ISO}`);

    if (preds.length === 0) {
        console.log(`Nothing to delete in ${predTable}.`);
        return;
    }

    const ids = preds.map(p => p.id);

    // 2. Delete corresponding settlements in batches if settlement table exists
    if (settTable) {
        const batchSize = 40;
        let deletedSettlements = 0;
        for (let i = 0; i < ids.length; i += batchSize) {
            const batch = ids.slice(i, i + batchSize);
            const inFilter = `in.(${batch.join(',')})`;
            const settRes = await fetch(`${SUPABASE_URL}/rest/v1/${settTable}?prediction_id=${inFilter}`, {
                method: 'DELETE',
                headers
            });
            if (settRes.ok) {
                const deleted = await settRes.json();
                deletedSettlements += (Array.isArray(deleted) ? deleted.length : 0);
            }
        }
        console.log(`Deleted ${deletedSettlements} associated ${settTable} records.`);
    }

    // 3. Delete predictions in batches
    const batchSize = 40;
    let deletedPreds = 0;
    for (let i = 0; i < ids.length; i += batchSize) {
        const batch = ids.slice(i, i + batchSize);
        const inFilter = `in.(${batch.join(',')})`;
        const delRes = await fetch(`${SUPABASE_URL}/rest/v1/${predTable}?id=${inFilter}`, {
            method: 'DELETE',
            headers
        });
        if (delRes.ok) {
            const deleted = await delRes.json();
            deletedPreds += (Array.isArray(deleted) ? deleted.length : 0);
        } else {
            console.error(`Error deleting batch from ${predTable}:`, delRes.status, await delRes.text());
        }
    }
    console.log(`Successfully deleted ${deletedPreds} / ${preds.length} records from ${predTable}.`);
}

async function run() {
    console.log("=================================================================");
    console.log(" JamBets Clean Wipe: Predictions From Today Onwards (>= 2026-10-01)");
    console.log("=================================================================");

    await wipeTable('tennis_predictions', 'tennis_settlements', 'Tennis');
    await wipeTable('football_predictions', 'football_settlements', 'Football');
    await wipeTable('basketball_predictions', 'basketball_settlements', 'Basketball');

    console.log("\n[COMPLETE] All targeted predictions from today onwards wiped.");
}

run().catch(err => {
    console.error("Fatal error during wipe:", err);
    process.exit(1);
});
