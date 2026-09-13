#!/usr/bin/env python3
"""
Oddsbanta — Telegram VIP Bot Webhook Setup & Registration
Sets up the secure webhook with secret_token (SEC-03).
"""

import os
import sys
import json
import urllib.request
import urllib.parse
from pathlib import Path

# Load .env file
root_dir = Path(__file__).resolve().parent.parent
env_path = root_dir / ".env"

env_vars = {}
if env_path.exists():
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env_vars[k.strip()] = v.strip()

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN") or env_vars.get("TELEGRAM_BOT_TOKEN")
WEBHOOK_SECRET = os.environ.get("TELEGRAM_WEBHOOK_SECRET") or env_vars.get("TELEGRAM_WEBHOOK_SECRET")
WEBHOOK_URL = os.environ.get("TELEGRAM_WEBHOOK_URL") or "https://jambets.vercel.app/api/telegram-webhook"

if not BOT_TOKEN:
    print("[-] Error: TELEGRAM_BOT_TOKEN is not set in .env or environment.")
    sys.exit(1)

if not WEBHOOK_SECRET:
    print("[-] Error: TELEGRAM_WEBHOOK_SECRET is not set in .env or environment.")
    sys.exit(1)

print("=== REGISTERING TELEGRAM WEBHOOK (SEC-03) ===")
print(f"Bot Token: {BOT_TOKEN[:10]}...{BOT_TOKEN[-5:]}")
print(f"Webhook URL: {WEBHOOK_URL}")
print(f"Secret Token: {WEBHOOK_SECRET[:12]}...{WEBHOOK_SECRET[-6:]} (Length: {len(WEBHOOK_SECRET)})")

# 1. Call setWebhook
payload = {
    "url": WEBHOOK_URL,
    "secret_token": WEBHOOK_SECRET,
    "drop_pending_updates": False,
    "allowed_updates": ["message"]
}

req = urllib.request.Request(
    f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook",
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json"},
    method="POST"
)

try:
    with urllib.request.urlopen(req) as resp:
        res_data = json.loads(resp.read().decode("utf-8"))
        print("\n[+] setWebhook Response:")
        print(json.dumps(res_data, indent=2))
except Exception as e:
    print(f"[-] Failed to set webhook: {e}")
    sys.exit(1)

# 2. Call getWebhookInfo to verify
try:
    req_info = urllib.request.Request(f"https://api.telegram.org/bot{BOT_TOKEN}/getWebhookInfo")
    with urllib.request.urlopen(req_info) as resp:
        info_data = json.loads(resp.read().decode("utf-8"))
        print("\n[+] getWebhookInfo Status:")
        print(json.dumps(info_data, indent=2))
        
        res = info_data.get("result", {})
        if res.get("url") == WEBHOOK_URL:
            print("\n[SUCCESS] Webhook successfully configured on Telegram!")
            print(f"   URL: {res.get('url')}")
            print(f"   Pending Updates: {res.get('pending_update_count', 0)}")
            print(f"   Custom Certificate: {res.get('has_custom_certificate', False)}")
        else:
            print(f"\n[WARNING] Webhook URL mismatch: expected {WEBHOOK_URL}, got {res.get('url')}")
except Exception as e:
    print(f"[-] Failed to get webhook info: {e}")

print("\n" + "="*60)
print("REQUIRED VERCEL ENVIRONMENT VARIABLES (Settings > Environment Variables):")
print(f"1. TELEGRAM_BOT_TOKEN = {BOT_TOKEN}")
print(f"2. TELEGRAM_WEBHOOK_SECRET = {WEBHOOK_SECRET}")
print("3. SUPABASE_SERVICE_ROLE_KEY = (Your Supabase service_role JWT)")
print("="*60 + "\n")
