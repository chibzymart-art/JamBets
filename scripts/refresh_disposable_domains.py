"""Refresh public.disposable_email_domains from the open-source disposable-email-domains list.

Adds new domains only (never deletes, so hand-added entries stay). Used by the monthly
.github/workflows/refresh_disposable_domains.yml; safe to run by hand from the repo root:

    python scripts/refresh_disposable_domains.py            # writes
    python scripts/refresh_disposable_domains.py --dry-run  # counts only

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
"""
import json
import os
import sys
import urllib.request

LIST_URL = (
    "https://raw.githubusercontent.com/disposable-email-domains/"
    "disposable-email-domains/main/disposable_email_blocklist.conf"
)
# Never block these, whatever the upstream list says.
NEVER_BLOCK = {
    "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com",
    "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "oddsbanta.com",
}
BATCH = 1000


def fetch_domains() -> list[str]:
    with urllib.request.urlopen(LIST_URL, timeout=60) as resp:
        text = resp.read().decode("utf-8")
    domains = set()
    for line in text.splitlines():
        d = line.strip().lower()
        if d and not d.startswith("#") and "." in d and d not in NEVER_BLOCK:
            domains.add(d)
    return sorted(domains)


def upsert(url: str, key: str, rows: list[dict]) -> None:
    req = urllib.request.Request(
        f"{url}/rest/v1/disposable_email_domains?on_conflict=domain",
        data=json.dumps(rows).encode("utf-8"),
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        if resp.status >= 300:
            raise RuntimeError(f"upsert failed: HTTP {resp.status}")


def main() -> int:
    dry = "--dry-run" in sys.argv
    domains = fetch_domains()
    if len(domains) < 1000:
        print(f"Upstream list looks wrong ({len(domains)} domains); not writing.")
        return 1
    print(f"Upstream list: {len(domains)} domains")
    if dry:
        return 0
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    for i in range(0, len(domains), BATCH):
        upsert(url, key, [{"domain": d, "source": "disposable-email-domains"} for d in domains[i:i + BATCH]])
    print("Done: new domains added, existing ones kept.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
