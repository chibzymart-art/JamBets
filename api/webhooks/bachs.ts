// JamBets / Oddsbanta: Cryptographic Webhook Handler for Bachs.io
// Enforces HMAC-SHA256 Signature Verification, Anti-Replay Idempotency, and Automatic VIP Entitlement

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://vepcoopomlfjageijsew.supabase.co';

const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BACHS_WEBHOOK_SECRET = process.env.BACHS_WEBHOOK_SECRET || '';
const BACHS_PROD_BIGBANG = process.env.BACHS_PROD_BIGBANG_MONTHLY || 'prod_374d727781934ee6b6a8';
const BACHS_PROD_BIGBANG_NGN = process.env.BACHS_PROD_BIGBANG_NGN || 'prod_b2260d0a8f214051ba4a';
const BACHS_PROD_STANDARD_NGN = process.env.BACHS_PROD_STANDARD_NGN || 'prod_212591bd3ed94e3ab424';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Oddsbanta <welcome@oddsbanta.com>';

// Cryptographic HMAC-SHA256 Verifier using Web Crypto API
async function verifyBachsWebhook(
  signatureV2: string | null,
  signatureV1: string | null,
  timestampHeader: string | null,
  rawBody: string,
  secret: string,
  toleranceSeconds = 300
): Promise<boolean> {
  if (!secret) return false;

  let timestamp = 0;
  let candidateSigs: string[] = [];

  if (signatureV2) {
    // Format: "t=1760000000,v1=abcdef..."
    const parts = signatureV2.split(',').map((p) => p.split('='));
    const tVal = parts.find(([k]) => k.trim() === 't')?.[1];
    timestamp = Number(tVal);
    candidateSigs = parts
      .filter(([k]) => k.trim() === 'v1')
      .map(([, v]) => (v || '').trim().toLowerCase());
  } else if (signatureV1 && timestampHeader) {
    timestamp = Number(timestampHeader);
    candidateSigs = [signatureV1.trim().toLowerCase()];
  }

  if (!timestamp || isNaN(timestamp)) return false;

  // Replay Attack Protection: Reject if timestamp is drift > toleranceSeconds (5 minutes)
  const currentTimestampSec = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTimestampSec - timestamp) > toleranceSeconds) {
    console.warn(`[BACHS-WEBHOOK] Timestamp drift exceeded: ${Math.abs(currentTimestampSec - timestamp)}s`);
    return false;
  }

  // Compute expected HMAC-SHA256 digest over "${timestamp}.${rawBody}"
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const message = `${timestamp}.${rawBody}`;
  const signedBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  const expectedHex = Array.from(new Uint8Array(signedBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return candidateSigs.some((sig) => sig === expectedHex);
}

function toIsoTimestamp(val: any): string {
  if (!val) return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (typeof val === 'number') {
    const ms = val < 1e11 ? val * 1000 : val;
    return new Date(ms).toISOString();
  }
  if (typeof val === 'string') {
    const num = Number(val);
    if (!isNaN(num) && num > 0) {
      const ms = num < 1e11 ? num * 1000 : num;
      return new Date(ms).toISOString();
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
}

// Optional Email Dispatcher for New Subscriptions
async function sendWelcomeEmail(email: string, name: string, tier: string, validUntil?: string, currency?: string) {
  if (!RESEND_API_KEY || !email) return;
  try {
    const isBigBang = tier === 'bigbang';
    const isNgn = currency === 'NGN';
    const planName = isBigBang
      ? (isNgn ? 'BigBang VIP All-Access (30-Day Pass)' : 'BigBang VIP All-Access')
      : (isNgn ? 'Standard Football VIP (30-Day Pass)' : 'Standard Football VIP');
    const renewalText = isNgn ? '30-Day Pass (Non-recurring)' : 'Active (Renews automatically)';
    const formattedExpiry = validUntil
      ? new Date(validUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : 'Active';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: [email],
        subject: `👑 Welcome to Oddsbanta ${planName} (Confirmed)`,
        html: `<div style="background-color: #090d16; color: #f1f5f9; padding: 40px; font-family: sans-serif;">
          <h1 style="color: #10b981;">ODDSBANTA VIP ACTIVATED</h1>
          <p>Hello ${name || 'VIP Member'},</p>
          <p>Your subscription to <strong>${planName}</strong> is officially active and confirmed.</p>
          <p><strong>Status:</strong> ${renewalText}</p>
          <p><strong>Current Period Valid Until:</strong> ${formattedExpiry}</p>
          <p><a href="https://www.oddsbanta.com/dashboard" style="display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">Go to VIP Dashboard</a></p>
        </div>`,
      }),
    });
  } catch (e) {
    console.warn('[BACHS-WEBHOOK] Could not dispatch welcome email:', e);
  }
}

// Handler for One-Time Collections / Checkouts (e.g. NGN Bank Transfer / Local Cards)
async function handleOneTimePaymentFulfillment(event: any, dbKey: string) {
  const data = event.data || {};
  const metadata = data.metadata || {};
  let userId = metadata.user_id;

  const customerEmail = data.customer?.email || data.customer_details?.email || metadata.user_email;
  const customerName = data.customer?.name || data.customer_details?.name || metadata.user_name || (customerEmail ? customerEmail.split('@')[0] : '');

  // Fallback: If metadata didn't carry user_id, resolve by email
  if (!userId && customerEmail) {
    const userRes = await fetch(
      `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(customerEmail)}&select=id&limit=1`,
      { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
    );
    if (userRes.ok) {
      const userData = await userRes.json();
      if (userData && userData[0]?.id) userId = userData[0].id;
    }
  }

  if (!userId) {
    console.error('[BACHS-WEBHOOK] Could not associate collection/checkout with user:', data);
    return;
  }

  const currency = (data.currency || metadata.currency || 'NGN').toUpperCase();
  const prodId = data.product_cart?.[0]?.product_id || data.product_id;
  const tier = metadata.tier || (prodId === BACHS_PROD_BIGBANG_NGN || prodId === BACHS_PROD_BIGBANG ? 'bigbang' : 'standard');

  // Calculate 30-Day Period: Extend from current valid_until if active in future, otherwise from now
  let baseTime = Date.now();
  try {
    const existingSubRes = await fetch(
      `${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}&select=current_period_end&limit=1`,
      { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
    );
    if (existingSubRes.ok) {
      const existingRows = await existingSubRes.json();
      if (existingRows?.[0]?.current_period_end) {
        const existingEndMs = new Date(existingRows[0].current_period_end).getTime();
        if (existingEndMs > baseTime) {
          baseTime = existingEndMs;
        }
      }
    }
  } catch (e) {
    console.warn('[BACHS-WEBHOOK] Warning checking existing period end:', e);
  }

  const periodEnd = new Date(baseTime + 30 * 24 * 60 * 60 * 1000).toISOString();
  const custId = data.customer?.customer_id || data.customer?.id;
  const paymentId = data.charge_id || data.charge?.id || data.checkout_id || event.id;

  // Update public.subscriptions
  const subPatchRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tier,
      status: 'active',
      current_period_end: periodEnd,
      bachs_customer_id: custId,
      bachs_product_id: prodId,
      cancel_at_period_end: true,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!subPatchRes.ok) {
    console.error('[BACHS-WEBHOOK] Subscriptions PATCH failed for collection:', subPatchRes.status, await subPatchRes.text());
  }

  // Update public.entitlements
  await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tier,
      valid_until: periodEnd,
      features: {
        football_predictions: true,
        simulations: tier === 'bigbang',
        vip: true,
      },
      updated_at: new Date().toISOString(),
    }),
  });

  // Deduplicate and record payment in public.payments
  if (paymentId) {
    const checkPaymentRes = await fetch(
      `${SUPABASE_URL}/rest/v1/payments?bachs_payment_id=eq.${encodeURIComponent(paymentId)}&select=id&limit=1`,
      { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
    );
    let alreadyLogged = false;
    if (checkPaymentRes.ok) {
      const existingPayments = await checkPaymentRes.json();
      if (existingPayments && existingPayments.length > 0) {
        alreadyLogged = true;
      }
    }

    if (!alreadyLogged) {
      const defaultAmount = currency === 'NGN' ? (tier === 'bigbang' ? 10000 : 5000) : (tier === 'bigbang' ? 10 : 5);
      const parsedAmount = parseFloat(data.amount) || defaultAmount;
      await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
        method: 'POST',
        headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          amount: parsedAmount,
          currency: currency,
          status: 'succeeded',
          bachs_payment_id: paymentId,
          provider: 'bachs',
          plan_name: tier === 'bigbang' ? 'BigBang VIP All-Access (30-Day Pass)' : 'Standard Football VIP (30-Day Pass)',
          customer_email: customerEmail,
        }),
      });

      // Dispatch Welcome Email
      if (customerEmail) {
        await sendWelcomeEmail(customerEmail, customerName, tier, periodEnd, currency);
      }
    }
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 1. Read Raw Body for byte-exact signature verification
    const rawBody = await req.text();
    const sigV2 = req.headers.get('x-bachs-signature-v2');
    const sigV1 = req.headers.get('x-bachs-signature');
    const tsHeader = req.headers.get('x-bachs-timestamp');

    // 2. Cryptographic Signature Verification
    const isValid = await verifyBachsWebhook(sigV2, sigV1, tsHeader, rawBody, BACHS_WEBHOOK_SECRET);
    if (!isValid) {
      console.error('[BACHS-WEBHOOK] Signature validation failed or missing.');
      return new Response(JSON.stringify({ error: 'Invalid or missing signature' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 3. Parse Event Payload
    const event = JSON.parse(rawBody);
    const eventId = event.id;
    const eventType = event.type;

    if (!eventId || !eventType) {
      return new Response(JSON.stringify({ error: 'Malformed event payload' }), { status: 400 });
    }

    const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY;
    const webhookSecret = process.env.BACHS_WEBHOOK_SECRET || BACHS_WEBHOOK_SECRET;

    // 4. Anti-Replay Idempotency Verification
    const checkIdempotencyRes = await fetch(
      `${SUPABASE_URL}/rest/v1/webhook_events_log?event_id=eq.${encodeURIComponent(eventId)}&select=event_id&limit=1`,
      { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
    );
    if (checkIdempotencyRes.ok) {
      const existing = await checkIdempotencyRes.json();
      if (existing && existing.length > 0) {
        console.log(`[BACHS-WEBHOOK] Event ${eventId} already processed. Acknowledging.`);
        return new Response(JSON.stringify({ status: 'already_processed', event_id: eventId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Record Event in Idempotency Log
    const logRes = await fetch(`${SUPABASE_URL}/rest/v1/webhook_events_log`, {
      method: 'POST',
      headers: {
        apikey: dbKey,
        Authorization: `Bearer ${dbKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        event_id: eventId,
        event_type: eventType,
        provider: 'bachs',
        payload: event,
      }),
    });
    if (!logRes.ok) {
      console.warn('[BACHS-WEBHOOK] Warning writing idempotency log:', logRes.status, await logRes.text());
    }

    console.log(`[BACHS-WEBHOOK] Processing event ${eventType} (${eventId})`);

    // 5. Handle State Transitions
    switch (eventType) {
      case 'customer.subscription.created':
      case 'subscription.created':
      case 'subscription.activated': {
        const sub = event.data;
        let userId = sub.metadata?.user_id;

        // Fallback: If metadata didn't carry user_id, resolve by email
        if (!userId && sub.customer?.email) {
          const userRes = await fetch(
            `${SUPABASE_URL}/rest/v1/users?email=eq.${encodeURIComponent(sub.customer.email)}&select=id&limit=1`,
            { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
          );
          if (userRes.ok) {
            const userData = await userRes.json();
            if (userData && userData[0]?.id) userId = userData[0].id;
          }
        }

        if (!userId) {
          console.error('[BACHS-WEBHOOK] Could not associate subscription with user:', sub);
          break;
        }

        const tier =
          sub.metadata?.tier ||
          (sub.product_id === BACHS_PROD_BIGBANG || sub.product?.id === BACHS_PROD_BIGBANG
            ? 'bigbang'
            : 'standard');

        const periodStart = sub.current_period_start || new Date().toISOString();
        const periodEnd = toIsoTimestamp(sub.current_period_end);
        const subId = sub.id || sub.subscription_id;
        const custId = sub.customer?.customer_id || sub.customer?.id;
        const prodId = sub.product_id || sub.product?.id;

        // Update public.subscriptions
        const subPatchRes = await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier,
            status: 'active',
            current_period_end: periodEnd,
            bachs_subscription_id: subId,
            bachs_customer_id: custId,
            bachs_product_id: prodId,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          }),
        });
        if (!subPatchRes.ok) {
          console.error('[BACHS-WEBHOOK] Subscriptions PATCH failed:', subPatchRes.status, await subPatchRes.text());
        }

        // Update public.entitlements
        await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${userId}`, {
          method: 'PATCH',
          headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tier,
            valid_until: periodEnd,
            features: {
              football_predictions: true,
              simulations: tier === 'bigbang',
              vip: true,
            },
            updated_at: new Date().toISOString(),
          }),
        });

        // Record successful payment in public.payments
        await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
          method: 'POST',
          headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            amount: parseFloat(sub.amount || '5.00'),
            currency: sub.currency || 'USD',
            status: 'succeeded',
            bachs_payment_id: subId,
            provider: 'bachs',
            plan_name: tier === 'bigbang' ? 'BigBang VIP All-Access' : 'Standard Football VIP',
            customer_email: sub.customer?.email,
          }),
        });

        // Dispatch Welcome Email
        if (sub.customer?.email) {
          await sendWelcomeEmail(sub.customer.email, sub.customer.name, tier, periodEnd);
        }
        break;
      }

      case 'invoice.paid': {
        const inv = event.data;
        const subId = inv.subscription_id || inv.subscription?.id;

        if (subId) {
          // Find subscription owner
          const subRes = await fetch(
            `${SUPABASE_URL}/rest/v1/subscriptions?bachs_subscription_id=eq.${encodeURIComponent(subId)}&select=user_id,tier&limit=1`,
            { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
          );
          if (subRes.ok) {
            const subRows = await subRes.json();
            if (subRows && subRows[0]) {
              const { user_id, tier } = subRows[0];
              const newEnd = toIsoTimestamp(inv.period_end || inv.lines?.[0]?.period_end);

              // Extend Subscription
              await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user_id}`, {
                method: 'PATCH',
                headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  status: 'active',
                  current_period_end: newEnd,
                  updated_at: new Date().toISOString(),
                }),
              });

              // Extend Entitlement
              await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${user_id}`, {
                method: 'PATCH',
                headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  valid_until: newEnd,
                  updated_at: new Date().toISOString(),
                }),
              });

              // Log Payment
              await fetch(`${SUPABASE_URL}/rest/v1/payments`, {
                method: 'POST',
                headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  user_id,
                  amount: parseFloat(inv.amount_paid || inv.amount || '5.00'),
                  currency: inv.currency || 'USD',
                  status: 'succeeded',
                  bachs_payment_id: inv.id,
                  provider: 'bachs',
                  plan_name: tier === 'bigbang' ? 'BigBang VIP All-Access' : 'Standard Football VIP',
                  customer_email: inv.customer?.email,
                }),
              });
            }
          }
        }
        break;
      }

      case 'customer.subscription.updated':
      case 'subscription.updated': {
        const sub = event.data;
        const subId = sub.id || sub.subscription_id;

        if (subId) {
          const updatePayload: Record<string, any> = {
            status: sub.status,
            updated_at: new Date().toISOString(),
          };
          if (typeof sub.cancel_at_period_end === 'boolean') {
            updatePayload.cancel_at_period_end = sub.cancel_at_period_end;
          }
          if (sub.current_period_end) {
            updatePayload.current_period_end = toIsoTimestamp(sub.current_period_end);
          }

          await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?bachs_subscription_id=eq.${encodeURIComponent(subId)}`, {
            method: 'PATCH',
            headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(updatePayload),
          });
        }
        break;
      }

      case 'customer.subscription.deleted':
      case 'subscription.canceled':
      case 'subscription.deleted': {
        const sub = event.data;
        const subId = sub.id || sub.subscription_id;

        if (subId) {
          const subRes = await fetch(
            `${SUPABASE_URL}/rest/v1/subscriptions?bachs_subscription_id=eq.${encodeURIComponent(subId)}&select=user_id&limit=1`,
            { headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}` } }
          );
          if (subRes.ok) {
            const subRows = await subRes.json();
            if (subRows && subRows[0]) {
              const { user_id } = subRows[0];

              // Revert subscription to cancelled / free
              await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?user_id=eq.${user_id}`, {
                method: 'PATCH',
                headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tier: 'free',
                  status: 'cancelled',
                  updated_at: new Date().toISOString(),
                }),
              });

              // Revert entitlements
              await fetch(`${SUPABASE_URL}/rest/v1/entitlements?user_id=eq.${user_id}`, {
                method: 'PATCH',
                headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  tier: 'free',
                  features: { football_predictions: false, simulations: false, vip: false },
                  updated_at: new Date().toISOString(),
                }),
              });
            }
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const inv = event.data;
        const subId = inv.subscription_id;
        if (subId) {
          await fetch(`${SUPABASE_URL}/rest/v1/subscriptions?bachs_subscription_id=eq.${encodeURIComponent(subId)}`, {
            method: 'PATCH',
            headers: { apikey: dbKey, Authorization: `Bearer ${dbKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'past_due',
              updated_at: new Date().toISOString(),
            }),
          });
        }
        break;
      }

      case 'collection.succeeded': {
        const status = (event.data?.status || '').toLowerCase();
        if (status === 'succeeded') {
          await handleOneTimePaymentFulfillment(event, dbKey);
        }
        break;
      }

      case 'checkout.completed': {
        const mode = event.data?.mode;
        const paymentStatus = (event.data?.payment_status || '').toLowerCase();
        if (mode === 'payment' && (paymentStatus === 'paid' || paymentStatus === 'succeeded')) {
          await handleOneTimePaymentFulfillment(event, dbKey);
        }
        break;
      }

      default:
        console.log(`[BACHS-WEBHOOK] Unhandled event type: ${eventType}`);
        break;
    }

    return new Response(JSON.stringify({ success: true, event_id: eventId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[BACHS-WEBHOOK] Exception handling webhook:', err);
    // Return 500 so Bachs will retry delivery
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
