import { emailCorsHeaders, jsonError, verifyEmailCaller } from './_lib/email-guard';

export const config = {
  runtime: 'edge',
};

interface SendSubscriptionEmailPayload {
  email: string;
  name?: string;
  tier?: 'standard' | 'bigbang' | 'vip' | string;
  validUntil?: string;
  cycle?: 'monthly' | 'quarterly' | string;
}

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateSubscriptionEmailHtml(
  displayName: string,
  userEmail: string,
  tier: string = 'standard',
  validUntil?: string,
  cycle: string = 'monthly'
): string {
  const safeName = sanitizeHtml(displayName || userEmail.split('@')[0] || 'VIP Member');
  const isBigBang = tier.toLowerCase() === 'bigbang' || tier.toLowerCase() === 'vip';
  const planName = isBigBang ? 'BigBang VIP All-Access' : 'Standard Football VIP';
  const badgeColor = isBigBang ? '#f59e0b' : '#10b981';
  const dashboardUrl = 'https://www.oddsbanta.com/dashboard';
  const telegramBotUrl = 'https://t.me/Oddsbanta_bot';

  const formattedExpiry = validUntil
    ? new Date(validUntil).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Active';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oddsbanta VIP Subscription Confirmed</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f1f5f9;">
  
  <!-- Preheader text -->
  <div style="display: none; font-size: 1px; color: #090d16; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    Your Oddsbanta ${planName} subscription is officially confirmed! Full model access, high-confidence banker signals &amp; VIP alerts unlocked.
  </div>

  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; width: 100%; padding: 40px 15px 60px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);">
          
          <!-- Top Accent Banner -->
          <tr>
            <td style="background: linear-gradient(90deg, ${badgeColor} 0%, #10b981 50%, #3b82f6 100%); height: 6px; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Brand Header -->
          <tr>
            <td style="padding: 36px 36px 20px; text-align: center;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; padding: 8px 18px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 9999px; margin-bottom: 16px;">
                      <span style="color: ${badgeColor}; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;">
                        👑 VIP MEMBERSHIP ACTIVATED
                      </span>
                    </div>
                    <h1 style="margin: 0 0 6px; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">
                      ODDS<span style="color: #10b981;">BANTA</span>
                    </h1>
                    <p style="margin: 0; font-size: 13px; color: #94a3b8; letter-spacing: 0.5px;">
                      Quantitative Football Intelligence &amp; Multi-Sport Analytics
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Hero Greeting -->
          <tr>
            <td style="padding: 10px 36px 24px; text-align: center;">
              <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.35;">
                Welcome to Oddsbanta VIP, ${safeName}! 🏆
              </h2>
              <p style="margin: 0; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                Your payment was received and your <strong style="color: ${badgeColor};">${planName}</strong> subscription is now officially active.
              </p>
            </td>
          </tr>

          <!-- Subscription Details Box -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background: linear-gradient(145deg, rgba(245, 158, 11, 0.08) 0%, rgba(15, 23, 42, 0.9) 100%); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 12px; padding: 22px;">
                <tr>
                  <td>
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td>
                          <span style="font-size: 12px; text-transform: uppercase; color: #94a3b8; letter-spacing: 1px; font-weight: 600;">Subscribed Plan</span>
                          <div style="font-size: 18px; font-weight: 800; color: #ffffff; margin-top: 4px;">${planName}</div>
                        </td>
                        <td align="right">
                          <span style="display: inline-block; background-color: #10b981; color: #042f2e; font-size: 11px; font-weight: 800; letter-spacing: 1px; padding: 4px 10px; border-radius: 6px; text-transform: uppercase;">
                            STATUS: ACTIVE
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding-top: 14px;">
                          <span style="font-size: 12px; color: #94a3b8;">Billing Frequency:</span>
                          <div style="font-size: 14px; font-weight: 600; color: #e2e8f0; text-transform: capitalize;">${cycle}</div>
                        </td>
                        <td align="right" style="padding-top: 14px;">
                          <span style="font-size: 12px; color: #94a3b8;">Next Renewal / Expiry:</span>
                          <div style="font-size: 14px; font-weight: 600; color: #e2e8f0;">${formattedExpiry}</div>
                        </td>
                      </tr>
                    </table>

                    <div style="border-top: 1px solid rgba(255, 255, 255, 0.1); margin-top: 18px; padding-top: 16px;">
                      <h4 style="margin: 0 0 10px; font-size: 14px; font-weight: 700; color: #ffffff; text-transform: uppercase; letter-spacing: 0.5px;">
                        Your Active VIP Entitlements:
                      </h4>
                      <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="padding: 4px 0; font-size: 13px; color: #cbd5e1;">
                            <strong style="color: #10b981;">✓ 100% Unlocked Football Predictions:</strong> Complete 4-day forecast horizons across all 40+ world leagues.
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; font-size: 13px; color: #cbd5e1;">
                            <strong style="color: #10b981;">✓ High Confidence Banker Signals:</strong> Mathematical probability signals scored 8.0–10.0 with fair market edge calculation.
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 4px 0; font-size: 13px; color: #10b981;">
                            <strong style="color: #10b981;">✓ Specialist Goal &amp; Corner Algorithms:</strong> Over 2.5 Goals, 1st Half Blitz &amp; Corner models.
                          </td>
                        </tr>
                        ${
                          isBigBang
                            ? `<tr>
                          <td style="padding: 4px 0; font-size: 13px; color: #cbd5e1;">
                            <strong style="color: #f59e0b;">✓ Multi-Sport Suite:</strong> Full VIP access to Tennis (ATP/WTA) and Basketball (NBA &amp; EuroLeague) quantitative models.
                          </td>
                        </tr>`
                            : ''
                        }
                        <tr>
                          <td style="padding: 4px 0; font-size: 13px; color: #cbd5e1;">
                            <strong style="color: #10b981;">✓ Instant Automated Settlements:</strong> Continuous 15-minute auditing of match results and performance metrics.
                          </td>
                        </tr>
                      </table>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Primary CTA Button -->
          <tr>
            <td style="padding: 0 36px 32px; text-align: center;">
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 10px; background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
                    <a href="${dashboardUrl}" target="_blank" style="display: inline-block; padding: 16px 36px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px;">
                      Enter VIP Predictions Dashboard &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 12px 0 0; font-size: 12px; color: #64748b;">
                Thank you for trusting Oddsbanta's statistical mathematical edge.
              </p>
            </td>
          </tr>

          <!-- Telegram VIP Concierge -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <div style="background-color: #0b1329; border: 1px solid #1e293b; border-radius: 10px; padding: 18px 20px;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="36" valign="top">
                      <span style="font-size: 24px;">📱</span>
                    </td>
                    <td style="padding-left: 12px; font-size: 13px; color: #cbd5e1; line-height: 1.5;">
                      <strong style="color: #ffffff;">Activate Instant Mobile VIP Signals:</strong><br>
                      Connect your account to our official Telegram VIP Bot (<a href="${telegramBotUrl}" style="color: #10b981; text-decoration: underline;">@Oddsbanta_bot</a>) to receive high-confidence pre-kickoff alerts directly to your phone.
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Legal Notice -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <div style="border-top: 1px solid #1e293b; padding-top: 16px;">
                <p style="margin: 0; font-size: 11px; color: #64748b; line-height: 1.5;">
                  Oddsbanta provides quantitative statistical modeling and sports predictive data for educational, research, and informational entertainment purposes only. 18+ only.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 36px 32px; background-color: #090d16; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #e2e8f0;">
                Oddsbanta VIP Subscription Concierge
              </p>
              <p style="margin: 0 0 12px; font-size: 12px; color: #64748b;">
                <a href="https://www.oddsbanta.com" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Website</a> &bull;
                <a href="https://www.oddsbanta.com/subscription" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Manage Subscription</a> &bull;
                <a href="https://t.me/Oddsbanta_bot" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Telegram VIP</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #475569; line-height: 1.4;">
                &copy; 2026 Oddsbanta. All rights reserved.<br>
                Oddsbanta Account Email: ${sanitizeHtml(userEmail)}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;
}

export function generateSubscriptionEmailText(
  displayName: string,
  userEmail: string,
  tier: string = 'standard',
  validUntil?: string
): string {
  const name = displayName || userEmail.split('@')[0] || 'VIP Member';
  const isBigBang = tier.toLowerCase() === 'bigbang' || tier.toLowerCase() === 'vip';
  const planName = isBigBang ? 'BigBang VIP All-Access' : 'Standard Football VIP';

  return `Welcome to Oddsbanta VIP, ${name}!

Your subscription to ${planName} is officially confirmed and active.

What is unlocked:
- 100% Unlocked Football Predictions (4-day forecast horizons)
- High-Confidence Banker Signals (Score 8.0–10.0)
- Specialist Goal & Corner models (Over 2.5 Goals, 1st Half Blitz)
${isBigBang ? '- Multi-Sport VIP (Tennis ATP/WTA & Basketball NBA/EuroLeague)\n' : ''}- 15-Minute Automated Live Settlements

Open your VIP Dashboard:
https://www.oddsbanta.com/dashboard

Connect to Telegram VIP Alerts:
https://t.me/Oddsbanta_bot

Thank you for choosing Oddsbanta!
© 2026 Oddsbanta. All rights reserved.`;
}

export default async function handler(req: Request): Promise<Response> {
  const headers = emailCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers,
    });
  }

  // Only an admin (Admin panel) or an internal service-role caller may send subscription mail.
  const caller = await verifyEmailCaller(req);
  if (!caller) return jsonError(401, 'Sign in required', headers);
  if (!caller.isAdmin) return jsonError(403, 'Admins only', headers);

  try {
    let payload: SendSubscriptionEmailPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
        status: 400,
        headers,
      });
    }

    const { email, name, tier = 'standard', validUntil, cycle = 'monthly' } = payload;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return new Response(JSON.stringify({ success: false, error: 'Valid email is required' }), {
        status: 400,
        headers,
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = typeof name === 'string' ? name.trim() : cleanEmail.split('@')[0];

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('[SUBSCRIPTION-EMAIL] RESEND_API_KEY is not configured');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Email service credentials not configured',
        }),
        { status: 500, headers }
      );
    }

    const primaryFrom = (process.env.RESEND_FROM_EMAIL && !process.env.RESEND_FROM_EMAIL.includes('resend.dev'))
      ? process.env.RESEND_FROM_EMAIL
      : 'Oddsbanta <welcome@oddsbanta.com>';

    const isBigBang = tier.toLowerCase() === 'bigbang' || tier.toLowerCase() === 'vip';
    const subject = isBigBang
      ? 'Oddsbanta VIP Subscription Confirmed — Welcome to BigBang All-Access! 👑🏆'
      : 'Oddsbanta Subscription Confirmed — Your VIP Access is Active! ⚽🔥';

    const html = generateSubscriptionEmailHtml(cleanName, cleanEmail, tier, validUntil, cycle);
    const text = generateSubscriptionEmailText(cleanName, cleanEmail, tier, validUntil);

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: primaryFrom,
        to: [cleanEmail],
        subject,
        html,
        text,
      }),
    });

    const resendData = await resendRes.json();

    if (!resendRes.ok) {
      console.error('[SUBSCRIPTION-EMAIL] Resend API error response:', resendData);
      return new Response(
        JSON.stringify({
          success: false,
          error: resendData?.message || 'Failed to dispatch subscription email via Resend',
          code: resendData?.name || 'RESEND_ERROR',
        }),
        { status: resendRes.status || 500, headers }
      );
    }

    console.log(`[SUBSCRIPTION-EMAIL] Sent subscription email, ID: ${resendData?.id}`);
    return new Response(
      JSON.stringify({
        success: true,
        messageId: resendData?.id,
        recipient: cleanEmail,
      }),
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[SUBSCRIPTION-EMAIL] Unexpected handler exception:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Internal server error while sending subscription email',
      }),
      { status: 500, headers }
    );
  }
}
