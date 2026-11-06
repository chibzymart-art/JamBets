#!/usr/bin/env python3
"""
Oddsbanta — set the Telegram bot's command menu (setMyCommands).

The menu is read from BOT_MENU in api/_lib/telegram-pages.ts, the same list the bot
shows in /start and /help, so the menu always matches the commands the bot answers.
Needs TELEGRAM_BOT_TOKEN in the environment or .env. Prints no secrets.
"""

import json
import os
import re
import sys
import urllib.request
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent

env_vars = {}
env_path = root_dir / ".env"
if env_path.exists():
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip()

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN") or env_vars.get("TELEGRAM_BOT_TOKEN")
if not BOT_TOKEN:
    print("[-] Error: TELEGRAM_BOT_TOKEN is not set in .env or environment.")
    sys.exit(1)

source = (root_dir / "api" / "_lib" / "telegram-pages.ts").read_text(encoding="utf-8")
block = re.search(r"export const BOT_MENU[^=]*=\s*\[(.*?)\n\];", source, re.S)
if not block:
    print("[-] Error: BOT_MENU not found in api/_lib/telegram-pages.ts")
    sys.exit(1)

commands = []
for m in re.finditer(r"\{\s*command:\s*'([a-z0-9_]+)',\s*description:\s*(['\"])(.*?)\2\s*\}", block.group(1)):
    commands.append({"command": m.group(1), "description": m.group(3)})
if not commands:
    print("[-] Error: no commands parsed from BOT_MENU")
    sys.exit(1)


def call(method, payload):
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))


print(f"Setting {len(commands)} menu commands:")
for c in commands:
    print(f"  /{c['command']} - {c['description']}")

res = call("setMyCommands", {"commands": commands})
print("setMyCommands:", "ok" if res.get("ok") else res)

check = call("getMyCommands", {})
live = [c["command"] for c in check.get("result", [])]
if live == [c["command"] for c in commands]:
    print("[SUCCESS] Telegram menu matches BOT_MENU.")
else:
    print(f"[WARNING] Telegram menu is {live}")
    sys.exit(1)
