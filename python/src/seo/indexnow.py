"""
Oddsbanta — IndexNow notifier (Bing, Yandex, Seznam, Naver and other IndexNow engines).

Google does NOT participate in IndexNow; this does nothing for Google indexing.

How it works
------------
1. The key is hosted at https://www.oddsbanta.com/<key>.txt (web/public/<key>.txt). IndexNow
   keys are public by design: anyone can read the key file, it only proves the submitter
   controls the host.
2. After each engine run, the GitHub workflow calls this module for the sport(s) it touched.
3. The notifier checks Supabase for predictions created, updated or settled within the
   lookback window. Only if something actually changed does it submit that sport's public
   pages to https://api.indexnow.org/indexnow (shared endpoint, fans out to all engines).

It never raises and always exits 0, so a notification problem can never fail an engine run.

Usage
-----
    python -m python.src.seo.indexnow --sports football goals --since-minutes 75
    python -m python.src.seo.indexnow --sports tennis --force        # skip change detection
    python -m python.src.seo.indexnow --sports basketball --dry-run  # show what would be sent
"""

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

import httpx

HOST = "www.oddsbanta.com"
SITE_ORIGIN = f"https://{HOST}"
INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow"

# Public key; must match web/public/<key>.txt. Override with INDEXNOW_KEY if it is ever rotated.
DEFAULT_KEY = "35f03285c23927cc3644fe7e7da4e5c3"

# Public pages whose content changes when a sport's predictions publish or settle.
# The home page carries the settled-results summary, so it is refreshed for every sport.
# /track-record is intentionally not submitted (it is also excluded from sitemap.xml).
SPORT_PAGES: Dict[str, List[str]] = {
    "football": ["/", "/dashboard"],
    "goals": ["/", "/dashboard/goals"],
    "tennis": ["/", "/dashboard/tennis"],
    "basketball": ["/", "/dashboard/basketball"],
}

SPORT_TABLES: Dict[str, str] = {
    "football": "football_predictions",
    "goals": "goals_predictions",
    "tennis": "tennis_predictions",
    "basketball": "basketball_predictions",
}


def get_key() -> str:
    return (os.getenv("INDEXNOW_KEY") or DEFAULT_KEY).strip()


def urls_for_sports(sports: Iterable[str]) -> List[str]:
    """De-duplicated absolute URLs for the given sports, in a stable order."""
    seen: List[str] = []
    for sport in sports:
        for path in SPORT_PAGES.get(sport, []):
            url = f"{SITE_ORIGIN}{path}"
            if url not in seen:
                seen.append(url)
    return seen


def sport_changed_since(sport: str, since: datetime, supabase=None) -> Optional[bool]:
    """
    True if any prediction for the sport was created/updated/settled since `since`.
    Returns None if the check could not be performed (caller decides what to do).
    """
    table = SPORT_TABLES.get(sport)
    if not table:
        return None
    try:
        if supabase is None:
            from python.src.db.supabase_client import CloudSupabaseClient
            supabase = CloudSupabaseClient()
        ts = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        rows = supabase.get(table, {
            "select": "id",
            "or": f"(created_at.gte.{ts},updated_at.gte.{ts},settled_at.gte.{ts})",
            "limit": "1",
        })
        return len(rows) > 0
    except Exception as exc:  # network / auth / schema problems must not break the run
        print(f"  [IndexNow] Change check failed for {sport}: {exc}")
        return None


def submit_urls(urls: List[str], key: Optional[str] = None, timeout: float = 15.0) -> Dict[str, object]:
    """POST the URL list to IndexNow. Returns {'ok': bool, 'status': int|None, 'detail': str}."""
    if not urls:
        return {"ok": True, "status": None, "detail": "nothing to submit"}
    key = key or get_key()
    payload = {
        "host": HOST,
        "key": key,
        "keyLocation": f"{SITE_ORIGIN}/{key}.txt",
        "urlList": urls,
    }
    meanings = {
        200: "OK, URLs submitted",
        202: "Accepted, key validation pending",
        400: "Bad request (invalid format)",
        403: "Forbidden (key not valid / key file not found)",
        422: "Unprocessable (URLs do not belong to host or key mismatch)",
        429: "Too many requests (rate limited)",
    }
    try:
        resp = httpx.post(
            INDEXNOW_ENDPOINT,
            json=payload,
            headers={"Content-Type": "application/json; charset=utf-8"},
            timeout=timeout,
        )
        detail = meanings.get(resp.status_code, resp.text[:200] or "unexpected response")
        return {"ok": resp.status_code in (200, 202), "status": resp.status_code, "detail": detail}
    except Exception as exc:
        return {"ok": False, "status": None, "detail": f"request failed: {exc}"}


def notify(sports: List[str], since_minutes: int = 75, force: bool = False, dry_run: bool = False) -> Dict[str, object]:
    """Submit pages for the sports that changed within the window (or all, if force)."""
    since = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
    changed: List[str] = []
    for sport in sports:
        if sport not in SPORT_PAGES:
            print(f"  [IndexNow] Unknown sport '{sport}', skipped")
            continue
        if force:
            changed.append(sport)
            continue
        result = sport_changed_since(sport, since)
        if result is None:
            # Could not check: submit anyway; an extra notification is harmless, a missed one is not.
            print(f"  [IndexNow] {sport}: change check unavailable, submitting anyway")
            changed.append(sport)
        elif result:
            print(f"  [IndexNow] {sport}: predictions changed in the last {since_minutes} min")
            changed.append(sport)
        else:
            print(f"  [IndexNow] {sport}: no changes in the last {since_minutes} min")

    urls = urls_for_sports(changed)
    if not urls:
        print("  [IndexNow] Nothing changed, no submission sent.")
        return {"submitted": [], "result": None}

    if dry_run:
        print(f"  [IndexNow] DRY RUN, would submit {len(urls)} URL(s): {urls}")
        return {"submitted": urls, "result": {"ok": True, "status": None, "detail": "dry run"}}

    result = submit_urls(urls)
    status = result["status"] if result["status"] is not None else "n/a"
    print(f"  [IndexNow] Submitted {len(urls)} URL(s) -> HTTP {status}: {result['detail']}")
    for u in urls:
        print(f"    - {u}")
    return {"submitted": urls, "result": result}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Notify IndexNow engines about changed Oddsbanta pages")
    parser.add_argument("--sports", nargs="+", required=True, choices=sorted(SPORT_PAGES.keys()))
    parser.add_argument("--since-minutes", type=int, default=75, help="Change-detection lookback window")
    parser.add_argument("--force", action="store_true", help="Submit without checking for changes")
    parser.add_argument("--dry-run", action="store_true", help="Print what would be submitted")
    args = parser.parse_args(argv)

    print("=== IndexNow notification ===")
    try:
        notify(args.sports, since_minutes=args.since_minutes, force=args.force, dry_run=args.dry_run)
    except Exception as exc:  # belt and braces: never fail the calling workflow
        print(f"  [IndexNow] Unexpected error (ignored): {exc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
