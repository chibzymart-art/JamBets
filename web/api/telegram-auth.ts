export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://vepcoopomlfjageijsew.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZlcGNvb3BvbWxmamFnZWlqc2V3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NTM4NzIsImV4cCI6MjEwNDQyOTg3Mn0.KMbk71HHpEX_RzdMgFy_jYO6DhE3iwd50aHv9waWh2g';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const TELEGRAM_BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'Oddsbanta_bot';

export default async function handler(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Authenticate caller: require Authorization Bearer token (SEC-01 IDOR fix)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Missing or invalid authorization token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const userJwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!userJwt) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Empty bearer token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Validate token against Supabase Auth API
    const authUserRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${userJwt}`,
      },
    });

    if (!authUserRes.ok) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Session invalid or expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const authUserData = await authUserRes.json();
    const verifiedUserId = authUserData?.id;

    if (!verifiedUserId) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized: Could not resolve authenticated user' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ success: false, error: 'Database service credentials not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Cryptographically secure 8-character token (SEC-05 entropy fix: ~1.07 billion permutations)
    const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomBytes = new Uint8Array(6);
    crypto.getRandomValues(randomBytes);
    const tokenSuffix = Array.from(randomBytes).map(b => charset[b % charset.length]).join('');
    const token = `ODDS-${tokenSuffix}`;

    // Token expires in 5 minutes (reduced from 15 mins for tighter security window)
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const headers = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Save token to verified user row in public.users
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?id=eq.${verifiedUserId}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          telegram_auth_token: token,
          telegram_auth_expires_at: expiresAt,
        }),
      }
    );

    if (!patchRes.ok) {
      return new Response(JSON.stringify({ success: false, error: 'Failed to record connection code in database' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const deepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`;

    return new Response(
      JSON.stringify({
        success: true,
        token,
        expiresAt,
        botUsername: TELEGRAM_BOT_USERNAME,
        deepLink,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
