import fs from 'fs';

const envText = fs.readFileSync('.env', 'utf-8');
const env = {};
envText.split('\n').forEach(line => {
  const parts = line.trim().split('=');
  const k = parts[0];
  const v = parts.slice(1).join('=');
  if (k) env[k.trim()] = v.trim().replace(/^['"]|['"]$/g, '');
});

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function run() {
  const endpoint = `${url}/rest/v1/tennis_predictions?settlement_status=neq.pending&select=id,fixture_id,market,prediction,confidence_category,settlement_status,settlement_notes,secondary_predictions,metadata,actual_result,fixture:tennis_fixtures(id,status,score_p1_sets,score_p2_sets,set_scores,player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name),player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name))`;
  const res = await fetch(endpoint, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });

  const data = await res.json();
  console.log(`Found ${data.length} settled tennis predictions:`);
  for (const d of data) {
    const isNoBanker = (d.confidence_category || '').includes('NO_SAFE');
    const p1 = d.fixture?.player1?.display_name || 'P1';
    const p2 = d.fixture?.player2?.display_name || 'P2';
    const sets = `${d.fixture?.score_p1_sets}-${d.fixture?.score_p2_sets}`;
    const setScores = d.fixture?.set_scores;
    console.log(`- [${d.settlement_status}] ${isNoBanker ? '⚡ NO SAFE' : 'STANDARD'}: ${p1} vs ${p2} | Sets: ${sets} (${JSON.stringify(setScores)}) | Sec count: ${d.secondary_predictions?.length || 0}`);
  }
}
run();
