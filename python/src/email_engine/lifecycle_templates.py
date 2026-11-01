"""
Oddsbanta lifecycle and daily results email templates.

Each renderer takes a context dict and returns (subject, html, text). Every value that comes from the
database is escaped. Copy rules (AGENTS.md section 6.9): Oddsbanta is an analytics tool, not a
bookmaker; picks are model estimates, never guarantees; 18+.
"""

from html import escape
from typing import Any, Callable, Dict, List, Optional, Tuple

SITE = "https://www.oddsbanta.com"
DASHBOARD_URL = f"{SITE}/dashboard"
SUBSCRIBE_URL = f"{SITE}/subscription"

Rendered = Tuple[str, str, str]

DISCLAIMER = (
    "Oddsbanta is an analytics tool, not a bookmaker. Picks are model estimates, not guarantees, "
    "and past results do not predict future results. 18+ only. Please bet responsibly."
)


def _shell(preheader: str, heading: str, body_html: str, cta_text: Optional[str], cta_url: Optional[str],
           unsubscribe_url: str, unsubscribe_label: str) -> str:
    cta = ""
    if cta_text and cta_url:
        cta = f"""
          <tr><td align="center" style="padding: 8px 32px 28px;">
            <a href="{escape(cta_url)}" style="display: inline-block; background: #10b981; color: #04211a; font-size: 15px; font-weight: 800; text-decoration: none; padding: 13px 26px; border-radius: 8px;">{escape(cta_text)}</a>
          </td></tr>"""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{escape(heading)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #090d16; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e2e8f0;">
  <div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">{escape(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #090d16; padding: 32px 12px 48px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 14px;">
        <tr><td style="padding: 28px 32px 8px; text-align: center;">
          <div style="font-size: 24px; font-weight: 900; letter-spacing: -0.5px; color: #ffffff;">ODDS<span style="color: #10b981;">BANTA</span></div>
        </td></tr>
        <tr><td style="padding: 12px 32px 4px;">
          <h1 style="margin: 0; font-size: 21px; line-height: 1.35; color: #ffffff;">{escape(heading)}</h1>
        </td></tr>
        <tr><td style="padding: 8px 32px 12px; font-size: 15px; line-height: 1.6; color: #cbd5e1;">
          {body_html}
        </td></tr>{cta}
        <tr><td style="padding: 18px 32px 26px; border-top: 1px solid #1e293b; font-size: 12px; line-height: 1.6; color: #64748b;">
          {escape(DISCLAIMER)}<br><br>
          You get this email because you have an Oddsbanta account.
          <a href="{escape(unsubscribe_url)}" style="color: #94a3b8; text-decoration: underline;">{escape(unsubscribe_label)}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _text(heading: str, paragraphs: List[str], cta_text: Optional[str], cta_url: Optional[str],
          unsubscribe_url: str, unsubscribe_label: str) -> str:
    lines = ["ODDSBANTA", "", heading, ""] + [p for para in paragraphs for p in (para, "")]
    if cta_text and cta_url:
        lines += [f"{cta_text}: {cta_url}", ""]
    lines += [DISCLAIMER, "", f"{unsubscribe_label}: {unsubscribe_url}"]
    return "\n".join(lines)


def _simple(ctx: Dict[str, Any], subject: str, preheader: str, heading: str, paragraphs: List[str],
            cta_text: Optional[str], cta_url: Optional[str]) -> Rendered:
    """Plain-paragraph email. Paragraphs are plain text and are escaped here."""
    body = "".join(f'<p style="margin: 0 0 14px;">{escape(p)}</p>' for p in paragraphs)
    unsub_url = ctx["unsubscribe_url"]
    unsub_label = ctx.get("unsubscribe_label") or "Unsubscribe from these reminders"
    html = _shell(preheader, heading, body, cta_text, cta_url, unsub_url, unsub_label)
    text = _text(heading, paragraphs, cta_text, cta_url, unsub_url, unsub_label)
    return subject, html, text


def _hi(ctx: Dict[str, Any]) -> str:
    return f"Hi {ctx.get('name') or 'there'},"


def render_trial_ending(ctx: Dict[str, Any]) -> Rendered:
    return _simple(
        ctx,
        subject="Your Oddsbanta free trial ends tomorrow",
        preheader="Keep full access to football, goals and corners picks after your trial.",
        heading="Your free trial ends tomorrow",
        paragraphs=[
            _hi(ctx),
            f"Your 3-day Oddsbanta trial ends on {ctx['trial_end_label']}. After that, today's football, "
            "goals and corners picks will be locked again.",
            f"Standard is {ctx['standard_price']} a month and keeps everything you have now. BigBang VIP "
            f"({ctx['vip_price']} a month) adds tennis, basketball and Telegram signals.",
        ],
        cta_text="Choose a plan",
        cta_url=SUBSCRIBE_URL,
    )


def render_trial_ended(ctx: Dict[str, Any]) -> Rendered:
    return _simple(
        ctx,
        subject="Your Oddsbanta trial has ended",
        preheader="Today's picks are locked. Pick a plan to open them again.",
        heading="Your free trial has ended",
        paragraphs=[
            _hi(ctx),
            "Your 3-day trial is over, so today's picks are now locked on your account.",
            f"You can open them again any time with Standard ({ctx['standard_price']} a month) or "
            f"BigBang VIP ({ctx['vip_price']} a month). Quarterly plans are 10% off.",
        ],
        cta_text="Unlock today's picks",
        cta_url=SUBSCRIBE_URL,
    )


def render_renewal_due(ctx: Dict[str, Any]) -> Rendered:
    return _simple(
        ctx,
        subject=f"Your {ctx['plan_name']} plan ends on {ctx['period_end_label']}",
        preheader="Renew now so your picks don't lock.",
        heading=f"Your plan ends on {ctx['period_end_label']}",
        paragraphs=[
            _hi(ctx),
            f"Your Oddsbanta {ctx['plan_name']} access runs until {ctx['period_end_label']} and will not renew "
            "by itself.",
            "Renew before then to keep your picks open without a gap.",
        ],
        cta_text="Renew my plan",
        cta_url=SUBSCRIBE_URL,
    )


def render_plan_expired(ctx: Dict[str, Any]) -> Rendered:
    return _simple(
        ctx,
        subject=f"Your Oddsbanta {ctx['plan_name']} plan has ended",
        preheader="Your picks are locked. Renew to open them again.",
        heading="Your plan has ended",
        paragraphs=[
            _hi(ctx),
            f"Your {ctx['plan_name']} access ended on {ctx['period_end_label']}, so today's picks are now locked "
            "on your account.",
            "Renew any time to open them again.",
        ],
        cta_text="Renew my plan",
        cta_url=SUBSCRIBE_URL,
    )


def render_payment_failed(ctx: Dict[str, Any]) -> Rendered:
    return _simple(
        ctx,
        subject="Your Oddsbanta payment didn't go through",
        preheader="Update your payment so your plan keeps running.",
        heading="We couldn't take your payment",
        paragraphs=[
            _hi(ctx),
            f"The latest payment for your {ctx['plan_name']} plan didn't go through. Your access stops if the "
            "payment isn't completed.",
            "You can pay again from the subscription page. If you think this is a mistake, just reply to this email.",
        ],
        cta_text="Fix my payment",
        cta_url=SUBSCRIBE_URL,
    )


def render_winback(ctx: Dict[str, Any]) -> Rendered:
    return _simple(
        ctx,
        subject="Today's Oddsbanta picks are ready",
        preheader="New football, goals and corners picks every day.",
        heading="New picks are published every day",
        paragraphs=[
            _hi(ctx),
            "It's been a week since your Oddsbanta access ended. The models still publish football, goals and "
            "corners picks every day, each scored 0 to 10 from 250,000 simulations per match.",
            f"Come back with Standard ({ctx['standard_price']} a month) or BigBang VIP ({ctx['vip_price']} a month).",
        ],
        cta_text="See plans",
        cta_url=SUBSCRIBE_URL,
    )


def _stat_row(label: str, won: int, lost: int) -> str:
    settled = won + lost
    pct = f"{round(won * 100 / settled)}%" if settled else "n/a"
    return (
        f'<tr><td style="padding: 8px 0; border-bottom: 1px solid #1e293b; color: #e2e8f0;">{escape(label)}</td>'
        f'<td align="right" style="padding: 8px 0; border-bottom: 1px solid #1e293b; color: #94a3b8;">{won} won, {lost} lost</td>'
        f'<td align="right" style="padding: 8px 0 8px 12px; border-bottom: 1px solid #1e293b; color: #ffffff; font-weight: 800;">{pct}</td></tr>'
    )


def render_daily_results(ctx: Dict[str, Any]) -> Rendered:
    """ctx['results']: {'date_label', 'won', 'lost', 'top_won', 'top_lost', 'products': [{label, won, lost}]}"""
    r = ctx["results"]
    settled = r["won"] + r["lost"]
    pct = round(r["won"] * 100 / settled) if settled else 0
    subject = f"Yesterday's Oddsbanta results: {r['won']} of {settled} won ({pct}%)"
    heading = f"Results for {r['date_label']}"
    summary = (
        f"{r['won']} of {settled} settled picks won yesterday, a {pct}% hit rate. Voids and matches where the "
        "model found no safe pick are not counted."
    )
    rows = "".join(_stat_row(p["label"], p["won"], p["lost"]) for p in r["products"] if p["won"] + p["lost"] > 0)
    top_settled = r["top_won"] + r["top_lost"]
    if top_settled:
        rows += _stat_row("Picks scored 8 or higher", r["top_won"], r["top_lost"])
    body = (
        f'<p style="margin: 0 0 14px;">{escape(_hi(ctx))}</p>'
        f'<p style="margin: 0 0 14px;">{escape(summary)}</p>'
        f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px; margin: 4px 0 16px;">{rows}</table>'
        f'<p style="margin: 0 0 6px;">Today\'s picks are already up.</p>'
    )
    paid = ctx.get("has_access", False)
    cta_text = "See today's picks" if paid else "Unlock today's picks"
    cta_url = DASHBOARD_URL if paid else SUBSCRIBE_URL
    unsub_url = ctx["unsubscribe_url"]
    unsub_label = ctx.get("unsubscribe_label") or "Stop the daily results email"
    html = _shell(f"{pct}% of yesterday's settled picks won.", heading, body, cta_text, cta_url, unsub_url, unsub_label)
    lines = [_hi(ctx), summary] + [
        f"{p['label']}: {p['won']} won, {p['lost']} lost" for p in r["products"] if p["won"] + p["lost"] > 0
    ]
    if top_settled:
        lines.append(f"Picks scored 8 or higher: {r['top_won']} won, {r['top_lost']} lost")
    lines.append("Today's picks are already up.")
    text = _text(heading, lines, cta_text, cta_url, unsub_url, unsub_label)
    return subject, html, text


RENDERERS: Dict[str, Callable[[Dict[str, Any]], Rendered]] = {
    "trial_ending": render_trial_ending,
    "trial_ended": render_trial_ended,
    "renewal_due": render_renewal_due,
    "plan_expired": render_plan_expired,
    "payment_failed": render_payment_failed,
    "winback": render_winback,
    "daily_results": render_daily_results,
}


def render(campaign: str, ctx: Dict[str, Any]) -> Rendered:
    return RENDERERS[campaign](ctx)
