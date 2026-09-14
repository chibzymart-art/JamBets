"""
Addsbanta — Dispatch All 7 Follow-Up Email Categories to a Test Recipient
Renders and sends each email category:
1. Day 0: Welcome + Banker Drop
2. Day 1: AI Model & xG Breakdown
3. Day 3: Verified Proof & Performance Ledger
4. Day 5: Bankroll & Staking Discipline
5. Day 7: VIP Pro Upgrade (20% Off)
6. Matchday Alert: Weekend Top Value Banker Slip
7. Inactive Re-engagement: 3 Free VIP Picks
"""

import sys
import os
import time
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

root_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(root_dir))
sys.path.insert(0, str(root_dir / "python" / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from python.src.email_engine.relay_pool import SmartRelayPool
from python.src.email_engine.templates import render_email_template, TEMPLATE_MAP


def send_all_categories(target_email: str = "whizzchibz@gmail.com"):
    print("\n" + "=" * 65)
    print(f"ODDSBANTA EMAIL ENGINE — TEST DISPATCH TO {target_email}")
    print("=" * 65)

    pool = SmartRelayPool()
    status = pool.get_pool_status()

    # Check if live relay is configured
    live_providers = [p for p in status["providers"] if p["provider_id"] != "console_mock" and p["configured"]]
    is_live = len(live_providers) > 0

    if is_live:
        print(f"[LIVE MODE] Outbound live SMTP configured via: {[p['provider_id'] for p in live_providers]}")
    else:
        print("[MOCK MODE] No live SMTP credentials found in .env.")
        print("[MOCK MODE] Rendering all 7 HTML emails and logging dispatches.")
        print("[MOCK MODE] Also saving full HTML preview files to 'scratch/email_previews/' for browser inspection.\n")

    # Create preview directory
    preview_dir = root_dir / "scratch" / "email_previews"
    preview_dir.mkdir(parents=True, exist_ok=True)

    test_context = {
        "display_name": "Chibueze",
        "banker_match": "Arsenal vs Chelsea",
        "banker_league": "Premier League",
        "banker_market": "Over 2.5 Goals / Home Win",
        "banker_confidence": "86%",
        "banker_odds": "1.74",
        "win_rate": "84.6%",
        "date_title": "Super Weekend Matchday",
        "fixtures": [
            {"match": "Arsenal vs Chelsea", "league": "Premier League", "market": "Over 2.5 Goals", "odds": "1.74", "confidence": "86%"},
            {"match": "Real Madrid vs Sevilla", "league": "La Liga", "market": "Home Win & Over 1.5", "odds": "1.48", "confidence": "88%"},
            {"match": "Inter vs AC Milan", "league": "Serie A", "market": "BTTS - Yes", "odds": "1.82", "confidence": "79%"},
            {"match": "Bayern Munich vs Leverkusen", "league": "Bundesliga", "market": "Over 3.5 Goals", "odds": "2.10", "confidence": "74%"}
        ]
    }

    categories = [
        ("onboarding_day0_welcome", "Day 0: Welcome & Banker Drop"),
        ("onboarding_day1_math_breakdown", "Day 1: AI Model & xG Breakdown"),
        ("onboarding_day3_proof_results", "Day 3: Proof of Performance & Ledger"),
        ("onboarding_day5_bankroll_mistakes", "Day 5: Bankroll & Staking Discipline"),
        ("onboarding_day7_vip_upgrade", "Day 7: VIP Pro Upgrade & Bot Access"),
        ("matchday_alert", "Matchday Alert: Top Value Banker Slate"),
        ("reengagement_inactive", "14-Day Inactive User Re-engagement"),
    ]

    results = []

    for index, (slug, label) in enumerate(categories, 1):
        print(f"[{index}/7] Rendering & Dispatching: {label}...")
        subject, html = render_email_template(slug, test_context, unsubscribe_token=f"unsub_token_{target_email}")

        # Save HTML file for direct browser inspection
        preview_file = preview_dir / f"{slug}.html"
        with open(preview_file, "w", encoding="utf-8") as f:
            f.write(html)

        # Dispatch via pool
        res = pool.dispatch(
            to_email=target_email,
            subject=subject,
            html_body=html,
            sender_name="Addsbanta AI Engine"
        )

        results.append({
            "category": label,
            "slug": slug,
            "subject": subject,
            "success": res.success,
            "provider": res.provider_id,
            "error": res.error,
            "html_path": str(preview_file)
        })

        # Brief delay to prevent rate issues
        if is_live:
            time.sleep(1.0)

    print("\n" + "=" * 65)
    print("DISPATCH SUMMARY TABLE")
    print("=" * 65)
    for r in results:
        status_icon = "SUCCESS" if r["success"] else "FAILED"
        print(f"- {r['category']}")
        print(f"  Subject:  {r['subject']}")
        print(f"  Status:   {status_icon} (via {r['provider']})")
        print(f"  Preview:  {r['html_path']}")
        if r["error"]:
            print(f"  Error:    {r['error']}")
        print()

    print("=" * 65)
    if not is_live:
        print("\nNOTE: To physically send these 7 emails to your Gmail inbox (whizzchibz@gmail.com):")
        print("1. Open your .env file")
        print("2. Add your Gmail address and a 16-character Google App Password:")
        print("   GMAIL_SMTP_USER=whizzchibz@gmail.com")
        print("   GMAIL_SMTP_APP_PASSWORD=xxxx xxxx xxxx xxxx")
        print("3. Run: python scripts/send_test_suite_email.py")
        print("It will instantly deliver all 7 real emails directly to your Gmail inbox!\n")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "whizzchibz@gmail.com"
    send_all_categories(target)
