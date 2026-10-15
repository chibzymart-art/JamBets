// JamBets / Oddsbanta: Self-Service Customer Billing Portal Route
// Allows authenticated VIP customers to update cards and manage/cancel subscriptions securely

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://vepcoopomlfjageijsew.supabase.co';

const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const BACHS_API_URL = process.env.BACHS_API_URL || 'https://api.bachs.io';
const BACHS_API_KEY = process.env.BACHS_API_KEY || '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    // 1. Verify Caller Authentication via Supabase JWT
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authentication required' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    const token = authHeader.slice(7).trim();
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!authRes.ok) {
      return new Response(JSON.stringify({ error: 'Invalid or expired authentication token' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    const authUser = await authRes.json();
    if (!authUser || !authUser.id) {
      return new Response(JSON.stringify({ error: 'Could not resolve user identity' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    // 2. Fetch Bachs Customer ID for this user from public.subscriptions
    const dbKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    const subRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}&select=bachs_customer_id,status,tier&limit=1`,
      { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
    );

    if (!subRes.ok) {
      return new Response(JSON.stringify({ error: 'Failed to query subscription status' }), {
        status: 500,
        headers: CORS_HEADERS,
      });
    }

    const subRows = await subRes.json();
    const customerId = subRows && subRows[0]?.bachs_customer_id;

    if (!customerId) {
      return new Response(
        JSON.stringify({
          error: 'No active Bachs billing profile found. You must have an active subscription to access the portal.',
        }),
        { status: 404, headers: CORS_HEADERS }
      );
    }

    // 3. Request Customer Portal Session from Bachs
    const portalRes = await fetch(`${BACHS_API_URL}/v1/customers/${customerId}/portal-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BACHS_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const portalData = await portalRes.json();

    if (!portalRes.ok) {
      console.error('[BACHS-PORTAL] Upstream error creating portal session:', portalData);
      return new Response(
        JSON.stringify({
          error: portalData.detail || portalData.message || 'Could not open billing portal',
        }),
        { status: portalRes.status, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        url: portalData.url,
        id: portalData.id,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    console.error('[BACHS-PORTAL] Unexpected Exception:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
