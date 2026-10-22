import { emailCorsHeaders, jsonError, verifyEmailCaller } from './_lib/email-guard';

export const config = {
  runtime: 'edge',
};

interface SendPasswordResetPayload {
  email?: string;
  type?: 'reset_request' | 'changed_notice';
  redirectTo?: string;
}

function sanitizeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generatePasswordResetEmailHtml(recoveryLink: string, userEmail: string): string {
  const safeEmail = sanitizeHtml(userEmail);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Change - Oddsbanta</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f1f5f9;">
  
  <div style="display: none; font-size: 1px; color: #090d16; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden;">
    Oddsbanta password change request. Click the link inside to set your new account password securely.
  </div>

  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; width: 100%; padding: 40px 15px 60px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);">
          
          <!-- Top Accent Banner -->
          <tr>
            <td style="background: linear-gradient(90deg, #3b82f6 0%, #10b981 50%, #6366f1 100%); height: 6px; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <!-- Brand Header -->
          <tr>
            <td style="padding: 36px 36px 20px; text-align: center;">
              <div style="display: inline-block; padding: 8px 18px; background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 9999px; margin-bottom: 16px;">
                <span style="color: #60a5fa; font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;">
                  🔒 ACCOUNT SECURITY
                </span>
              </div>
              <h1 style="margin: 0 0 6px; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">
                ODDS<span style="color: #10b981;">BANTA</span>
              </h1>
              <p style="margin: 0; font-size: 13px; color: #94a3b8; letter-spacing: 0.5px;">
                Password Recovery Verification
              </p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 10px 36px 28px; text-align: center;">
              <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.35;">
                Password Change Request
              </h2>
              <p style="margin: 0 0 20px; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                We received a request to change the password for your Oddsbanta account (<strong>${safeEmail}</strong>).
              </p>
              <p style="margin: 0 0 28px; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                Click the button below to verify your identity and choose your new password. This link is encrypted and valid for a single use.
              </p>

              <!-- Action Button -->
              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 10px; background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);">
                    <a href="${recoveryLink}" target="_blank" style="display: inline-block; padding: 16px 36px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px; letter-spacing: 0.3px;">
                      Change Password &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin: 16px 0 0; font-size: 12px; color: #64748b;">
                If you did not request this change, you can safely ignore this email. Your current password remains secure.
              </p>
            </td>
          </tr>

          <!-- Security Tip -->
          <tr>
            <td style="padding: 0 36px 28px;">
              <div style="background-color: #0b1329; border: 1px solid #1e293b; border-radius: 8px; padding: 14px 16px;">
                <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.5;">
                  <strong style="color: #cbd5e1;">Security Notice:</strong> Oddsbanta staff will never ask you for your password. Never share this link with anyone.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 36px 32px; background-color: #090d16; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #e2e8f0;">
                Oddsbanta AI Prediction Platform
              </p>
              <p style="margin: 0 0 12px; font-size: 12px; color: #64748b;">
                <a href="https://www.oddsbanta.com" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Website</a> &bull;
                <a href="https://www.oddsbanta.com/dashboard" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Dashboard</a> &bull;
                <a href="https://t.me/Oddsbanta_bot" style="color: #94a3b8; text-decoration: none; margin: 0 8px;">Telegram Bot</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #475569; line-height: 1.4;">
                &copy; 2026 Oddsbanta. All rights reserved.
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

export function generatePasswordChangedNoticeHtml(userEmail: string): string {
  const safeEmail = sanitizeHtml(userEmail);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password change - Oddsbanta</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #f1f5f9;">
  
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #090d16; width: 100%; padding: 40px 15px 60px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);">
          
          <tr>
            <td style="background: linear-gradient(90deg, #10b981 0%, #059669 100%); height: 6px; font-size: 0; line-height: 0;">&nbsp;</td>
          </tr>

          <tr>
            <td style="padding: 36px 36px 20px; text-align: center;">
              <h1 style="margin: 0 0 6px; font-size: 28px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">
                ODDS<span style="color: #10b981;">BANTA</span>
              </h1>
              <p style="margin: 0; font-size: 13px; color: #94a3b8; letter-spacing: 0.5px;">
                Account Security Alert
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 10px 36px 28px; text-align: center;">
              <h2 style="margin: 0 0 12px; font-size: 22px; font-weight: 700; color: #ffffff;">
                Your Password Was Successfully Changed
              </h2>
              <p style="margin: 0 0 20px; font-size: 15px; color: #cbd5e1; line-height: 1.6;">
                The password for your Oddsbanta account (<strong>${safeEmail}</strong>) has been successfully updated.
              </p>
              <p style="margin: 0 0 28px; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                If you made this change, no further action is required. You can log in using your new credentials.
              </p>

              <table role="presentation" border="0" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td align="center" style="border-radius: 10px; background: #10b981;">
                    <a href="https://www.oddsbanta.com" target="_blank" style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 10px;">
                      Go to Oddsbanta &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 20px 0 0; font-size: 12px; color: #ef4444; line-height: 1.5;">
                If you did NOT make this change, please immediately contact Oddsbanta security support to lock your account.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding: 24px 36px 32px; background-color: #090d16; border-top: 1px solid #1e293b; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #475569;">
                &copy; 2026 Oddsbanta. All rights reserved.
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
    let payload: SendPasswordResetPayload;
    try {
      payload = await req.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON body' }), {
        status: 400,
        headers,
      });
    }

    // Reset links are sent by Supabase Auth itself (supabase.auth.resetPasswordForEmail, branded
    // "Reset password" template). This endpoint used to mint recovery links for any address with the
    // service role key and no caller check, so it now only sends the "password changed" notice, to
    // the signed-in caller's own verified address.
    const { type = 'changed_notice' } = payload;
    if (type !== 'changed_notice') {
      return jsonError(410, 'Password reset emails are sent by Supabase Auth', headers);
    }

    const caller = await verifyEmailCaller(req);
    if (!caller || caller.kind !== 'user' || !caller.email) {
      return jsonError(401, 'Sign in required', headers);
    }
    const cleanEmail = caller.email;

    const resendApiKey = process.env.RESEND_API_KEY;
    if (!resendApiKey) {
      console.error('[PASSWORD-EMAIL] RESEND_API_KEY is not configured');
      return jsonError(500, 'Email service credentials not configured', headers);
    }

    const subject = 'Your Oddsbanta password was changed';
    const html = generatePasswordChangedNoticeHtml(cleanEmail);
    const text = `Your Oddsbanta password was changed.\nIf you did not make this change, reset your password at https://www.oddsbanta.com/reset-password and contact support.`;

    const primaryFrom = (process.env.RESEND_FROM_EMAIL && !process.env.RESEND_FROM_EMAIL.includes('resend.dev'))
      ? process.env.RESEND_FROM_EMAIL
      : 'Oddsbanta <welcome@oddsbanta.com>';

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
      console.error('[PASSWORD-EMAIL] Resend API error response:', resendData);
      return new Response(
        JSON.stringify({
          success: false,
          error: resendData?.message || 'Failed to dispatch password email via Resend',
          code: resendData?.name || 'RESEND_ERROR',
        }),
        { status: resendRes.status || 500, headers }
      );
    }

    console.log(`[PASSWORD-EMAIL] Sent password-changed notice, ID: ${resendData?.id}`);
    return new Response(
      JSON.stringify({
        success: true,
        messageId: resendData?.id,
        recipient: cleanEmail,
      }),
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error('[PASSWORD-EMAIL] Unexpected handler exception:', err);
    return new Response(
      JSON.stringify({
        success: false,
        error: err.message || 'Internal server error while sending password email',
      }),
      { status: 500, headers }
    );
  }
}
