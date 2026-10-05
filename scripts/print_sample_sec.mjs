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
  const endpoint = `${url}/rest/v1/tennis_predictions?confidence_category=ilike.*NO_SAFE*&settlement_status=neq.pending&limit=30&select=id,fixture_id,market,prediction,confidence_category,settlement_status,settlement_notes,secondary_predictions,metadata,actual_result,fixture:tennis_fixtures(id,set_scores)`;
  const res = await fetch(endpoint, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });

  const data = await res.json();
  if (!Array.isArray(data)) {
    console.error('Data error:', data);
    return;
  }
  const withSecs = data.find(d => Array.isArray(d.secondary_predictions) && d.secondary_predictions.length > 0);
  if (withSecs) {
    console.log('Sample withSecs prediction:', withSecs.prediction);
    console.log('Sample withSecs secondary_predictions:', JSON.stringify(withSecs.secondary_predictions, null, 2));
  } else {
    console.log('None found with secondary_predictions > 0 in first 30');
  }
}
run();
