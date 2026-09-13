"""
JamBets — Zero-Cost Autonomous Email Misfire Alerting System
Sends high-priority, zero-cost operational notifications via standard Gmail SMTP.
Requires ZERO paid third-party dependencies (SendGrid/Mailgun/AWS SES not needed).
Uses native Python smtplib and SSL/TLS.
"""

import os
import sys
import smtplib
import ssl
import traceback
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any


DEFAULT_RECIPIENTS = [
    "chibuezec.amuchie@gmail.com",
    "chibzymart@gmail.com"
]


def get_recipients() -> List[str]:
    raw = os.getenv("ALERT_EMAIL_RECIPIENTS", "")
    if raw.strip():
        return [e.strip() for e in raw.split(",") if e.strip()]
    return list(DEFAULT_RECIPIENTS)


def send_email_alert(
    subject: str,
    html_body: str,
    plain_body: Optional[str] = None,
    recipients: Optional[List[str]] = None
) -> bool:
    """
    Sends an email alert using Gmail SMTP.
    Returns True if sent successfully, False otherwise without raising errors.
    """
    sender_email = os.getenv("ALERT_EMAIL_SENDER", "").strip()
    sender_password = os.getenv("ALERT_EMAIL_PASSWORD", "").strip()

    target_recipients = recipients or get_recipients()

    if not sender_email or not sender_password:
        print(
            f"[EMAIL ALERT NOTICE] ALERT_EMAIL_SENDER or ALERT_EMAIL_PASSWORD not configured. "
            f"Alert '{subject}' was NOT dispatched via email. "
            f"(Configure these environment variables in GitHub Secrets or .env to enable)",
            file=sys.stderr,
            flush=True
        )
        return False

    if not target_recipients:
        print("[EMAIL ALERT NOTICE] No target recipients specified.", file=sys.stderr, flush=True)
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = f"[Oddsbanta Alert] {subject}"
        msg["From"] = f"Oddsbanta Engine <{sender_email}>"
        msg["To"] = ", ".join(target_recipients)
        msg["Date"] = datetime.now(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")

        if plain_body:
            msg.attach(MIMEText(plain_body, "plain", "utf-8"))
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        # Connect using TLS
        smtp_server = os.getenv("ALERT_SMTP_SERVER", "smtp.gmail.com")
        smtp_port = int(os.getenv("ALERT_SMTP_PORT", "587"))

        context = ssl.create_default_context()
        with smtplib.SMTP(smtp_server, smtp_port, timeout=20) as server:
            server.ehlo()
            server.starttls(context=context)
            server.ehlo()
            server.login(sender_email, sender_password)
            server.sendmail(sender_email, target_recipients, msg.as_string())

        print(f"[EMAIL ALERT SENT] Dispatched '{subject}' to {len(target_recipients)} recipient(s).", flush=True)
        return True
    except Exception as e:
        print(f"[EMAIL ALERT FAILED] Error sending email alert '{subject}': {e}", file=sys.stderr, flush=True)
        return False


def _build_html_wrapper(title: str, badge_color: str, badge_text: str, content_html: str) -> str:
    timestamp_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 24px; }}
    .container {{ max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }}
    .header {{ padding: 24px; background: #0b1329; border-bottom: 1px solid #334155; display: flex; align-items: center; justify-content: space-between; }}
    .logo {{ font-size: 20px; font-weight: 800; color: #38bdf8; letter-spacing: -0.5px; }}
    .logo span {{ color: #fbbf24; }}
    .badge {{ background: {badge_color}; color: #ffffff; padding: 4px 10px; border-radius: 9999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }}
    .body {{ padding: 24px; font-size: 14px; line-height: 1.6; color: #cbd5e1; }}
    .highlight-box {{ background: #0f172a; border-left: 4px solid {badge_color}; padding: 14px; border-radius: 6px; margin: 16px 0; font-family: monospace; font-size: 13px; color: #f1f5f9; overflow-x: auto; }}
    .footer {{ padding: 16px 24px; background: #090e1a; border-top: 1px solid #334155; font-size: 12px; color: #64748b; text-align: center; }}
    .btn {{ display: inline-block; background: #38bdf8; color: #0f172a !important; text-decoration: none; padding: 10px 18px; border-radius: 6px; font-weight: 700; margin-top: 16px; }}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Odds<span>banta</span> Sentinel</div>
      <div class="badge">{badge_text}</div>
    </div>
    <div class="body">
      <h2 style="margin-top:0; color:#ffffff;">{title}</h2>
      {content_html}
      <p style="margin-top: 24px;">
        <a href="https://oddsbanta.com/admin" class="btn">Open Oddsbanta Admin Deck →</a>
      </p>
    </div>
    <div class="footer">
      Oddsbanta Autonomous Engine Monitoring • Timestamp: {timestamp_utc}
    </div>
  </div>
</body>
</html>"""


def send_pipeline_failure_alert(
    pipeline_name: str,
    error: Exception,
    context: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Alerts when an automated workflow or prediction/settlement run crashes.
    """
    tb = traceback.format_exc()
    if tb.strip() == "NoneType: None":
        tb = str(error)

    ctx_items = ""
    if context:
        ctx_items = "<h4>Execution Context:</h4><ul>"
        for k, v in context.items():
            ctx_items += f"<li><strong>{k}:</strong> {v}</li>"
        ctx_items += "</ul>"

    content = f"""
    <p>The autonomous <strong>{pipeline_name}</strong> pipeline encountered an unhandled exception and failed execution.</p>
    {ctx_items}
    <h4>Error Trace:</h4>
    <div class="highlight-box">{tb}</div>
    <p>Please check the GitHub Actions logs or run manual settlement via the Admin Deck if needed.</p>
    """

    plain = f"[Oddsbanta Alert] {pipeline_name} Failed\n\nError: {error}\n\nTraceback:\n{tb}"
    return send_email_alert(
        subject=f"CRITICAL: {pipeline_name} Pipeline Crash",
        html_body=_build_html_wrapper(f"{pipeline_name} Execution Failure", "#ef4444", "CRITICAL FAILURE", content),
        plain_body=plain
    )


def send_zero_predictions_alert(
    date_str: str,
    matches_evaluated: int,
    context: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Alerts when the prediction engine runs but outputs 0 predictions for upcoming fixtures.
    """
    content = f"""
    <p>The prediction engine executed for date <strong>{date_str}</strong>, evaluated <strong>{matches_evaluated}</strong> forward fixtures, but produced <strong>0 published predictions</strong>.</p>
    <p>This could indicate:</p>
    <ul>
      <li>API data source rate limiting or missing lineups/odds</li>
      <li>Model consensus threshold divergence</li>
      <li>Empty prediction queue in Cloud Supabase</li>
    </ul>
    <div class="highlight-box">Date: {date_str}<br>Evaluated Matches: {matches_evaluated}<br>Published: 0</div>
    """
    plain = f"[Oddsbanta Alert] Zero Predictions Generated for {date_str} (Evaluated: {matches_evaluated})"
    return send_email_alert(
        subject=f"WARNING: Zero Predictions Generated ({date_str})",
        html_body=_build_html_wrapper("Zero Predictions Anomaly Detected", "#f59e0b", "WARNING", content),
        plain_body=plain
    )


def send_settlement_lag_alert(
    unsettled_count: int,
    oldest_kickoff_iso: str,
    context: Optional[Dict[str, Any]] = None
) -> bool:
    """
    Alerts when completed matches remain unsettled after > 90 minutes post-fulltime.
    """
    content = f"""
    <p>Settlement engine detected <strong>{unsettled_count} finished fixture(s)</strong> that have not settled after > 90 minutes past match completion.</p>
    <div class="highlight-box">Unsettled Fixtures: {unsettled_count}<br>Oldest Kickoff: {oldest_kickoff_iso}</div>
    <p>You can trigger deterministic re-settlement from the Admin Deck immediately.</p>
    """
    plain = f"[Oddsbanta Alert] Settlement Lag: {unsettled_count} finished fixtures unsettled since {oldest_kickoff_iso}"
    return send_email_alert(
        subject=f"ALERT: Settlement Lag ({unsettled_count} Matches Unsettled)",
        html_body=_build_html_wrapper("Settlement Engine Lag Detected", "#f59e0b", "SETTLEMENT LAG", content),
        plain_body=plain
    )


if __name__ == "__main__":
    # Test script: if invoked directly, attempts to send a test alert or display readiness status
    print("Testing Oddsbanta Email Notifier...")
    sender = os.getenv("ALERT_EMAIL_SENDER")
    pwd = os.getenv("ALERT_EMAIL_PASSWORD")
    if not sender or not pwd:
        print("[INFO] ALERT_EMAIL_SENDER and ALERT_EMAIL_PASSWORD are not set. Dry-run mode OK.")
    else:
        print(f"[INFO] Configured sender: {sender}, target recipients: {get_recipients()}")
