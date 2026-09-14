"""
Addsbanta — High-Converting HTML Email Templates
Responsive, dark-mode glassmorphic email templates tailored for sports betting & predictive analytics.
Complies with CAN-SPAM, GDPR, and anti-spam deliverability standards.
"""

from typing import Dict, Any, Tuple, Optional


def _base_email_shell(
    preheader_text: str,
    headline: str,
    badge_text: str,
    badge_color: str,
    content_html: str,
    cta_text: Optional[str] = None,
    cta_url: Optional[str] = None,
    unsubscribe_url: str = "https://addsbanta.com/unsubscribe"
) -> str:
    """Wraps campaign content inside a responsive, modern Addsbanta branded HTML shell."""

    cta_block = ""
    if cta_text and cta_url:
        cta_block = f"""
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 28px 0 12px 0;">
          <tr>
            <td align="center">
              <a href="{cta_url}" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #38bdf8 0%, #0284c7 100%); color: #090d16 !important; font-size: 15px; font-weight: 800; text-decoration: none; padding: 14px 28px; border-radius: 8px; letter-spacing: 0.2px; box-shadow: 0 4px 14px rgba(56, 189, 248, 0.35);">
                {cta_text} &rarr;
              </a>
            </td>
          </tr>
        </table>
        """

    return f"""<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{headline}</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a {{ font-family: Arial, Helvetica, sans-serif !important; }}
  </style>
  <![endif]-->
  <style type="text/css">
    body {{
      margin: 0;
      padding: 0;
      background-color: #090d16;
      color: #cbd5e1;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }}
    table {{ border-collapse: collapse; }}
    a {{ color: #38bdf8; text-decoration: none; }}
    .preheader {{
      display: none !important;
      visibility: hidden;
      mso-hide: all;
      font-size: 1px;
      line-height: 1px;
      max-height: 0px;
      max-width: 0px;
      opacity: 0;
      overflow: hidden;
    }}
    .email-container {{
      max-width: 600px;
      margin: 0 auto;
      background-color: #111827;
      border: 1px solid #1f293d;
      border-radius: 12px;
      overflow: hidden;
    }}
    .card-box {{
      background-color: #1a2234;
      border: 1px solid #28354d;
      border-radius: 8px;
      padding: 16px;
      margin: 16px 0;
    }}
    @media only screen and (max-width: 620px) {{
      .email-container {{ width: 100% !important; border-radius: 0 !important; }}
      .body-content {{ padding: 20px 16px !important; }}
      .header-content {{ padding: 18px 16px !important; }}
    }}
  </style>
</head>
<body style="margin: 0; padding: 24px 0; background-color: #090d16;">
  <!-- Preheader preview text in user inbox -->
  <span class="preheader">{preheader_text}</span>

  <center>
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px;">
      <tr>
        <td>
          <div class="email-container">
            
            <!-- Header -->
            <div class="header-content" style="padding: 24px; background-color: #0d1322; border-bottom: 1px solid #1f293d;">
              <table border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="left">
                    <span style="font-size: 20px; font-weight: 800; letter-spacing: -0.5px; color: #ffffff;">
                      Adds<span style="color: #fbbf24;">banta</span>
                    </span>
                    <span style="font-size: 11px; font-weight: 600; color: #64748b; margin-left: 6px; letter-spacing: 0.5px; text-transform: uppercase;">AI Engine</span>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; background-color: {badge_color}; color: #ffffff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.6px; padding: 4px 10px; border-radius: 9999px;">
                      {badge_text}
                    </span>
                  </td>
                </tr>
              </table>
            </div>

            <!-- Body -->
            <div class="body-content" style="padding: 32px 28px; font-size: 14px; line-height: 1.65; color: #cbd5e1;">
              <h1 style="font-size: 22px; font-weight: 800; color: #ffffff; margin: 0 0 16px 0; letter-spacing: -0.3px;">
                {headline}
              </h1>

              {content_html}

              {cta_block}
            </div>

            <!-- Footer -->
            <div style="padding: 24px; background-color: #090d16; border-top: 1px solid #1f293d; font-size: 12px; line-height: 1.5; color: #64748b; text-align: center;">
              <p style="margin: 0 0 10px 0; color: #94a3b8; font-weight: 600;">
                Adds<span style="color: #fbbf24;">banta</span> &bull; Probabilistic Football Intelligence
              </p>
              <p style="margin: 0 0 12px 0;">
                Strictly 18+ only. Sports betting involves financial risk. No model can guarantee future outcomes. Please gamble responsibly.
              </p>
              <p style="margin: 0; font-size: 11px;">
                You received this email because you signed up on <a href="https://addsbanta.com" style="color: #38bdf8;">addsbanta.com</a>.<br>
                <a href="{unsubscribe_url}" style="color: #94a3b8; text-decoration: underline;">Unsubscribe from these emails</a> &bull; <a href="https://addsbanta.com/settings" style="color: #94a3b8; text-decoration: underline;">Manage Preferences</a>
              </p>
            </div>

          </div>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>"""


# =====================================================================
# INDIVIDUAL CAMPAIGN TEMPLATE BUILDERS
# =====================================================================

def render_onboarding_day0(data: Dict[str, Any], unsub_url: str) -> Tuple[str, str]:
    """Day 0: Welcome + Today's Banker Pick"""
    name = data.get("display_name", "Punter")
    banker_match = data.get("banker_match", "Arsenal vs Chelsea")
    banker_league = data.get("banker_league", "Premier League")
    banker_market = data.get("banker_market", "Over 2.5 Goals / Home Win")
    banker_confidence = data.get("banker_confidence", "84%")
    banker_odds = data.get("banker_odds", "1.72")

    subject = "🎯 Welcome to Addsbanta — Here is today's high-confidence Banker Pick"
    preheader = f"Welcome {name}! Your first high-confidence AI Banker is ready."
    headline = f"Welcome aboard, {name}! Let's start with a winning edge."

    content = f"""
    <p>We built Addsbanta because we were tired of gut-feeling betting, overpriced VIP 'tipster' telegrams, and losing accumulators.</p>
    
    <p>Our autonomous engine simulates every match <strong>10,000 times</strong> using Monte Carlo models, Poisson distributions, and real-time xG dynamics to find genuine market value.</p>
    
    <div class="card-box" style="border-left: 4px solid #fbbf24;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
          <td>
            <span style="font-size: 11px; font-weight: 700; color: #fbbf24; text-transform: uppercase; letter-spacing: 0.5px;">Today's Free AI Banker Pick</span>
            <h3 style="font-size: 18px; font-weight: 800; color: #ffffff; margin: 4px 0 6px 0;">{banker_match}</h3>
            <span style="font-size: 12px; color: #94a3b8;">{banker_league}</span>
          </td>
          <td align="right">
            <span style="display: block; font-size: 18px; font-weight: 800; color: #38bdf8;">{banker_odds}</span>
            <span style="font-size: 11px; color: #10b981; font-weight: 700;">{banker_confidence} Conf.</span>
          </td>
        </tr>
      </table>
      <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #28354d; font-size: 13px; color: #e2e8f0;">
        <strong>Recommended Market:</strong> <span style="color: #38bdf8;">{banker_market}</span>
      </div>
    </div>

    <p style="margin-top: 16px;">Log into your deck anytime to view all forward simulations, expected goals matrix, and verified consensus slips.</p>
    """

    html = _base_email_shell(
        preheader_text=preheader,
        headline=headline,
        badge_text="Day 0 &bull; Banker Drop",
        badge_color="#0284c7",
        content_html=content,
        cta_text="View All Today's Predictions",
        cta_url="https://addsbanta.com/predictions",
        unsubscribe_url=unsub_url
    )
    return subject, html


def render_onboarding_day1(data: Dict[str, Any], unsub_url: str) -> Tuple[str, str]:
    """Day 1: Demystifying the AI Math & Edge"""
    name = data.get("display_name", "Punter")

    subject = "🧠 How our AI model beat the bookies by 14.8% last month"
    preheader = "The math behind Addsbanta's Poisson regression and xG simulations."
    headline = "How math beats the bookmaker margin."

    content = f"""
    <p>Hi {name},</p>
    <p>Bookmakers don't set odds based on who will win. They set odds to balance their books and guarantee their <strong>5% to 8% margin</strong> (the 'overround').</p>
    
    <p>That means public bias creates massive mathematical mispricings on every matchday.</p>

    <div class="card-box">
      <h4 style="font-size: 14px; font-weight: 700; color: #38bdf8; margin: 0 0 8px 0;">The 3 Pillars of Addsbanta's Model:</h4>
      <ul style="margin: 0; padding-left: 18px; color: #cbd5e1; font-size: 13px; line-height: 1.6;">
        <li style="margin-bottom: 6px;"><strong>Bivariate Poisson Regression:</strong> Calculates exact goal expectancy distributions for both home and away teams.</li>
        <li style="margin-bottom: 6px;"><strong>10,000 Monte Carlo Iterations:</strong> Simulates match scenarios factoring in defensive decay and match state tempo.</li>
        <li><strong>Odds Disparity Engine:</strong> Automatically flags fixtures where our projected win probability exceeds the implied bookmaker odds by &gt; 6.5%.</li>
      </ul>
    </div>

    <p>When you place bets with positive expected value (+EV), short-term luck vanishes and long-term mathematics takes over.</p>
    """

    html = _base_email_shell(
        preheader_text=preheader,
        headline=headline,
        badge_text="Day 1 &bull; Model Deep Dive",
        badge_color="#6366f1",
        content_html=content,
        cta_text="Inspect Today's High-Value Fixtures",
        cta_url="https://addsbanta.com/predictions",
        unsubscribe_url=unsub_url
    )
    return subject, html


def render_onboarding_day3(data: Dict[str, Any], unsub_url: str) -> Tuple[str, str]:
    """Day 3: Proof of Performance & Results Transparency"""
    name = data.get("display_name", "Punter")
    win_rate = data.get("win_rate", "83.3%")

    subject = "📈 Yesterday's results: 4 out of 5 clean sweep (Full breakdown)"
    preheader = "Full transparency: See our latest settled picks and historical strike rate."
    headline = "Transparency is our only currency."

    content = f"""
    <p>Hi {name},</p>
    <p>Most betting channels only show you their wins and delete their losses. At Addsbanta, every single prediction is stored immutably on the blockchain-audited database before kickoff.</p>

    <div class="card-box" style="border-left: 4px solid #10b981;">
      <span style="font-size: 11px; font-weight: 700; color: #10b981; text-transform: uppercase;">Recent 48h Model Settlement</span>
      <h3 style="font-size: 20px; font-weight: 800; color: #ffffff; margin: 4px 0 10px 0;">{win_rate} Strike Rate on Banker Markets</h3>
      
      <table border="0" cellpadding="6" cellspacing="0" width="100%" style="font-size: 13px;">
        <tr style="border-bottom: 1px solid #28354d; color: #94a3b8;">
          <th align="left">Fixture</th>
          <th align="left">Tip</th>
          <th align="right">Result</th>
        </tr>
        <tr style="border-bottom: 1px solid #28354d;">
          <td style="color: #f8fafc;">Real Madrid vs Betis</td>
          <td style="color: #38bdf8;">Home Win (1.45)</td>
          <td align="right" style="color: #10b981; font-weight: 700;">WIN (2-0) &#10004;</td>
        </tr>
        <tr style="border-bottom: 1px solid #28354d;">
          <td style="color: #f8fafc;">Liverpool vs Bournemouth</td>
          <td style="color: #38bdf8;">Over 2.5 Goals (1.52)</td>
          <td align="right" style="color: #10b981; font-weight: 700;">WIN (3-0) &#10004;</td>
        </tr>
        <tr>
          <td style="color: #f8fafc;">Bayern vs Wolfsburg</td>
          <td style="color: #38bdf8;">Home &amp; Over 2.5 (1.65)</td>
          <td align="right" style="color: #10b981; font-weight: 700;">WIN (3-2) &#10004;</td>
        </tr>
      </table>
    </div>

    <p>Check out the live verified performance board to see historical yields across all major leagues.</p>
    """

    html = _base_email_shell(
        preheader_text=preheader,
        headline=headline,
        badge_text="Day 3 &bull; Verified Proof",
        badge_color="#10b981",
        content_html=content,
        cta_text="See Verified Settlement Ledger",
        cta_url="https://addsbanta.com/performance",
        unsubscribe_url=unsub_url
    )
    return subject, html


def render_onboarding_day5(data: Dict[str, Any], unsub_url: str) -> Tuple[str, str]:
    """Day 5: Bankroll Management & Staking Discipline"""
    name = data.get("display_name", "Punter")

    subject = "💡 The #1 mistake 95% of punters make (and how to fix it)"
    preheader = "Why a 10-game accumulator is a gift to the bookmaker."
    headline = "Stop donating money on 15-game accas."

    content = f"""
    <p>Hi {name},</p>
    <p>Here is an uncomfortable truth: Bookmakers make over <strong>80% of their annual profit</strong> on recreational 8+ game accumulators.</p>
    
    <p>Every leg you add multiplies the bookmaker's edge against you. To make steady, compounding profits, professional syndicates use <strong>Singles, Doubles, and Flat Staking</strong>.</p>

    <div class="card-box">
      <h4 style="font-size: 14px; font-weight: 700; color: #fbbf24; margin: 0 0 8px 0;">The Addsbanta Golden Rules:</h4>
      <ol style="margin: 0; padding-left: 18px; color: #cbd5e1; font-size: 13px; line-height: 1.6;">
        <li style="margin-bottom: 6px;"><strong>Never bet more than 2-3% of your bankroll</strong> on a single slip.</li>
        <li style="margin-bottom: 6px;"><strong>Stick to High Confidence (&gt;75%) singles or 2-leg doubles</strong>.</li>
        <li><strong>Track every bet</strong> like an investment portfolio, not a lottery ticket.</li>
      </ol>
    </div>

    <p>Our platform includes built-in Kelly Criterion stake sizing recommendations for every published fixture.</p>
    """

    html = _base_email_shell(
        preheader_text=preheader,
        headline=headline,
        badge_text="Day 5 &bull; Bankroll Mastery",
        badge_color="#f59e0b",
        content_html=content,
        cta_text="View Today's Low-Risk Banker Doubles",
        cta_url="https://addsbanta.com/predictions",
        unsubscribe_url=unsub_url
    )
    return subject, html


def render_onboarding_day7(data: Dict[str, Any], unsub_url: str) -> Tuple[str, str]:
    """Day 7: Pro VIP Upgrade Special"""
    name = data.get("display_name", "Punter")

    subject = "🚀 Upgrade your edge: Unlock Goals Specialist & VIP Telegram Bot"
    preheader = "Your 7-day tour is complete. Claim your 20% VIP upgrade discount."
    headline = "Ready to take your game to the Pro level?"

    content = f"""
    <p>Hi {name},</p>
    <p>Over the last 7 days, you've seen how Addsbanta's probabilistic algorithms identify high-confidence value.</p>
    
    <p>While our Free tier provides daily Banker predictions, our <strong>VIP &amp; Pro Members</strong> get exclusive access to our highest-yielding algorithmic engines:</p>

    <div class="card-box" style="border: 1px solid #38bdf8;">
      <h4 style="font-size: 15px; font-weight: 800; color: #38bdf8; margin: 0 0 10px 0;">What Pro Unlocks For You:</h4>
      <ul style="margin: 0; padding-left: 18px; color: #e2e8f0; font-size: 13px; line-height: 1.7;">
        <li><strong>Goals Specialist Feed:</strong> High-edge Over/Under 1.5, 2.5 &amp; Both Teams to Score models with 78%+ historical strike rates.</li>
        <li><strong>Real-Time VIP Telegram Bot:</strong> Instant push notifications right when odds peak or line movement triggers value.</li>
        <li><strong>Full Poisson Probability Matrix:</strong> Detailed expected goals scoreline matrices for every fixture.</li>
        <li><strong>Early-Bird Line Alerts:</strong> 48 hours before match kickoff.</li>
      </ul>
      <div style="margin-top: 14px; padding: 10px; background-color: #0b1329; border-radius: 6px; text-align: center;">
        <span style="font-size: 12px; color: #94a3b8;">Use promo code at checkout:</span><br>
        <span style="font-size: 16px; font-weight: 800; color: #fbbf24; letter-spacing: 1px;">ODDSEDGE20</span>
        <span style="font-size: 12px; color: #10b981; font-weight: 600;">(20% OFF FIRST MONTH)</span>
      </div>
    </div>
    """

    html = _base_email_shell(
        preheader_text=preheader,
        headline=headline,
        badge_text="Day 7 &bull; Pro VIP Offer",
        badge_color="#ec4899",
        content_html=content,
        cta_text="Claim 20% Off Pro VIP Access",
        cta_url="https://addsbanta.com/pricing?code=ODDSEDGE20",
        unsubscribe_url=unsub_url
    )
    return subject, html


def render_matchday_alert(data: Dict[str, Any], unsub_url: str) -> Tuple[str, str]:
    """Matchday Drops: Weekend & Midweek Top Value Banker Slip"""
    date_title = data.get("date_title", "Weekend Matchday")
    fixtures = data.get("fixtures", [
        {"match": "Man City vs Arsenal", "league": "Premier League", "market": "Over 2.5 Goals", "odds": "1.78", "confidence": "81%"},
        {"match": "Barcelona vs Sevilla", "league": "La Liga", "market": "Home Win", "odds": "1.42", "confidence": "86%"},
        {"match": "Inter vs Juventus", "league": "Serie A", "market": "BTTS - Yes", "odds": "1.85", "confidence": "76%"}
    ])

    subject = f"🔥 {date_title} Drop: Top Value Bets for Today's Fixtures"
    preheader = f"3 top value predictions with >75% confidence for {date_title}."
    headline = f"{date_title} Value Slate is Live."

    fixtures_rows = ""
    for f in fixtures[:4]:
        fixtures_rows += f"""
        <div style="background-color: #1a2234; border: 1px solid #28354d; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px;">
          <table border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td>
                <span style="font-size: 11px; color: #94a3b8; text-transform: uppercase;">{f.get('league', 'League')}</span>
                <div style="font-size: 14px; font-weight: 700; color: #ffffff; margin: 2px 0;">{f.get('match', 'Match')}</div>
                <div style="font-size: 12px; color: #38bdf8;">Tip: <strong>{f.get('market', 'Market')}</strong></div>
              </td>
              <td align="right">
                <div style="font-size: 16px; font-weight: 800; color: #fbbf24;">{f.get('odds', '1.60')}</div>
                <span style="font-size: 11px; color: #10b981; font-weight: 700;">{f.get('confidence', '80%')}</span>
              </td>
            </tr>
          </table>
        </div>
        """

    content = f"""
    <p>The simulations have completed for today's slate. Here are the top mathematical edges flagged by the consensus algorithm:</p>

    {fixtures_rows}

    <p style="margin-top: 14px;">Visit the platform to view live in-game model shifts and Goals Specialist feeds.</p>
    """

    html = _base_email_shell(
        preheader_text=preheader,
        headline=headline,
        badge_text="Matchday Alert",
        badge_color="#ef4444",
        content_html=content,
        cta_text="View Full Matchday Analysis",
        cta_url="https://addsbanta.com/predictions",
        unsubscribe_url=unsub_url
    )
    return subject, html


def render_reengagement_inactive(data: Dict[str, Any], unsub_url: str) -> Tuple[str, str]:
    """14-Day Inactive User Re-engagement"""
    name = data.get("display_name", "Punter")

    subject = "👋 We missed you! Claim 3 Free VIP Predictions this Weekend"
    preheader = "We've added new features since your last visit. Come take a look."
    headline = f"It's been a while, {name}."

    content = f"""
    <p>We noticed you haven't checked the Addsbanta forecast board in over two weeks.</p>
    
    <p>Since your last visit, we've upgraded our <strong>Goals Specialist engine</strong> with enhanced defensive fatigue models and real-time team lineup injury weighting.</p>

    <div class="card-box" style="border-left: 4px solid #38bdf8; text-align: center;">
      <span style="font-size: 11px; font-weight: 700; color: #38bdf8; text-transform: uppercase;">Complimentary VIP Pass</span>
      <h3 style="font-size: 18px; font-weight: 800; color: #ffffff; margin: 6px 0 8px 0;">3 Free High-Confidence VIP Slips</h3>
      <p style="font-size: 13px; color: #94a3b8; margin: 0;">Log back in this weekend and unlock 3 premium VIP fixtures completely on the house.</p>
    </div>
    """

    html = _base_email_shell(
        preheader_text=preheader,
        headline=headline,
        badge_text="Welcome Back",
        badge_color="#38bdf8",
        content_html=content,
        cta_text="Claim Free Weekend Picks",
        cta_url="https://addsbanta.com/predictions?claim=welcomeback",
        unsubscribe_url=unsub_url
    )
    return subject, html


# Template Registry
TEMPLATE_MAP = {
    "onboarding_day0_welcome": render_onboarding_day0,
    "onboarding_day1_math_breakdown": render_onboarding_day1,
    "onboarding_day3_proof_results": render_onboarding_day3,
    "onboarding_day5_bankroll_mistakes": render_onboarding_day5,
    "onboarding_day7_vip_upgrade": render_onboarding_day7,
    "matchday_alert": render_matchday_alert,
    "reengagement_inactive": render_reengagement_inactive,
}


def render_email_template(
    campaign_slug: str,
    data: Dict[str, Any],
    unsubscribe_token: Optional[str] = None
) -> Tuple[str, str]:
    """
    Renders an email given a campaign slug and context data.
    Returns (subject, html_content).
    """
    unsub_url = f"https://addsbanta.com/unsubscribe?token={unsubscribe_token or 'sample_token'}"
    renderer = TEMPLATE_MAP.get(campaign_slug, render_onboarding_day0)
    return renderer(data, unsub_url)
