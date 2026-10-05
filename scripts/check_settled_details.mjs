import fs from 'fs';

const envText = fs.readFileSync('.env', 'utf-8');
const env = {};
envText.split('\n').forEach(line => {
  const parts = line.trim().split('=');
  const k = parts[0];
  const v = parts.slice(1).join('=');
  if (k) env[k.trim()] = v.trim().replace(/^['"]|['"]$/g, '');
});

async function run() {
  const endpoint = `${env.SUPABASE_URL}/rest/v1/tennis_predictions?settlement_status=eq.void&select=id,confidence_category,secondary_predictions,metadata&limit=1`;
  const res = await fetch(endpoint, {
    headers: { 'apikey': env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }
  });
  const data = await res.json();
  console.log('Settled No Safe secondary_predictions:', JSON.stringify(data[0]?.secondary_predictions, null, 2));
  console.log('Settled No Safe metadata:', JSON.stringify(data[0]?.metadata, null, 2));
}
run();
