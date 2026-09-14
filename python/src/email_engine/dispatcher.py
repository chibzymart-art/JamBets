"""
Addsbanta — Autonomous Email Queue Dispatcher & Drip Automator
Processes drip funnels, matchday alerts, and subscriber queue using the SmartRelayPool.
"""

import sys
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional

from .relay_pool import SmartRelayPool, RelayResult
from .templates import render_email_template, TEMPLATE_MAP


class EmailDispatcher:
    def __init__(self, db_client: Optional[Any] = None, relay_pool: Optional[SmartRelayPool] = None, dry_run: bool = False):
        self.db = db_client
        self.dry_run = dry_run
        self.pool = relay_pool or SmartRelayPool(db_client=db_client, dry_run=dry_run)

    # -------------------------------------------------------------------------
    # 1. SUBSCRIBER ENROLLMENT & DRIP SCHEDULER
    # -------------------------------------------------------------------------

    def sync_and_enroll_users(self) -> int:
        """
        Discovers any registered users in public.users not yet in email_subscribers
        and enqueues their Day 0 Welcome Drip.
        """
        if not self.db or not hasattr(self.db, "get"):
            return 0

        enrolled_count = 0
        try:
            # Fetch users from public.users
            users = self.db.get("users", {"select": "id,email,display_name,role,created_at", "limit": "500"})
            if not users:
                return 0

            # Fetch existing emails from email_subscribers
            existing_subs = self.db.get("email_subscribers", {"select": "email"})
            existing_emails = {s.get("email", "").lower() for s in existing_subs if s.get("email")}

            for u in users:
                email = u.get("email", "").strip().lower()
                if not email or email in existing_emails:
                    continue

                display_name = u.get("display_name") or email.split("@")[0]
                tier = u.get("role", "free")

                # Insert into email_subscribers
                sub_res = self.db.post("email_subscribers", [{
                    "user_id": u.get("id"),
                    "email": email,
                    "display_name": display_name,
                    "tier": tier
                }])

                sub_id = sub_res[0].get("id") if sub_res else None

                # Enqueue Day 0 Welcome Email
                self.db.post("email_queue", [{
                    "recipient_email": email,
                    "subscriber_id": sub_id,
                    "campaign_slug": "onboarding_day0",
                    "subject": "🎯 Welcome to Addsbanta — Here is today's high-confidence Banker Pick",
                    "template_data": {
                        "display_name": display_name,
                        "user_id": u.get("id")
                    },
                    "scheduled_for": datetime.now(timezone.utc).isoformat()
                }], on_conflict="recipient_email,campaign_slug")

                enrolled_count += 1
                existing_emails.add(email)

        except Exception as e:
            print(f"[DISPATCHER ERROR] Failed to sync users: {e}", file=sys.stderr)

        return enrolled_count

    def schedule_drip_sequences(self) -> int:
        """
        Checks active subscribers and enqueues Day 1, 3, 5, 7, and 14 follow-ups
        based on registration timeline.
        """
        if not self.db or not hasattr(self.db, "get"):
            return 0

        queued_count = 0
        now = datetime.now(timezone.utc)

        # Drip schedule: (days_threshold, campaign_slug, subject)
        drips = [
            (1, "onboarding_day1", "🧠 How our AI model beat the bookies by 14.8% last month"),
            (3, "onboarding_day3", "📈 Yesterday's results: 4 out of 5 clean sweep (Full breakdown)"),
            (5, "onboarding_day5", "💡 The #1 mistake 95% of punters make (and how to fix it)"),
            (7, "onboarding_day7", "🚀 Upgrade your edge: Unlock Goals Specialist & VIP Telegram Bot"),
            (14, "reengagement_inactive", "👋 We missed you! Claim 3 Free VIP Predictions this Weekend")
        ]

        try:
            subscribers = self.db.get("email_subscribers", {
                "status": "eq.active",
                "select": "id,email,display_name,created_at,preferences"
            })

            # Existing queued/sent items to avoid redundant checks
            existing_queue = self.db.get("email_queue", {"select": "recipient_email,campaign_slug"})
            sent_map = {(q["recipient_email"].lower(), q["campaign_slug"]) for q in existing_queue}

            for sub in subscribers:
                email = sub.get("email", "").strip().lower()
                if not email:
                    continue

                prefs = sub.get("preferences") or {}
                if not prefs.get("onboarding_drip", True):
                    continue

                created_str = sub.get("created_at")
                if not created_str:
                    continue

                created_dt = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
                days_since_signup = (now - created_dt).total_seconds() / 86400.0

                for min_days, slug, default_subj in drips:
                    if days_since_signup >= min_days:
                        if (email, slug) in sent_map:
                            continue

                        # Enqueue drip
                        self.db.post("email_queue", [{
                            "recipient_email": email,
                            "subscriber_id": sub.get("id"),
                            "campaign_slug": slug,
                            "subject": default_subj,
                            "template_data": {
                                "display_name": sub.get("display_name") or email.split("@")[0]
                            },
                            "scheduled_for": now.isoformat()
                        }], on_conflict="recipient_email,campaign_slug")

                        sent_map.add((email, slug))
                        queued_count += 1

        except Exception as e:
            print(f"[DISPATCHER ERROR] Error scheduling drips: {e}", file=sys.stderr)

        return queued_count

    # -------------------------------------------------------------------------
    # 2. MATCHDAY ALERTS BROADCAST
    # -------------------------------------------------------------------------

    def enqueue_matchday_alert(self, fixtures: List[Dict[str, Any]], date_title: str = "Weekend Matchday") -> int:
        """
        Enqueues a matchday prediction alert to all active subscribers.
        """
        if not self.db or not hasattr(self.db, "get"):
            return 0

        queued_count = 0
        now = datetime.now(timezone.utc)
        subject = f"🔥 {date_title} Drop: Top Value Bets for Today's Fixtures"

        try:
            subscribers = self.db.get("email_subscribers", {
                "status": "eq.active",
                "select": "id,email,display_name,preferences"
            })

            # Create campaign slug with date to allow one matchday alert per day
            day_slug = f"matchday_{date_title.lower().replace(' ', '_')}_{now.strftime('%Y%m%d')}"

            for sub in subscribers:
                email = sub.get("email", "").strip().lower()
                if not email:
                    continue

                prefs = sub.get("preferences") or {}
                if not prefs.get("matchday_alerts", True):
                    continue

                self.db.post("email_queue", [{
                    "recipient_email": email,
                    "subscriber_id": sub.get("id"),
                    "campaign_slug": "matchday_alert",
                    "subject": subject,
                    "template_data": {
                        "display_name": sub.get("display_name") or email.split("@")[0],
                        "date_title": date_title,
                        "fixtures": fixtures
                    },
                    "scheduled_for": now.isoformat()
                }], on_conflict="recipient_email,campaign_slug")
                queued_count += 1

        except Exception as e:
            print(f"[DISPATCHER ERROR] Failed to enqueue matchday alerts: {e}", file=sys.stderr)

        return queued_count

    # -------------------------------------------------------------------------
    # 3. QUEUE RUNNER & BATCH DISPATCH
    # -------------------------------------------------------------------------

    def process_queue(self, batch_size: int = 50, rate_limit_delay_secs: float = 0.5) -> Dict[str, Any]:
        """
        Pulls pending items from the email queue and dispatches them via the SmartRelayPool.
        Enforces a gentle rate-limit pause between dispatches to maintain pristine IP reputation.
        """
        if not self.db or not hasattr(self.db, "get"):
            print("[DISPATCHER NOTICE] Database not available. Returning zero processed items.")
            return {"processed": 0, "sent": 0, "failed": 0, "pool_status": self.pool.get_pool_status()}

        now_iso = datetime.now(timezone.utc).isoformat()
        processed = 0
        sent = 0
        failed = 0

        try:
            # Query pending queue items
            queue_items = self.db.get("email_queue", {
                "status": "eq.pending",
                "scheduled_for": f"lte.{now_iso}",
                "order": "priority.asc,created_at.asc",
                "limit": str(batch_size)
            })

            if not queue_items:
                return {"processed": 0, "sent": 0, "failed": 0, "pool_status": self.pool.get_pool_status()}

            for item in queue_items:
                item_id = item.get("id")
                recipient = item.get("recipient_email")
                campaign_slug = item.get("campaign_slug", "onboarding_day0")
                subject = item.get("subject", "Addsbanta Update")
                template_data = item.get("template_data") or {}
                attempts = item.get("attempts", 0) + 1

                # Mark as processing
                self.db.patch("email_queue", {"status": "processing", "attempts": attempts}, {"id": f"eq.{item_id}"})

                # Render template
                rendered_subject, html_body = render_email_template(
                    campaign_slug=campaign_slug,
                    data=template_data,
                    unsubscribe_token=template_data.get("unsub_token")
                )

                # Use custom rendered subject if available
                final_subject = rendered_subject or subject

                # Dispatch via relay pool
                result: RelayResult = self.pool.dispatch(
                    to_email=recipient,
                    subject=final_subject,
                    html_body=html_body,
                    sender_name="Addsbanta"
                )

                processed += 1

                if result.success:
                    sent += 1
                    # Mark queue item sent
                    self.db.patch("email_queue", {
                        "status": "sent",
                        "sent_at": datetime.now(timezone.utc).isoformat(),
                        "provider_used": result.provider_id
                    }, {"id": f"eq.{item_id}"})

                    # Update last_emailed_at on subscriber
                    try:
                        self.db.patch("email_subscribers", {
                            "last_emailed_at": datetime.now(timezone.utc).isoformat()
                        }, {"email": f"eq.{recipient}"})
                    except Exception:
                        pass
                else:
                    failed += 1
                    # Check if max attempts reached
                    max_attempts = item.get("max_attempts", 3)
                    new_status = "failed" if attempts >= max_attempts else "pending"
                    self.db.patch("email_queue", {
                        "status": new_status,
                        "last_error": result.error or result.message
                    }, {"id": f"eq.{item_id}"})

                # Respectful sending jitter to stay below ISP burst limits
                if rate_limit_delay_secs > 0:
                    time.sleep(rate_limit_delay_secs)

        except Exception as e:
            print(f"[DISPATCHER ERROR] Error processing email queue: {e}", file=sys.stderr)

        return {
            "processed": processed,
            "sent": sent,
            "failed": failed,
            "pool_status": self.pool.get_pool_status()
        }
