"""
Addsbanta — Email Engine CLI & Local Testing Runner
Run local simulations, inspect provider quotas, preview email templates, and test live dispatches.
"""

import sys
import os
import argparse
import json
from pathlib import Path

# Ensure root directory is on PYTHONPATH
root_dir = Path(__file__).resolve().parent.parent.parent.parent
sys.path.insert(0, str(root_dir))
sys.path.insert(0, str(root_dir / "python" / "src"))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from python.src.email_engine.relay_pool import SmartRelayPool
from python.src.email_engine.templates import render_email_template, TEMPLATE_MAP
from python.src.email_engine.dispatcher import EmailDispatcher

try:
    from python.src.db.supabase_client import SupabaseClient
    _has_supabase = True
except Exception:
    _has_supabase = False


def main():
    parser = argparse.ArgumentParser(description="Addsbanta Email Marketing & Relay Engine CLI")
    parser.add_argument("--status", action="store_true", help="Display relay pool capacity, configured providers, and quotas.")
    parser.add_argument("--preview", type=str, choices=list(TEMPLATE_MAP.keys()), help="Preview rendered HTML of a specific template.")
    parser.add_argument("--save-preview", type=str, help="File path to save the HTML preview (e.g., preview.html).")
    parser.add_argument("--send-test", type=str, help="Recipient email address for a test dispatch.")
    parser.add_argument("--template", type=str, default="onboarding_day0_welcome", help="Campaign template slug to test.")
    parser.add_argument("--dry-run", action="store_true", help="Force ConsoleMockRelay (no actual emails sent).")
    parser.add_argument("--run-cycle", action="store_true", help="Run full sync, schedule drips, and process queue.")

    args = parser.parse_args()

    # Initialize Supabase client if available
    db_client = None
    if _has_supabase:
        try:
            db_client = SupabaseClient()
        except Exception as e:
            print(f"[CLI NOTICE] Cloud Supabase connection skipped ({e}). Running in standalone mode.")

    pool = SmartRelayPool(db_client=db_client, dry_run=args.dry_run)
    dispatcher = EmailDispatcher(db_client=db_client, relay_pool=pool, dry_run=args.dry_run)

    # 1. Status Command
    if args.status or (not any([args.preview, args.send_test, args.run_cycle])):
        status = pool.get_pool_status()
        print("\n" + "=" * 65)
        print("🚀 ODDSBANTA EMAIL RELAY POOL STATUS (1,000+ DAILY FREE CAPACITY)")
        print("=" * 65)
        print(f"Date:               {status['date']}")
        print(f"Total Daily Quota:  {status['total_capacity']} emails/day")
        print(f"Emails Sent Today:  {status['total_sent_today']}")
        print(f"Remaining Capacity: {status['remaining_capacity']} emails/day")
        print("-" * 65)
        print(f"{'PROVIDER':<20} {'DAILY LIMIT':<14} {'SENT TODAY':<14} {'REMAINING':<12}")
        print("-" * 65)
        for p in status["providers"]:
            print(f"{p['provider_id']:<20} {p['daily_limit']:<14} {p['sent_today']:<14} {p['remaining']:<12}")
        print("=" * 65 + "\n")

    # 2. Template Preview
    if args.preview:
        sample_data = {
            "display_name": "Chibueze",
            "banker_match": "Arsenal vs Chelsea",
            "banker_league": "Premier League",
            "banker_market": "Over 2.5 Goals",
            "banker_confidence": "85%",
            "banker_odds": "1.74",
            "win_rate": "84.2%",
            "date_title": "Saturday Matchday"
        }
        subject, html = render_email_template(args.preview, sample_data, unsubscribe_token="sample_token_123")
        print(f"\n[TEMPLATE PREVIEW: {args.preview}]")
        print(f"Subject: {subject}")
        print(f"HTML Size: {len(html)} bytes")

        if args.save_preview:
            with open(args.save_preview, "w", encoding="utf-8") as f:
                f.write(html)
            print(f"Saved preview HTML to {args.save_preview}")

    # 3. Send Test Email
    if args.send_test:
        sample_data = {
            "display_name": args.send_test.split("@")[0],
            "banker_match": "Arsenal vs Chelsea",
            "banker_league": "Premier League",
            "banker_market": "Over 2.5 Goals",
            "banker_confidence": "85%",
            "banker_odds": "1.74",
            "win_rate": "84.2%",
            "date_title": "Saturday Matchday"
        }
        subject, html = render_email_template(args.template, sample_data)
        print(f"\nDispatching test email to '{args.send_test}' using template '{args.template}'...")
        res = pool.dispatch(args.send_test, subject, html)
        print(f"Result: success={res.success}, provider={res.provider_id}, message={res.message}")
        if res.error:
            print(f"Error details: {res.error}")

    # 4. Run Automated Cycle
    if args.run_cycle:
        print("\nStarting Addsbanta Email Dispatch Cycle...")
        enrolled = dispatcher.sync_and_enroll_users()
        print(f"1. New users enrolled in drip funnel: {enrolled}")
        scheduled = dispatcher.schedule_drip_sequences()
        print(f"2. Follow-up drip emails scheduled:   {scheduled}")
        res = dispatcher.process_queue(batch_size=50)
        print(f"3. Queue execution: processed={res['processed']}, sent={res['sent']}, failed={res['failed']}")
        print("Cycle completed successfully.\n")


if __name__ == "__main__":
    main()
