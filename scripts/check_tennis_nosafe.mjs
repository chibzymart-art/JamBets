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
  const endpoint = `${url}/rest/v1/tennis_predictions?settlement_status=neq.pending&order=target_kickoff_at.desc&limit=15&select=id,fixture_id,market,prediction,probability,confidence_category,settlement_status,secondary_predictions,metadata`;
  const res = await fetch(endpoint, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`
    }
  });

  const data = await res.json();
  console.log('Metadata sample:', JSON.stringify(data[0]?.metadata, null, 2));
  return;
  for (const d of data) {
    console.log({
      id: d.id,
      status: d.settlement_status,
      prediction: d.prediction,
      secType: typeof d.secondary_predictions,
      secLength: Array.isArray(d.secondary_predictions) ? d.secondary_predictions.length : d.secondary_predictions,
      sampleSec: Array.isArray(d.secondary_predictions) && d.secondary_predictions.length > 0 ? d.secondary_predictions[0] : null,
      metaKeys: d.metadata ? Object.keys(d.metadata) : null
    });
  }
}
run();
