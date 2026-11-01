"""
Oddsbanta daily lifecycle and results emails.

Runs once a day from .github/workflows/lifecycle_emails.yml:

    python -m python.src.email_engine.lifecycle --dry-run          # print who would get what
    python -m python.src.email_engine.lifecycle --send             # really send (needs RESEND_API_KEY)
    python -m python.src.email_engine.lifecycle --preview-dir out  # write sample HTML for every email

Campaigns (each sent at most once per user and period, enforced by email_send_log's unique key):
    trial_ending    trial ends within the next 24h, no paid plan
    trial_ended     trial ended within the last 24h, no paid plan
    renewal_due     paid access ends within 72h and will not auto-renew
    plan_expired    paid access ended within the last 48h and was not renewed
    payment_failed  a Bachs subscription is past_due
    winback         paid access or trial ended 7 to 9 days ago, still no plan
    daily_results   yesterday's (WAT) settled football + goals picks, at least MIN_SETTLED_FOR_DAILY

The job only reads users/subscriptions/entitlements and settled picks. It writes only to
email_preferences (creating missing rows) and email_send_log. A dry run writes nothing.
"""

import argparse
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from .lifecycle_templates import render

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SITE = "https://www.oddsbanta.com"
WAT = timezone(timedelta(hours=1))
TRIAL = timedelta(days=3)
MIN_SETTLED_FOR_DAILY = 5
PAID_TIERS = {"standard", "bigbang", "big_bang", "vip", "pro", "premium"}
VIP_TIERS = {"bigbang", "big_bang", "vip", "pro", "premium"}
PRICES = {"standard_price": "₦5,000 ($5)", "vip_price": "₦10,000 ($10)"}

LIFECYCLE_CAMPAIGNS = ["payment_failed", "renewal_due", "plan_expired", "trial_ending", "trial_ended", "winback"]
ALL_CAMPAIGNS = LIFECYCLE_CAMPAIGNS + ["daily_results"]


# ── Pure helpers (unit tested) ────────────────────────────────────────────────────────────────────

def parse_ts(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def day_label(dt: datetime) -> str:
    """'Sunday 1 November' in WAT."""
    d = dt.astimezone(WAT)
    return f"{d.strftime('%A')} {d.day} {d.strftime('%B')}"


def plan_name(tier: Optional[str]) -> str:
    return "BigBang VIP" if (tier or "").lower() in VIP_TIERS else "Standard"


@dataclass
class PlanState:
    paid_until: Optional[datetime] = None   # latest end of a paid subscription or entitlement
    tier: Optional[str] = None
    auto_renews: bool = False               # Bachs USD subscription that is active and not cancelling
    past_due: bool = False
    open_ended: bool = False                # paid role with no end date (manual grant, admin)
    ever_paid: bool = False


def plan_state(user: Dict[str, Any], subs: Iterable[Dict[str, Any]], ents: Iterable[Dict[str, Any]]) -> PlanState:
    st = PlanState()
    role = (user.get("role") or "").lower()

    def consider(tier: str, until: Optional[datetime]) -> None:
        if until and (st.paid_until is None or until > st.paid_until):
            st.paid_until = until
            st.tier = tier

    for s in subs:
        tier = (s.get("tier") or "").lower()
        if tier not in PAID_TIERS:
            continue
        status = (s.get("status") or "").lower()
        until = parse_ts(s.get("current_period_end"))
        st.ever_paid = True
        if status == "past_due":
            st.past_due = True
        if status in ("active", "past_due"):
            consider(tier, until)
            if status == "active" and s.get("bachs_subscription_id") and not s.get("cancel_at_period_end"):
                st.auto_renews = True
        elif until:
            consider(tier, until)  # cancelled/disabled rows still tell us when access ended

    for e in ents:
        tier = (e.get("tier") or "").lower()
        if tier in PAID_TIERS:
            st.ever_paid = True
            consider(tier, parse_ts(e.get("valid_until")))

    # A paid role only counts as open-ended access when no dated plan exists (admin_allocate_user_tier
    # writes the role next to a dated entitlement, and those users still need renewal reminders).
    if role == "admin" or (role in PAID_TIERS and st.paid_until is None):
        st.open_ended = True
        st.ever_paid = True
        st.tier = st.tier or role
    return st


def has_access(user: Dict[str, Any], st: PlanState, now: datetime) -> bool:
    if st.open_ended or (st.paid_until and st.paid_until > now):
        return True
    created = parse_ts(user.get("created_at"))
    return bool(created and now < created + TRIAL)


def lifecycle_campaign(user: Dict[str, Any], st: PlanState, now: datetime) -> Optional[Tuple[str, str, Dict[str, Any]]]:
    """Returns (campaign, period_key, extra context) for the one reminder this user is due today, if any."""
    if st.open_ended:
        return None
    pu = st.paid_until
    if st.past_due and pu:
        return "payment_failed", pu.date().isoformat(), {"plan_name": plan_name(st.tier)}
    if pu and now < pu <= now + timedelta(hours=72) and not st.auto_renews:
        return "renewal_due", pu.date().isoformat(), {"plan_name": plan_name(st.tier), "period_end_label": day_label(pu)}
    if pu and pu <= now < pu + timedelta(hours=48):
        return "plan_expired", pu.date().isoformat(), {"plan_name": plan_name(st.tier), "period_end_label": day_label(pu)}
    if pu and pu + timedelta(days=7) <= now < pu + timedelta(days=9):
        return "winback", f"paid:{pu.date().isoformat()}", {}
    if pu and pu > now:
        return None
    if st.ever_paid:
        return None  # lapsed payers only get the reminders above
    created = parse_ts(user.get("created_at"))
    if not created:
        return None
    trial_end = created + TRIAL
    key = trial_end.date().isoformat()
    if trial_end - timedelta(hours=24) <= now < trial_end:
        return "trial_ending", key, {"trial_end_label": day_label(trial_end)}
    if trial_end <= now < trial_end + timedelta(hours=24):
        return "trial_ended", key, {}
    if trial_end + timedelta(days=7) <= now < trial_end + timedelta(days=9):
        return "winback", f"trial:{key}", {}
    return None


def results_window(now: datetime) -> Tuple[datetime, datetime, str]:
    """Yesterday in WAT as a UTC [start, end) window, plus its date key."""
    today_wat = now.astimezone(WAT).date()
    start = datetime(today_wat.year, today_wat.month, today_wat.day, tzinfo=WAT) - timedelta(days=1)
    end = start + timedelta(days=1)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc), start.date().isoformat()


def summarise_results(products: List[Tuple[str, List[Dict[str, Any]]]], start: datetime) -> Dict[str, Any]:
    out = {"date_label": day_label(start + timedelta(hours=12)), "won": 0, "lost": 0, "top_won": 0, "top_lost": 0, "products": []}
    for label, rows in products:
        won = lost = 0
        for r in rows:
            status = r.get("settlement_status")
            if status not in ("won", "lost"):
                continue
            p = float(r.get("probability") or 0)
            if p > 1:
                p /= 100
            top = round(p * 100) / 10 >= 8
            if status == "won":
                won += 1
                out["top_won"] += top
            else:
                lost += 1
                out["top_lost"] += top
        out["won"] += won
        out["lost"] += lost
        out["products"].append({"label": label, "won": won, "lost": lost})
    return out


def unsubscribe_url(token: str, scope: str) -> str:
    return f"{SITE}/api/unsubscribe?token={token}&scope={scope}"


# ── Data access ───────────────────────────────────────────────────────────────────────────────────

class Store:
    """Thin PostgREST wrapper around python.src.db.supabase_client.SupabaseClient's httpx client."""

    def __init__(self, db: Any):
        self.db = db

    def fetch_all(self, table: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
        rows: List[Dict[str, Any]] = []
        page = 1000
        for i in range(50):
            resp = self.db.client.get(f"/{table}", params=params, headers={"Range-Unit": "items", "Range": f"{i * page}-{(i + 1) * page - 1}"})
            resp.raise_for_status()
            batch = resp.json()
            rows.extend(batch)
            if len(batch) < page:
                break
        return rows

    def insert_ignore(self, table: str, rows: List[Dict[str, Any]], on_conflict: str) -> List[Dict[str, Any]]:
        """INSERT ... ON CONFLICT DO NOTHING; returns only the rows actually inserted."""
        if not rows:
            return []
        resp = self.db.client.post(
            f"/{table}", json=rows, params={"on_conflict": on_conflict},
            headers={"Prefer": "return=representation,resolution=ignore-duplicates"},
        )
        resp.raise_for_status()
        return resp.json() if resp.text else []

    def delete(self, table: str, params: Dict[str, str]) -> None:
        self.db.client.delete(f"/{table}", params=params).raise_for_status()


def group_by_user(rows: Iterable[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    out: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r.get("user_id"), []).append(r)
    return out


def load_results(store: Store, now: datetime) -> Tuple[str, Dict[str, Any]]:
    start, end, key = results_window(now)
    window = {"target_kickoff_at": f"gte.{start.isoformat()}", "and": f"(target_kickoff_at.lt.{end.isoformat()})"}
    football = store.fetch_all("football_predictions", {
        "select": "probability,settlement_status", "settlement_status": "in.(won,lost)",
        "confidence_category": "neq.NO_SAFE_BANKER", **window,
    })
    goals = store.fetch_all("goals_predictions", {
        "select": "probability,settlement_status", "settlement_status": "in.(won,lost)", **window,
    })
    return key, summarise_results([("Football main picks", football), ("Goals picks", goals)], start)


# ── Job ───────────────────────────────────────────────────────────────────────────────────────────

@dataclass
class Outgoing:
    user_id: str
    email: str
    campaign: str
    period_key: str
    ctx: Dict[str, Any] = field(default_factory=dict)


def plan_sends(now: datetime, users: List[Dict[str, Any]], subs: List[Dict[str, Any]], ents: List[Dict[str, Any]],
               prefs: Dict[str, Dict[str, Any]], already: Set[Tuple[str, str, str]],
               results: Optional[Tuple[str, Dict[str, Any]]], campaigns: Set[str]) -> List[Outgoing]:
    subs_by = group_by_user(subs)
    ents_by = group_by_user(ents)
    lifecycle: List[Outgoing] = []
    daily: List[Outgoing] = []
    for u in users:
        uid, email = u.get("id"), (u.get("email") or "").strip().lower()
        if not uid or not email or u.get("is_deleted") or (u.get("status") or "active") != "active":
            continue
        pref = prefs.get(uid) or {}
        if pref.get("unsubscribed_all_at"):
            continue
        name = (u.get("display_name") or "").strip() or email.split("@")[0]
        st = plan_state(u, subs_by.get(uid, []), ents_by.get(uid, []))
        base = {"name": name, **PRICES}

        if pref.get("lifecycle", True):
            due = lifecycle_campaign(u, st, now)
            if due and due[0] in campaigns and (uid, due[0], due[1]) not in already:
                lifecycle.append(Outgoing(uid, email, due[0], due[1], {**base, **due[2]}))

        if results and "daily_results" in campaigns and pref.get("daily_results", True):
            key, summary = results
            if summary["won"] + summary["lost"] >= MIN_SETTLED_FOR_DAILY and (uid, "daily_results", key) not in already:
                daily.append(Outgoing(uid, email, "daily_results", key, {**base, "results": summary, "has_access": has_access(u, st, now)}))
    # Reminders first, so a daily cap never squeezes out a renewal or payment notice; then members with
    # access, so a cap trims the daily email for lapsed accounts before paying ones.
    daily.sort(key=lambda o: not o.ctx["has_access"])
    return lifecycle + daily


def send_resend(api_key: str, sender: str, out: Outgoing, subject: str, html: str, text: str, unsub: str) -> Tuple[bool, str]:
    import httpx
    resp = httpx.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Idempotency-Key": f"{out.campaign}/{out.user_id}/{out.period_key}",
        },
        json={
            "from": sender, "to": [out.email], "subject": subject, "html": html, "text": text,
            "headers": {"List-Unsubscribe": f"<{unsub}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
            "tags": [{"name": "campaign", "value": out.campaign}],
        },
        timeout=20.0,
    )
    data = resp.json() if resp.content else {}
    if resp.status_code >= 400:
        return False, str(data.get("message") or resp.status_code)
    return True, str(data.get("id") or "")


def unsubscribe_scope(campaign: str) -> Tuple[str, str]:
    if campaign == "daily_results":
        return "daily", "Stop the daily results email"
    return "lifecycle", "Stop plan and trial reminders"


def run(send: bool, campaigns: Set[str], cap: int, now: Optional[datetime] = None) -> Dict[str, int]:
    from python.src.db.supabase_client import SupabaseClient

    now = now or datetime.now(timezone.utc)
    store = Store(SupabaseClient())
    users = store.fetch_all("users", {"select": "id,email,display_name,role,status,is_deleted,created_at"})
    subs = store.fetch_all("subscriptions", {"select": "user_id,tier,status,current_period_end,cancel_at_period_end,bachs_subscription_id"})
    ents = store.fetch_all("entitlements", {"select": "user_id,tier,valid_until"})

    try:
        prefs = {p["user_id"]: p for p in store.fetch_all("email_preferences", {"select": "*"})}
        since = (now - timedelta(days=30)).isoformat()
        already = {(r["user_id"], r["campaign"], r["period_key"]) for r in store.fetch_all(
            "email_send_log", {"select": "user_id,campaign,period_key", "created_at": f"gte.{since}"})}
    except Exception as e:  # tables not created yet: fine for a dry run, fatal for a real send
        if send:
            raise
        print(f"[lifecycle] email tables unavailable ({type(e).__name__}); dry run assumes nobody has opted out")
        prefs, already = {}, set()

    results = load_results(store, now) if "daily_results" in campaigns else None
    if results:
        r = results[1]
        print(f"[lifecycle] results {results[0]}: {r['won']} won / {r['lost']} lost "
              f"({'sending' if r['won'] + r['lost'] >= MIN_SETTLED_FOR_DAILY else 'below minimum, skipped'})")

    queue = plan_sends(now, users, subs, ents, prefs, already, results, campaigns)
    counts = {c: 0 for c in ALL_CAMPAIGNS}
    for o in queue:
        counts[o.campaign] += 1
    print(f"[lifecycle] due: {', '.join(f'{c}={n}' for c, n in counts.items() if n) or 'nothing'}; cap {cap}")
    queue = queue[:cap]

    if send:
        missing = [o.user_id for o in queue if o.user_id not in prefs]
        for p in store.insert_ignore("email_preferences", [{"user_id": u} for u in dict.fromkeys(missing)], "user_id"):
            prefs[p["user_id"]] = p
        if any(o.user_id not in prefs for o in queue):
            prefs.update({p["user_id"]: p for p in store.fetch_all("email_preferences", {"select": "*"})})
        api_key = os.environ["RESEND_API_KEY"]
        sender = os.getenv("LIFECYCLE_FROM_EMAIL") or "Oddsbanta <updates@oddsbanta.com>"

    stats = {"sent": 0, "failed": 0, "skipped": 0}
    for o in queue:
        token = (prefs.get(o.user_id) or {}).get("unsubscribe_token") or "dry-run-token"
        scope, label = unsubscribe_scope(o.campaign)
        unsub = unsubscribe_url(token, scope)
        subject, html, text = render(o.campaign, {**o.ctx, "unsubscribe_url": unsub, "unsubscribe_label": label})
        if not send:
            print(f"[dry-run] {o.campaign:<15} {o.period_key:<18} {o.email}  |  {subject}")
            continue
        # Claim before sending: a re-run or overlapping run finds the row and skips.
        claimed = store.insert_ignore("email_send_log", [{"user_id": o.user_id, "campaign": o.campaign, "period_key": o.period_key}],
                                      "user_id,campaign,period_key")
        if not claimed:
            stats["skipped"] += 1
            continue
        try:
            ok, info = send_resend(api_key, sender, o, subject, html, text, unsub)
        except Exception as e:
            ok, info = False, type(e).__name__
        if ok:
            stats["sent"] += 1
            store.db.client.patch("/email_send_log", params={"id": f"eq.{claimed[0]['id']}"}, json={"provider_message_id": info})
        else:
            stats["failed"] += 1
            print(f"[lifecycle] {o.campaign} to user {o.user_id} failed: {info}", file=sys.stderr)
            store.delete("email_send_log", {"id": f"eq.{claimed[0]['id']}"})  # release so a later run can retry
        time.sleep(0.6)  # stay under Resend's request rate limit
    if send:
        print(f"[lifecycle] sent={stats['sent']} failed={stats['failed']} skipped={stats['skipped']}")
    return stats


def write_previews(directory: str) -> None:
    now = datetime.now(timezone.utc)
    sample = {"name": "Chibueze", **PRICES, "plan_name": "BigBang VIP", "period_end_label": day_label(now + timedelta(days=3)),
              "trial_end_label": day_label(now + timedelta(days=1)), "has_access": True,
              "results": {"date_label": day_label(now - timedelta(days=1)), "won": 14, "lost": 6, "top_won": 5, "top_lost": 1,
                          "products": [{"label": "Football main picks", "won": 9, "lost": 4}, {"label": "Goals picks", "won": 5, "lost": 2}]}}
    path = Path(directory)
    path.mkdir(parents=True, exist_ok=True)
    for c in ALL_CAMPAIGNS:
        scope, label = unsubscribe_scope(c)
        subject, html, _ = render(c, {**sample, "unsubscribe_url": unsubscribe_url("sample", scope), "unsubscribe_label": label})
        (path / f"{c}.html").write_text(html, encoding="utf-8")
        print(f"{c:<15} {subject}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Oddsbanta lifecycle and daily results emails")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="List who would get which email. Writes nothing.")
    mode.add_argument("--send", action="store_true", help="Send for real through Resend.")
    mode.add_argument("--preview-dir", help="Write sample HTML for every campaign to this folder.")
    ap.add_argument("--only", default="", help=f"Comma-separated campaigns (default all): {','.join(ALL_CAMPAIGNS)}")
    ap.add_argument("--cap", type=int, default=int(os.getenv("LIFECYCLE_DAILY_CAP") or 95),
                    help="Most emails to send in one run (default 95, under Resend's free 100/day).")
    args = ap.parse_args()

    if args.preview_dir:
        write_previews(args.preview_dir)
        return 0
    campaigns = {c.strip() for c in args.only.split(",") if c.strip()} or set(ALL_CAMPAIGNS)
    unknown = campaigns - set(ALL_CAMPAIGNS)
    if unknown:
        ap.error(f"unknown campaign(s): {', '.join(sorted(unknown))}")
    stats = run(send=args.send, campaigns=campaigns, cap=args.cap)
    return 1 if stats["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
