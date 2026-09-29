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

const DRY_RUN = process.argv.includes('--execute') ? false : true;

async function api(endpoint, options = {}) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${endpoint}`, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) }
    });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
}

async function cleanupDuplicates() {
    console.log("=================================================================");
    console.log(` JamBets Tennis Fixture Deduplication & Database Cleanup`);
    console.log(` Mode: ${DRY_RUN ? 'DRY RUN (Preview Only)' : 'EXECUTE (Modifying Database)'}`);
    console.log("=================================================================\n");

    const fixRes = await api('tennis_fixtures?select=id,canonical_key,tournament_id,player1_id,player2_id,target_kickoff_at,status,set_scores&order=target_kickoff_at.asc');
    const fixtures = fixRes.data || [];
    console.log(`Total fixtures inspected: ${fixtures.length}`);

    // Group fixtures by player pair and rolling date window (±36h)
    const processed = new Set();
    const duplicateGroups = [];

    for (let i = 0; i < fixtures.length; i++) {
        const f1 = fixtures[i];
        if (processed.has(f1.id)) continue;

        const group = [f1];
        const p1_a = f1.player1_id || '';
        const p2_a = f1.player2_id || '';
        const t1 = new Date(f1.target_kickoff_at || 0).getTime();

        for (let j = i + 1; j < fixtures.length; j++) {
            const f2 = fixtures[j];
            if (processed.has(f2.id)) continue;

            const p1_b = f2.player1_id || '';
            const p2_b = f2.player2_id || '';
            const isSamePair = (p1_a === p1_b && p2_a === p2_b) || (p1_a === p2_b && p2_a === p1_b);

            if (isSamePair) {
                const t2 = new Date(f2.target_kickoff_at || 0).getTime();
                const diffHours = Math.abs(t2 - t1) / (1000 * 3600);
                if (diffHours <= 36.0) {
                    group.push(f2);
                    processed.add(f2.id);
                }
            }
        }

        if (group.length > 1) {
            processed.add(f1.id);
            duplicateGroups.push(group);
        }
    }

    console.log(`Identified ${duplicateGroups.length} duplicate groups to consolidate.\n`);

    let totalMerged = 0;
    let totalRemoved = 0;

    for (const group of duplicateGroups) {
        // Select primary fixture:
        // 1. Prefer finished fixture over scheduled
        // 2. Prefer fixture with set_scores
        // 3. Prefer fixture with later kickoff (rescheduled date)
        group.sort((a, b) => {
            const aFin = a.status === 'finished' ? 1 : 0;
            const bFin = b.status === 'finished' ? 1 : 0;
            if (aFin !== bFin) return bFin - aFin;

            const aScores = a.set_scores ? 1 : 0;
            const bScores = b.set_scores ? 1 : 0;
            if (aScores !== bScores) return bScores - aScores;

            // Later kickoff preferred for rescheduled matches
            return new Date(b.target_kickoff_at).getTime() - new Date(a.target_kickoff_at).getTime();
        });

        const primary = group[0];
        const secondaries = group.slice(1);

        console.log(`Consolidating group: Primary=${primary.id} (${primary.canonical_key} @ ${primary.target_kickoff_at})`);

        for (const sec of secondaries) {
            console.log(`  -> Merging secondary: ${sec.id} (${sec.canonical_key} @ ${sec.target_kickoff_at})`);

            if (!DRY_RUN) {
                // 1. Check predictions linked to secondary
                const predsRes = await api(`tennis_predictions?fixture_id=eq.${sec.id}&select=id`);
                const preds = predsRes.data || [];
                
                // If primary already has predictions, delete secondary's predictions to avoid duplicates
                const primPredsRes = await api(`tennis_predictions?fixture_id=eq.${primary.id}&select=id`);
                const primPreds = primPredsRes.data || [];

                for (const p of preds) {
                    if (primPreds.length > 0) {
                        // Primary already has a prediction, delete secondary settlements and prediction
                        await api(`tennis_settlements?prediction_id=eq.${p.id}`, { method: 'DELETE' });
                        await api(`tennis_predictions?id=eq.${p.id}`, { method: 'DELETE' });
                    } else {
                        // Re-link prediction to primary fixture
                        await api(`tennis_predictions?id=eq.${p.id}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ fixture_id: primary.id })
                        });
                    }
                }

                // 2. Delete any residual settlements on secondary fixture
                await api(`tennis_settlements?fixture_id=eq.${sec.id}`, { method: 'DELETE' });

                // 3. Delete secondary fixture
                const delRes = await api(`tennis_fixtures?id=eq.${sec.id}`, { method: 'DELETE' });
                if (delRes.ok) {
                    totalRemoved++;
                } else {
                    console.error(`     Failed to delete secondary fixture ${sec.id}: ${JSON.stringify(delRes.data)}`);
                }
            }
            totalMerged++;
        }
    }

    console.log("\n=================================================================");
    console.log(` Cleanup Summary:`);
    console.log(` Groups Processed: ${duplicateGroups.length}`);
    console.log(` Secondary Fixtures Merged: ${totalMerged}`);
    console.log(` Secondary Fixtures Removed: ${totalRemoved}`);
    console.log("=================================================================");
}

cleanupDuplicates().catch(console.error);
