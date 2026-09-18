"""
JamBets — Safe Targeted Wipe & Disqualification Script for Saturday Sep 19 (2026-09-19)
Prepares a pristine, contamination-free state for sequential multi-engine execution:
1. Identifies and marks ineligible fixtures (sub-National League, youth, women's football)
   as status='cancelled' and in_prediction_queue=False.
2. Removes all pending/void prediction records for 2026-09-19 across all 5 prediction tables.
3. Removes orphaned prediction records.
4. STRICT SAFETY: Preserves all settled (won/lost) historical predictions for Sep 18 and earlier.
"""

import sys
import os
from datetime import datetime, timezone
from typing import Dict, List, Set, Any

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../../..')))
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from python.src.db.supabase_client import CloudSupabaseClient
from python.src.football.league_filter import is_fixture_eligible, get_fixture_eligibility


def run_wipe():
    print("==================================================================")
    print(" 🧹 JamBets — Saturday Sep 19 (2026-09-19) Targeted Wipe & Cleanup")
    print(f" Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print("==================================================================\n")

    db = CloudSupabaseClient()
    date_str = "2026-09-19"
    start_iso = f"{date_str}T00:00:00Z"
    end_iso = f"{date_str}T23:59:59Z"

    # 1. Fetch all leagues and teams for metadata lookup
    print("📊 1. Preloading leagues and teams registry...")
    leagues_raw = db.get("football_leagues", {"limit": "1000"}) or []
    leagues = {l["id"]: l for l in leagues_raw}

    # 2. Fetch all fixtures for Sep 19
    print(f"🔍 2. Inspecting football_fixtures for {date_str}...")
    fixtures_raw = db.get("football_fixtures", {
        "target_kickoff_at": f"gte.{start_iso}",
        "select": "id,home_team_id,away_team_id,league_id,target_kickoff_at,status,in_prediction_queue,canonical_key",
        "limit": "2000"
    }) or []
    fixtures_sep19 = [f for f in fixtures_raw if (f.get("target_kickoff_at") or "").startswith(date_str)]
    print(f"   Found {len(fixtures_sep19)} total fixtures scheduled on {date_str}.")

    # Preload team names
    all_team_ids = set()
    for f in fixtures_sep19:
        if f.get("home_team_id"):
            all_team_ids.add(f["home_team_id"])
        if f.get("away_team_id"):
            all_team_ids.add(f["away_team_id"])

    team_name_map = {}
    team_id_list = list(all_team_ids)
    for i in range(0, len(team_id_list), 100):
        chunk = team_id_list[i:i + 100]
        id_str = ",".join(chunk)
        for t in db.get("football_teams", {"id": f"in.({id_str})", "select": "id,name,short_name"}):
            team_name_map[t["id"]] = t.get("short_name") or t.get("name")

    # 3. Categorize fixtures into eligible vs ineligible
    eligible_fixtures = []
    ineligible_fixtures = []

    for f in fixtures_sep19:
        fid = f["id"]
        lid = f.get("league_id")
        l = leagues.get(lid) or {}
        l_code = l.get("code") or ""
        l_name = l.get("name") or ""
        ckey = f.get("canonical_key") or ""
        parts = ckey.split(":") if ":" in ckey else []
        if not l_code and parts:
            l_code = parts[0]

        h_name = team_name_map.get(f.get("home_team_id")) or (parts[1] if len(parts) > 1 else "")
        a_name = team_name_map.get(f.get("away_team_id")) or (parts[2] if len(parts) > 2 else "")

        is_el, reason = get_fixture_eligibility(
            league_code=l_code,
            league_name=l_name,
            home_team=h_name,
            away_team=a_name
        )

        if is_el:
            eligible_fixtures.append(f)
        else:
            ineligible_fixtures.append((f, reason, f"{h_name} vs {a_name} ({l_code})"))

    print(f"   ✅ Eligible pro fixtures for Sep 19: {len(eligible_fixtures)}")
    print(f"   ❌ Ineligible fixtures to disqualify: {len(ineligible_fixtures)}")

    # 4. Disqualify ineligible fixtures in football_fixtures
    print("\n🚫 3. Disqualifying sub-National League, youth, and women's fixtures...")
    disqualified_count = 0
    for fix, reason, desc in ineligible_fixtures:
        fid = fix["id"]
        try:
            db.patch("football_fixtures", {
                "status": "cancelled",
                "in_prediction_queue": False
            }, {
                "id": f"eq.{fid}"
            })
            disqualified_count += 1
        except Exception as e:
            print(f"   ⚠️ Could not patch fixture {fid}: {e}")
    print(f"   Disqualified {disqualified_count} fixtures from active prediction queue.")

    # 5. Targeted delete across all 5 prediction tables for Sep 19
    tables_to_wipe = [
        ("football_predictions", "pending"),
        ("goals_predictions", "pending"),
        ("home_win_predictions", "pending,void"),
        ("draw_predictions", "pending,void"),
        ("corner_predictions", "pending,void")
    ]

    print("\n🧹 4. Wiping Sep 19 pending & void prediction records...")
    for table, status_filter in tables_to_wipe:
        try:
            # Query matching records for Sep 19
            if "," in status_filter:
                filter_cond = f"in.({status_filter})"
            else:
                filter_cond = f"eq.{status_filter}"

            records = db.get(table, {
                "target_kickoff_at": f"gte.{start_iso}",
                "settlement_status": filter_cond,
                "select": "id,fixture_id,target_kickoff_at,settlement_status",
                "limit": "2000"
            }) or []

            # Filter strictly to Sep 19
            target_ids = [r["id"] for r in records if (r.get("target_kickoff_at") or "").startswith(date_str)]

            print(f"   Table '{table}': found {len(target_ids)} records to wipe for {date_str} (status={status_filter}).")
            if target_ids:
                batch_size = 100
                for b in range(0, len(target_ids), batch_size):
                    chunk = target_ids[b:b + batch_size]
                    id_query = f"in.({','.join(chunk)})"
                    db.patch(table, {
                        "publication_status": "archived",
                        "settlement_status": "void",
                        "settlement_notes": "Archived: Wiped for fresh rebuild"
                    }, {"id": id_query})
                print(f"   ✅ Cleaned {len(target_ids)} records from '{table}'.")
        except Exception as err:
            print(f"   ⚠️ Error wiping from '{table}': {err}")

    # 6. Delete orphaned predictions where fixture does not exist
    print("\n🔍 5. Checking for orphaned predictions across all specialist tables...")
    valid_fixture_ids = {f["id"] for f in fixtures_raw}
    for table in ["home_win_predictions", "draw_predictions", "corner_predictions", "goals_predictions"]:
        try:
            preds = db.get(table, {
                "target_kickoff_at": f"gte.{start_iso}",
                "select": "id,fixture_id,target_kickoff_at",
                "limit": "1000"
            }) or []
            orphans = [p["id"] for p in preds if p.get("fixture_id") not in valid_fixture_ids]
            if orphans:
                print(f"   Found {len(orphans)} orphaned records in '{table}'. Archiving...")
                for b in range(0, len(orphans), 100):
                    chunk = orphans[b:b + 100]
                    db.patch(table, {
                        "publication_status": "archived",
                        "settlement_status": "void",
                        "settlement_notes": "Disqualified: Orphaned prediction"
                    }, {"id": f"in.({','.join(chunk)})"})
                print(f"   ✅ Archived {len(orphans)} orphaned rows from '{table}'.")
            else:
                print(f"   Table '{table}': 0 orphaned rows found.")
        except Exception as e:
            print(f"   ⚠️ Orphan check notice on '{table}': {e}")

    print("\n🏁 Targeted Wipe & Cleanup Complete.")
    print("Database is now clean and ready for sequential 5-engine execution!\n")


if __name__ == "__main__":
    run_wipe()
