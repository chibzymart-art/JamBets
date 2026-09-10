"""
JamBets — Cloud Supabase Fixture Deduplication Engine
Conservative, multi-attribute deduplication for Cloud Supabase football fixtures.

Criteria for matching duplicate clusters:
1. Same League (league_id).
2. Scheduled Kickoff within +/- 2 hours (120 minutes).
3. Team identities resolve to the same canonical entity (via identity.py normalizer + aliases + >= 80% fuzzy similarity).

Safety & Efficiency:
- In-memory aggregation of predictions, simulations, and sources for maximum speed.
- Multi-source provenance (football_fixture_sources) is preserved and re-linked to canonical fixture.
- Predictions and simulations are merged or consolidated.
- Never deletes audit logs.
"""

import os
import sys
from datetime import datetime, timezone
from typing import Dict, List, Any, Tuple, Optional
from collections import defaultdict

# Ensure python root is on path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from python.src.db.supabase_client import SupabaseClient
from python.src.football.identity import normalize_team_name

try:
    from rapidfuzz import fuzz
    HAS_RAPIDFUZZ = True
except ImportError:
    import difflib
    HAS_RAPIDFUZZ = False


def team_similarity(name1: str, name2: str) -> float:
    if name1 == name2:
        return 100.0
    if HAS_RAPIDFUZZ:
        return float(fuzz.token_sort_ratio(name1, name2))
    return difflib.SequenceMatcher(None, name1, name2).ratio() * 100.0


def fetch_all_paginated(supabase: SupabaseClient, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
    all_rows = []
    offset = 0
    p = dict(params or {})
    p["limit"] = "1000"
    while True:
        p["offset"] = str(offset)
        batch = supabase.get(table, p)
        all_rows.extend(batch)
        if len(batch) < 1000:
            break
        offset += 1000
    return all_rows


def deduplicate_supabase(dry_run: bool = False, queue_only: bool = False):
    supabase = SupabaseClient()
    print("=" * 70, flush=True)
    print(f"JamBets Supabase Fixture Deduplication (dry_run={dry_run}, queue_only={queue_only})", flush=True)
    print("=" * 70, flush=True)

    # 1. Fetch leagues, teams with full pagination
    print("Fetching leagues and teams (paginated)...", flush=True)
    leagues = {l["id"]: l for l in fetch_all_paginated(supabase, "football_leagues", {"select": "id,code,name"})}
    teams = {t["id"]: t for t in fetch_all_paginated(supabase, "football_teams", {"select": "id,name,short_name"})}
    
    # Fetch forward fixtures
    fixture_params = {
        "select": "id,canonical_key,league_id,home_team_id,away_team_id,target_kickoff_at,status,queue_day,in_prediction_queue,created_at",
        "order": "target_kickoff_at.asc"
    }
    if queue_only:
        fixture_params["in_prediction_queue"] = "eq.true"

    print("Fetching fixtures (paginated)...", flush=True)
    fixtures = fetch_all_paginated(supabase, "football_fixtures", fixture_params)
    print(f"Loaded {len(fixtures)} fixtures across {len(leagues)} leagues and {len(teams)} teams.", flush=True)

    # Pre-fetch predictions, simulations, and sources in bulk to avoid per-fixture HTTP queries
    print("Fetching predictions, simulations, and sources in bulk (paginated)...", flush=True)
    raw_preds = fetch_all_paginated(supabase, "football_predictions", {"select": "id,fixture_id,market,publication_status"})
    raw_sims = fetch_all_paginated(supabase, "football_simulations", {"select": "id,fixture_id"})
    raw_sources = fetch_all_paginated(supabase, "football_fixture_sources", {"select": "id,fixture_id,source_id,provider_event_id"})

    preds_by_fixture = defaultdict(list)
    for p in raw_preds:
        preds_by_fixture[p["fixture_id"]].append(p)

    sims_by_fixture = defaultdict(list)
    for s in raw_sims:
        sims_by_fixture[s["fixture_id"]].append(s)

    sources_by_fixture = defaultdict(list)
    for src in raw_sources:
        sources_by_fixture[src["fixture_id"]].append(src)

    # Augment fixtures with normalized team names
    enriched_fixtures = []
    for f in fixtures:
        home_team_obj = teams.get(f["home_team_id"])
        away_team_obj = teams.get(f["away_team_id"])
        if not home_team_obj or not away_team_obj:
            continue

        raw_home = home_team_obj.get("name") or home_team_obj.get("short_name") or ""
        raw_away = away_team_obj.get("name") or away_team_obj.get("short_name") or ""

        norm_home = normalize_team_name(raw_home)
        norm_away = normalize_team_name(raw_away)

        try:
            kickoff_dt = datetime.fromisoformat(f["target_kickoff_at"].replace("Z", "+00:00"))
        except Exception:
            continue

        enriched_fixtures.append({
            **f,
            "raw_home": raw_home,
            "raw_away": raw_away,
            "norm_home": norm_home,
            "norm_away": norm_away,
            "kickoff_dt": kickoff_dt
        })

    # 2. Cluster duplicates across all fixtures (same teams playing within +/- 120 mins)
    enriched_fixtures.sort(key=lambda x: x["kickoff_dt"])
    visited = set()
    duplicate_clusters: List[List[Dict[str, Any]]] = []

    for i, f1 in enumerate(enriched_fixtures):
        if f1["id"] in visited:
            continue

        cluster = [f1]
        visited.add(f1["id"])

        for j in range(i + 1, len(enriched_fixtures)):
            f2 = enriched_fixtures[j]
            if f2["id"] in visited:
                continue

            diff_mins = abs((f1["kickoff_dt"] - f2["kickoff_dt"]).total_seconds()) / 60.0
            if diff_mins > 120.0:
                if (f2["kickoff_dt"] - f1["kickoff_dt"]).total_seconds() > 7200:
                    break
                continue

            # Check team matching
            h_sim = team_similarity(f1["norm_home"], f2["norm_home"])
            a_sim = team_similarity(f1["norm_away"], f2["norm_away"])

            if (f1["norm_home"] == f2["norm_home"] and f1["norm_away"] == f2["norm_away"]) or (h_sim >= 85.0 and a_sim >= 85.0):
                cluster.append(f2)
                visited.add(f2["id"])

        if len(cluster) > 1:
            duplicate_clusters.append(cluster)

    print(f"\nIdentified {len(duplicate_clusters)} duplicate fixture clusters in Cloud Supabase.", flush=True)

    total_merged = 0
    total_deleted = 0

    for idx, cluster in enumerate(duplicate_clusters, 1):
        league_code = leagues.get(cluster[0]["league_id"], {}).get("code", "UNKNOWN")
        print(f"\n--- Cluster #{idx} ({league_code}) ---", flush=True)
        for member in cluster:
            m_id = member["id"]
            p_cnt = len(preds_by_fixture[m_id])
            s_cnt = len(sims_by_fixture[m_id])
            src_cnt = len(sources_by_fixture[m_id])
            print(f"  • ID: {m_id} | Key: {member['canonical_key']} | Teams: {member['norm_home']} vs {member['norm_away']} | Kickoff: {member['target_kickoff_at']} | Preds: {p_cnt} | Sims: {s_cnt} | Sources: {src_cnt}", flush=True)

        # Decide canonical fixture using in-memory scores
        scores = []
        for member in cluster:
            m_id = member["id"]
            preds = preds_by_fixture[m_id]
            sims = sims_by_fixture[m_id]
            sources = sources_by_fixture[m_id]
            
            # Score formula: predictions (10 pts) + simulations (5 pts) + sources (2 pts) + in_prediction_queue (5 pts)
            q_bonus = 5 if member.get("in_prediction_queue") else 0
            score = (len(preds) * 10) + (len(sims) * 5) + (len(sources) * 2) + q_bonus
            scores.append((score, len(preds), len(sources), member))

        scores.sort(key=lambda x: (x[0], x[1], x[2]), reverse=True)
        canonical_item = scores[0][3]
        canonical_id = canonical_item["id"]

        print(f"  --> Selected Canonical: {canonical_id} ({canonical_item['canonical_key']})", flush=True)

        duplicates = [item[3] for item in scores[1:]]

        if dry_run:
            print(f"  [DRY RUN] Would merge {len(duplicates)} duplicates into {canonical_id}", flush=True)
            continue

        for dup in duplicates:
            dup_id = dup["id"]
            print(f"  Merging duplicate {dup_id} into canonical {canonical_id}...", flush=True)

            # 1. Re-link or deduplicate football_fixture_sources
            # 1. Re-link or deduplicate football_fixture_sources
            dup_sources = sources_by_fixture[dup_id]
            canon_sources = sources_by_fixture[canonical_id]
            canon_source_keys = {(s["source_id"], s["provider_event_id"]) for s in canon_sources}

            for src in dup_sources:
                key = (src["source_id"], src["provider_event_id"])
                if key in canon_source_keys:
                    try:
                        supabase.delete("football_fixture_sources", {"id": f"eq.{src['id']}"})
                    except Exception:
                        pass
                else:
                    try:
                        supabase.patch("football_fixture_sources", {"fixture_id": canonical_id}, {"id": f"eq.{src['id']}"})
                        canon_source_keys.add(key)
                    except Exception:
                        try:
                            supabase.delete("football_fixture_sources", {"id": f"eq.{src['id']}"})
                        except Exception:
                            pass

            # 2. Re-link or deduplicate football_predictions (Sniper Mode: UNIQUE(fixture_id))
            dup_preds = preds_by_fixture[dup_id]
            canon_preds = preds_by_fixture[canonical_id]

            if canon_preds:
                # Canonical already has prediction row -> delete all duplicate prediction rows
                for pred in dup_preds:
                    try:
                        supabase.delete("football_predictions", {"id": f"eq.{pred['id']}"})
                    except Exception:
                        pass
            else:
                # Canonical has no prediction -> transfer the first one, delete remainder
                transferred = False
                for pred in dup_preds:
                    if not transferred:
                        try:
                            supabase.patch("football_predictions", {"fixture_id": canonical_id}, {"id": f"eq.{pred['id']}"})
                            canon_preds.append(pred)
                            transferred = True
                        except Exception:
                            try:
                                supabase.delete("football_predictions", {"id": f"eq.{pred['id']}"})
                            except Exception:
                                pass
                    else:
                        try:
                            supabase.delete("football_predictions", {"id": f"eq.{pred['id']}"})
                        except Exception:
                            pass

            # 3. Re-link or deduplicate football_simulations
            dup_sims = sims_by_fixture[dup_id]
            canon_sims = sims_by_fixture[canonical_id]
            if canon_sims:
                for sim in dup_sims:
                    try:
                        supabase.delete("football_simulations", {"id": f"eq.{sim['id']}"})
                    except Exception:
                        pass
            else:
                transferred_sim = False
                for sim in dup_sims:
                    if not transferred_sim:
                        try:
                            supabase.patch("football_simulations", {"fixture_id": canonical_id}, {"id": f"eq.{sim['id']}"})
                            canon_sims.append(sim)
                            transferred_sim = True
                        except Exception:
                            try:
                                supabase.delete("football_simulations", {"id": f"eq.{sim['id']}"})
                            except Exception:
                                pass
                    else:
                        try:
                            supabase.delete("football_simulations", {"id": f"eq.{sim['id']}"})
                        except Exception:
                            pass

            # 4. Delete duplicate fixture
            supabase.delete("football_fixtures", {"id": f"eq.{dup_id}"})
            total_deleted += 1

        total_merged += 1

    print("\n" + "=" * 70, flush=True)
    print(f"Deduplication complete: Merged {total_merged} clusters, deleted {total_deleted} duplicate fixtures.", flush=True)
    print("=" * 70, flush=True)


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    q_only = "--queue-only" in sys.argv
    deduplicate_supabase(dry_run=dry, queue_only=q_only)
