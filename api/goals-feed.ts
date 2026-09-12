export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization') || `Bearer ${SUPABASE_ANON_KEY}`;

    const selectQuery = encodeURIComponent(
      `id,fixture_id,market,predicted_outcome,probability,confidence_tier,xg_combined,home_over25_rate,away_over25_rate,h2h_over25_rate,ht_goal_frequency,avg_first_goal_minute,target_kickoff_at,settlement_status,settled_at,actual_score,ht_score,settlement_notes,metadata,is_locked,fixture:football_fixtures!inner(id,canonical_key,target_kickoff_at,status,queue_day,in_prediction_queue,home_score,away_score,match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,metadata,league:football_leagues!inner(id,name,code,country),home_team:football_teams!football_fixtures_home_team_id_fkey(id,name),away_team:football_teams!football_fixtures_away_team_id_fkey(id,name))`
    );

    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: authHeader,
      Accept: 'application/json',
    };

    const [goalsRes, leagueRes] = await Promise.all([
      fetch(
        `${SUPABASE_URL}/rest/v1/goals_predictions_paywall?select=${selectQuery}&order=target_kickoff_at.asc&limit=1000`,
        { headers }
      ),
      fetch(
        `${SUPABASE_URL}/rest/v1/football_leagues?select=id,name,code,country&order=name.asc`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
      ),
    ]);

    if (!goalsRes.ok || !leagueRes.ok) {
      throw new Error(`Supabase upstream status: goals=${goalsRes.status}, league=${leagueRes.status}`);
    }

    const [goalsPredictions, leagues] = await Promise.all([
      goalsRes.json(),
      leagueRes.json(),
    ]);

    return new Response(
      JSON.stringify({
        success: true,
        cached_at: new Date().toISOString(),
        predictions: goalsPredictions,
        leagues,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
          'CDN-Cache-Control': 'public, s-maxage=30',
          'Vercel-CDN-Cache-Control': 'public, s-maxage=30',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Failed to fetch goals feed',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
