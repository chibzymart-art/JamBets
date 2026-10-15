// JamBets / Oddsbanta: Server-Authoritative Checkout Session Initiator
// Strictly Protected: Zero-Cheat, Server-Controlled Pricing, JWT Verified

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

// Server-controlled immutable product catalog (Anti-Tamper: Client CANNOT modify price or ID)
const PRODUCT_CATALOG: Record<string, Record<string, string>> = {
  USD: {
    standard: process.env.BACHS_PROD_STANDARD_MONTHLY || 'prod_0aa1ef3ca6634e68b521',
    bigbang: process.env.BACHS_PROD_BIGBANG_MONTHLY || 'prod_374d727781934ee6b6a8',
  },
  NGN: {
    standard: process.env.BACHS_PROD_STANDARD_NGN || 'prod_212591bd3ed94e3ab424',
    bigbang: process.env.BACHS_PROD_BIGBANG_NGN || 'prod_b2260d0a8f214051ba4a',
  },
};

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
    if (!authUser || !authUser.id || !authUser.email) {
      return new Response(JSON.stringify({ error: 'Could not resolve user identity' }), {
        status: 401,
        headers: CORS_HEADERS,
      });
    }

    // 2. Validate Requested Tier and Currency
    const body = await req.json().catch(() => ({}));
    const requestedTier = (body.tier || '').toLowerCase().trim();
    const requestedCurrency = (body.currency || 'USD').toUpperCase().trim();

    if (requestedCurrency !== 'USD' && requestedCurrency !== 'NGN') {
      return new Response(
        JSON.stringify({
          error: `Invalid currency: "${requestedCurrency}". Supported currencies: USD, NGN.`,
        }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const tierCatalog = PRODUCT_CATALOG[requestedCurrency];
    if (!requestedTier || !tierCatalog || !tierCatalog[requestedTier]) {
      return new Response(
        JSON.stringify({
          error: `Invalid tier specified: "${requestedTier}". Allowed: standard, bigbang.`,
        }),
        { status: 400, headers: CORS_HEADERS }
      );
    }

    const productId = tierCatalog[requestedTier];

    // 3. Check for existing Bachs customer ID in Supabase
    let existingCustomerId: string | null = null;
    const dbKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    try {
      const subCheckRes = await fetch(
        `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${authUser.id}&select=bachs_customer_id&limit=1`,
        {
          headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` },
        }
      );
      if (subCheckRes.ok) {
        const subCheckData = await subCheckRes.json();
        if (subCheckData && subCheckData[0]?.bachs_customer_id) {
          existingCustomerId = subCheckData[0].bachs_customer_id;
        }
      }
    } catch (e) {
      console.warn('[BACHS-CHECKOUT] Warning checking customer ID:', e);
    }

    // 4. Construct Bachs Checkout Payload
    const customerPayload = existingCustomerId
      ? { customer_id: existingCustomerId }
      : {
          email: authUser.email,
          name: authUser.user_metadata?.display_name || authUser.email.split('@')[0],
        };

    const checkoutPayload = {
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: customerPayload,
      billing_currency: requestedCurrency,
      metadata: {
        user_id: authUser.id,
        user_email: authUser.email,
        tier: requestedTier,
        currency: requestedCurrency,
        cycle: requestedCurrency === 'NGN' ? '30_day_pass' : 'monthly_subscription',
      },
      success_url: 'https://www.oddsbanta.com/subscription?status=success',
      cancel_url: 'https://www.oddsbanta.com/subscription?status=cancelled',
    };

    // 5. Call Bachs API
    let bachsRes = await fetch(`${BACHS_API_URL}/v1/checkout-sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BACHS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(checkoutPayload),
    });

    let bachsData = await bachsRes.json();

    // Self-Healing Fallback: If existing customer_id was rejected as not found upstream, retry with email
    if (!bachsRes.ok && existingCustomerId && String(bachsData.detail || '').toLowerCase().includes('not found')) {
      console.warn(`[BACHS-CHECKOUT] Upstream customer ID ${existingCustomerId} not found. Retrying with email.`);
      checkoutPayload.customer = {
        email: authUser.email,
        name: authUser.user_metadata?.display_name || authUser.email.split('@')[0],
      };
      bachsRes = await fetch(`${BACHS_API_URL}/v1/checkout-sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${BACHS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(checkoutPayload),
      });
      bachsData = await bachsRes.json();
    }

    if (!bachsRes.ok) {
      console.error('[BACHS-CHECKOUT] Bachs API Error:', bachsData);
      return new Response(
        JSON.stringify({
          error: bachsData.detail || bachsData.message || 'Payment initiation failed upstream',
          code: bachsData.error_code || 'UPSTREAM_ERROR',
        }),
        { status: bachsRes.status, headers: CORS_HEADERS }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        checkout_id: bachsData.checkout_id,
        checkout_url: bachsData.checkout_url,
        mode: bachsData.mode,
        currency: requestedCurrency,
        amount: bachsData.amount,
        expires_at: bachsData.expires_at,
      }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err: any) {
    console.error('[BACHS-CHECKOUT] Unexpected Exception:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
}
