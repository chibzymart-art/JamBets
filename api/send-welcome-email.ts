import { emailCorsHeaders, jsonError, verifyEmailCaller } from './_lib/email-guard';

export const config = {
  runtime: 'edge',
};

interface SendWelcomeEmailPayload {
  email: string;
  name?: string;
}

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateWelcomeEmailHtml(displayName: string, userEmail: string): string {
  const safeName = sanitizeHtml(displayName || userEmail.split('@')[0] || 'Member');
  const dashboardUrl = 'https://www.oddsbanta.com/dashboard';
  const specialistUrl = 'https://www.oddsbanta.com/dashboard/goals';
  const telegramBotUrl = 'https://t.me/Oddsbanta_bot';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Oddsbanta</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f1f5f9;">
  
  <!-- Preheader text for inbox preview -->
  <div style="display: none; font-size: 1px; color: #090d16; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    Your 72-hour full VIP trial has started! Unrestricted access to today's football predictions, goal models &amp; verified accuracy.
  </div>

  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; width: 100%; padding: 40px 15px 60px;">
    <tr>
      <td align="center">
        <!-- Main Email Container -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);">
          
          <!-- Top Accent Banner -->
          <tr>
            <td style="background: linear-gradient(90deg, #10b981 0%, #059669 50%, #3b82f6 100%); height: 6px; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Brand Header -->
          <tr>
            <td style="padding: 36px 36px 20px; text-align: center;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center">
                    <div style="display: inline-block; padding: 8px 18px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 9999px; margin-bottom: 16px;">
                      <span style="color: #10b981; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;">
                        ⚽ AI FOOTBALL PREDICTIONS
                      </span>
                    </div>
                    <h1 style="margin: 0 0 6px; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">
                      ODDS<span style="color: #10b981;">BANTA</span>
                    </h1>
                    <p style="margin: 0; font-size: 13px; color: #94a3b8; letter-spacing: 0.5px;">
                      Mathematical Football Modeling &amp; Specialist Analytics
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Welcome Hero -->
          <tr>
            <td style="padding: 10px 36px 24px; text-align: center;">
              <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.35;">
                Welcome to the Winning Side of Football Analytics, ${safeName}! 👋
              </h2>
              <p style="margin: 0; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                Thank you for joining <strong>Oddsbanta</strong>. Your registration is complete, and your <span style="color: #10b981; font-weight: 700;">3-Day Free VIP Trial</span> is now officially unlocked!
              </p>
            </td>
          </tr>

          <!-- 3-Day VIP Pass Highlight Card -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background: linear-gradient(145deg, rgba(16, 185, 129, 0.08) 0%, rgba(15, 23, 42, 0.9) 100%); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 12px; padding: 22px;">
                <tr>
                  <td>
                    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                      <tr>
                        <td valign="middle">
                          <span style="display: inline-block; background-color: #10b981; color: #042f2e; font-size: 11px; font-weight: 800; letter-spacing: 1px; padding: 4px 10px; border-radius: 6px; text-transform: uppercase;">
                            VIP PASS ACTIVE
                          </span>
                        </td>
                        <td align="right" valign="middle">
                          <span style="font-size: 12px; color: #10b981; font-weight: 600;">
                            ⏱️ 72 Hours Unlocked
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 14px;">
                          <h3 style="margin: 0 0 8px; font-size: 17px; font-weight: 700; color: #ffffff;">
                            Here is what you get during your 3-day trial:
                          </h3>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 6px;">
                          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                            <tr>
                              <td style="padding: 6px 0; font-size: 14px; color: #e2e8f0; line-height: 1.5;">
                                <strong style="color: #10b981;">✓ 100% Unlocked Football Predictions:</strong> Full 1X2 win probabilities, expected goals (xG), and fair market odds across Premier League, Champions League, La Liga, Serie A, and 40+ domestic leagues.
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 6px 0; font-size: 14px; color: #e2e8f0; line-height: 1.5;">
                                <strong style="color: #10b981;">✓ Specialist Goal &amp; Corner Models:</strong> Instant access to Over 2.5 Goals, 1st Half Over 0.5 Blitz, BTTS (Both Teams to Score), and Corner Specialist algorithms.
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 6px 0; font-size: 14px; color: #e2e8f0; line-height: 1.5;">
                                <strong style="color: #10b981;">✓ Verified Transparent Settlements:</strong> Every finished match is audited on-chain with zero hidden slips or deleted records. Check our transparent track record at any time.
                              </td>
                            </tr>
                            <tr>
                              <td style="padding: 6px 0; font-size: 14px; color: #e2e8f0; line-height: 1.5;">
                                <strong style="color: #10b981;">✓ Mathematical Probabilities:</strong> Driven by true Poisson distribution curves and Monte Carlo simulations — not emotional gut feeling or biased punditry.
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
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
                      Launch Oddsbanta Predictions &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 12px 0 0; font-size: 12px; color: #64748b;">
                No credit card required. Your trial starts immediately.
              </p>
            </td>
          </tr>

          <!-- 3-Step Quick Start Section -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <div style="border-top: 1px solid #1e293b; padding-top: 24px;">
                <h4 style="margin: 0 0 14px; font-size: 15px; font-weight: 700; color: #ffffff; text-transform: uppercase; letter-spacing: 0.8px;">
                  Quick Start Guide (First 3 Steps)
                </h4>
                
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td width="32" valign="top" style="padding-top: 2px;">
                      <div style="width: 24px; height: 24px; border-radius: 50%; background: #1e293b; color: #10b981; font-weight: 800; font-size: 12px; text-align: center; line-height: 24px;">1</div>
                    </td>
                    <td style="padding-bottom: 14px; font-size: 14px; color: #cbd5e1; line-height: 1.5;">
                      <strong style="color: #ffffff;">Review Today's Fixtures:</strong> Visit the <a href="${dashboardUrl}" style="color: #10b981; text-decoration: underline;">Daily Fixtures</a> dashboard to see model probabilities for upcoming matches.
                    </td>
                  </tr>
                  <tr>
                    <td width="32" valign="top" style="padding-top: 2px;">
                      <div style="width: 24px; height: 24px; border-radius: 50%; background: #1e293b; color: #10b981; font-weight: 800; font-size: 12px; text-align: center; line-height: 24px;">2</div>
                    </td>
                    <td style="padding-bottom: 14px; font-size: 14px; color: #cbd5e1; line-height: 1.5;">
                      <strong style="color: #ffffff;">Explore Specialist Goal Markets:</strong> Visit <a href="${specialistUrl}" style="color: #10b981; text-decoration: underline;">Specialist Markets</a> for Over 2.5 Goals and 1st Half Over 0.5 Blitz mathematical edges.
                    </td>
                  </tr>
                  <tr>
                    <td width="32" valign="top" style="padding-top: 2px;">
                      <div style="width: 24px; height: 24px; border-radius: 50%; background: #1e293b; color: #10b981; font-weight: 800; font-size: 12px; text-align: center; line-height: 24px;">3</div>
                    </td>
                    <td style="font-size: 14px; color: #cbd5e1; line-height: 1.5;">
                      <strong style="color: #ffffff;">Connect Telegram Alerts:</strong> Link your account via our official bot <a href="${telegramBotUrl}" style="color: #10b981; text-decoration: underline;">@Oddsbanta_bot</a> for instant mobile match push alerts.
                    </td>
                  </tr>
                </table>
              </div>
            </td>
          </tr>

          <!-- Legal / Educational Disclaimer -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <div style="background-color: #0b1329; border: 1px solid #1e293b; border-radius: 8px; padding: 14px 16px;">
                <p style="margin: 0; font-size: 11px; color: #94a3b8; line-height: 1.5;">
                  <strong>Educational &amp; Research Notice:</strong> Oddsbanta produces mathematical probability models and historical data simulations for informational and entertainment purposes only. We do not offer financial or betting advice. Sports prediction involves risk. Please gamble responsibly and strictly follow local gambling regulations. 18+ only.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 36px 32px; background-color: #090d16; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #e2e8f0;">
                Oddsbanta Quantitative Football Engine
              </p>
              <p style="margin: 0 0 12px; font-size: 12px; color: #64748b;">
                <a href="https://www.oddsbanta.com" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Website</a> &bull;
                <a href="https://www.oddsbanta.com/dashboard/goals" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Specialist Markets</a> &bull;
                <a href="https://t.me/Oddsbanta_bot" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Telegram Bot</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #475569; line-height: 1.4;">
                &copy; 2026 Oddsbanta. All rights reserved.<br>
                You received this email because you registered an account at oddsbanta.com.
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

export function generateWelcomeEmailText(displayName: string, userEmail: string): string {
  const name = displayName || userEmail.split('@')[0] || 'Member';
  return `Welcome to Oddsbanta, ${name}!

Your 3-Day Free VIP Trial is officially active.

Here is what is unlocked for the next 72 hours:
- 100% Unlocked Football Predictions (Premier League, La Liga, Serie A, Champions League & 40+ leagues)
- Specialist Goal & Corner Models (Over 2.5 Goals, 1st Half Over 0.5 Blitz, BTTS, Corners)
- Transparent Poisson & Expected Goals (xG) mathematical models
- 100% Audited Settlement History on finished matches

Start exploring predictions now:
https://www.oddsbanta.com/dashboard

Specialist Goal Markets:
https://www.oddsbanta.com/dashboard/goals

Connect with our official Telegram VIP Bot:
https://t.me/Oddsbanta_bot

Oddsbanta is an educational & analytical football modeling platform. 18+ only.
© 2026 Oddsbanta. All rights reserved.`;
}

// Per-instance memory of accounts already welcomed (best effort; the 24h window is the real limit).
const welcomeSent = new Set<string>();

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

  try {
    let payload: SendWelcomeEmailPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
        status: 400,
        headers,
      });
    }

    // The welcome email only ever goes to the signed-in caller's own verified address, and only for
    // an account created in the last 24 hours. The body's email field is ignored for users.
    const caller = await verifyEmailCaller(req);
    if (!caller) return jsonError(401, 'Sign in required', headers);

    const { name } = payload;
    let cleanEmail = '';
    if (caller.kind === 'service') {
      cleanEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    } else {
      cleanEmail = caller.email || '';
      const createdMs = caller.createdAt ? new Date(caller.createdAt).getTime() : 0;
      if (!Number.isFinite(createdMs) || Date.now() - createdMs > 24 * 60 * 60 * 1000) {
        return jsonError(409, 'Welcome email already sent for this account', headers);
      }
      if (welcomeSent.has(caller.userId || '')) {
        return jsonError(409, 'Welcome email already sent for this account', headers);
      }
      welcomeSent.add(caller.userId || '');
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return jsonError(400, 'Valid email is required', headers);
    }

    const cleanName = typeof name === 'string' ? name.trim() : cleanEmail.split('@')[0];

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('[WELCOME-EMAIL] RESEND_API_KEY environment variable is not configured');
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

    const subject = 'Welcome to Oddsbanta — Your 3-Day VIP Prediction Pass is Active! ⚽🔥';
    const html = generateWelcomeEmailHtml(cleanName, cleanEmail);
    const text = generateWelcomeEmailText(cleanName, cleanEmail);

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
      console.error('[WELCOME-EMAIL] Resend API error response:', resendData);
      return new Response(
        JSON.stringify({
          success: false,
          error: resendData?.message || 'Failed to dispatch welcome email via Resend',
          code: resendData?.name || 'RESEND_ERROR',
        }),
        { status: resendRes.status || 500, headers }
      );
    }

    console.log(`[WELCOME-EMAIL] Sent welcome email, Resend ID: ${resendData?.id}`);
    return new Response(
      JSON.stringify({
        success: true,
        messageId: resendData?.id,
        recipient: cleanEmail,
      }),
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[WELCOME-EMAIL] Unexpected handler exception:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Internal server error while sending welcome email',
      }),
      { status: 500, headers }
    );
  }
}
