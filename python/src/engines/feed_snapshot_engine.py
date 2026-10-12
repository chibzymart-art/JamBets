"""
Oddsbanta — Feed Snapshot Pre-computation Engine (Phase 2)
Pre-computes fully hydrated JSON snapshots for all major public feeds
into public.cached_feeds, eliminating multi-table joins on Edge cold starts.
"""

import os
import sys
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
import httpx
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("feed_snapshot_engine")


def get_lagos_date_str(dt: Optional[datetime] = None) -> str:
    """Returns YYYY-MM-DD string in Africa/Lagos timezone (UTC+1)."""
    lagos_tz = timezone(timedelta(hours=1))
    target = dt.astimezone(lagos_tz) if dt else datetime.now(lagos_tz)
    return target.strftime("%Y-%m-%d")


def parse_iso_to_lagos_date(iso_str: Optional[str]) -> str:
    if not iso_str:
        return ""
    try:
        clean = iso_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(clean)
        return get_lagos_date_str(dt)
    except Exception:
        return iso_str[:10] if len(iso_str) >= 10 else ""


class FeedSnapshotEngine:
    def __init__(self, url: Optional[str] = None, service_key: Optional[str] = None):
        self.url = url or os.getenv("SUPABASE_URL")
        self.key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured")

        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates"
        }
        self.client = httpx.Client(base_url=f"{self.url}/rest/v1", headers=self.headers, timeout=30.0)

    def write_snapshot(self, key: str, payload: Dict[str, Any]) -> bool:
        """Upserts a snapshot into public.cached_feeds on conflict 'key'."""
        now_iso = datetime.now(timezone.utc).isoformat()
        row = {
            "key": key,
            "payload": payload,
            "updated_at": now_iso
        }
        try:
            resp = self.client.post(
                "/cached_feeds",
                json=row,
                headers={"Prefer": "return=representation,resolution=merge-duplicates"},
                params={"on_conflict": "key"}
            )
            resp.raise_for_status()
            logger.info(f"Successfully cached snapshot for '{key}' ({len(json.dumps(payload))} bytes)")
            return True
        except Exception as e:
            logger.error(f"Failed to cache snapshot for '{key}': {e}")
            return False

    # -------------------------------------------------------------------------
    # 1. FOOTBALL TODAY SNAPSHOT (feed:football:today)
    # -------------------------------------------------------------------------
    def build_football_today_snapshot(self) -> Dict[str, Any]:
        """Pre-computes feed:football:today for predictions-feed.ts."""
        logger.info("Building football:today snapshot...")
        now = datetime.now(timezone.utc)
        yesterday_utc = datetime(now.year, now.month, now.day, 0, 0, 0, tzinfo=timezone.utc) - timedelta(days=1)
        min_date = yesterday_utc.isoformat()
        max_date = (now + timedelta(days=5)).isoformat()

        select_query = (
            "id,fixture_id,prediction,market,probability,confidence_category,secondary_predictions,"
            "metadata,settlement_status,settlement_notes,settled_at,actual_score,publication_status,"
            "simulations_count,target_kickoff_at,tier_required,"
            "fixture:football_fixtures!inner("
            "id,canonical_key,target_kickoff_at,status,home_score,away_score,match_minute,period,"
            "half_time_home_score,half_time_away_score,corners_home,corners_away,postponed_at,cancelled_at,venue,"
            "league:football_leagues!inner(id,name,code,country),"
            "home_team:football_teams!football_fixtures_home_team_id_fkey(id,name),"
            "away_team:football_teams!football_fixtures_away_team_id_fkey(id,name)"
            ")"
        )

        preds_resp = self.client.get(
            "/football_predictions",
            params={
                "select": select_query,
                "publication_status": "eq.published",
                "target_kickoff_at": f"gte.{min_date}",
                "and": f"(target_kickoff_at.lte.{max_date})",
                "order": "target_kickoff_at.asc,id.asc",
                "limit": "1000"
            }
        )
        preds_resp.raise_for_status()
        raw_predictions = preds_resp.json()

        leagues_resp = self.client.get(
            "/football_leagues",
            params={
                "select": "id,name,code,country",
                "order": "name.asc"
            }
        )
        leagues_resp.raise_for_status()
        leagues = leagues_resp.json()

        # Prune predictions exactly matching api/predictions-feed.ts prunePrediction
        pruned_predictions = []
        for p in (raw_predictions or []):
            meta = p.get("metadata") or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}

            pruned_meta = {}
            for field in [
                "ai_summary", "poisson_parameters", "simulation_outlines",
                "lambda_home", "lambda_away", "home_attack", "away_attack",
                "home_defense", "has_change", "previous_prediction",
                "change_reason", "change_detected_at"
            ]:
                if field in meta and meta[field] is not None:
                    pruned_meta[field] = meta[field]

            fix = p.get("fixture") or {}
            pruned_fix = {
                "id": fix.get("id"),
                "canonical_key": fix.get("canonical_key") or fix.get("id"),
                "status": fix.get("status"),
                "target_kickoff_at": fix.get("target_kickoff_at"),
                "home_score": fix.get("home_score"),
                "away_score": fix.get("away_score"),
                "match_minute": fix.get("match_minute"),
                "period": fix.get("period"),
                "half_time_home_score": fix.get("half_time_home_score"),
                "half_time_away_score": fix.get("half_time_away_score"),
                "corners_home": fix.get("corners_home"),
                "corners_away": fix.get("corners_away"),
                "venue": fix.get("venue"),
                "league": fix.get("league"),
                "home_team": fix.get("home_team"),
                "away_team": fix.get("away_team"),
            }
            if fix.get("cancelled_at"):
                pruned_fix["cancelled_at"] = fix["cancelled_at"]
            if fix.get("postponed_at"):
                pruned_fix["postponed_at"] = fix["postponed_at"]

            pruned_predictions.append({
                "id": p.get("id"),
                "fixture_id": p.get("fixture_id"),
                "prediction": p.get("prediction"),
                "market": p.get("market"),
                "probability": p.get("probability"),
                "confidence_category": p.get("confidence_category"),
                "publication_status": p.get("publication_status") or "published",
                "secondary_predictions": p.get("secondary_predictions") or [],
                "simulations_count": p.get("simulations_count") or 250000,
                "tier_required": p.get("tier_required") or "free",
                "settlement_status": p.get("settlement_status"),
                "settlement_notes": p.get("settlement_notes"),
                "settled_at": p.get("settled_at"),
                "actual_score": p.get("actual_score"),
                "target_kickoff_at": p.get("target_kickoff_at"),
                "is_locked": False,
                "metadata": pruned_meta,
                "fixture": pruned_fix,
            })

        return {
            "predictions": pruned_predictions,
            "leagues": leagues,
            "cached_at": datetime.now(timezone.utc).isoformat()
        }

    # -------------------------------------------------------------------------
    # 2. GOALS SNAPSHOT (feed:goals)
    # -------------------------------------------------------------------------
    def build_goals_snapshot(self) -> Dict[str, Any]:
        """Pre-computes feed:goals for goals-feed.ts and market-feed.ts."""
        logger.info("Building goals snapshot...")
        select_query = (
            "id,fixture_id,market,predicted_outcome,probability,confidence_tier,xg_combined,"
            "home_over25_rate,away_over25_rate,h2h_over25_rate,ht_goal_frequency,avg_first_goal_minute,"
            "target_kickoff_at,settlement_status,settled_at,actual_score,ht_score,settlement_notes,"
            "metadata,is_locked,"
            "fixture:football_fixtures!inner("
            "id,canonical_key,target_kickoff_at,status,queue_day,in_prediction_queue,home_score,away_score,"
            "match_minute,period,half_time_home_score,half_time_away_score,corners_home,corners_away,"
            "postponed_at,cancelled_at,venue,metadata,"
            "league:football_leagues!inner(id,name,code,country),"
            "home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),"
            "away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name)"
            ")"
        )

        resp = self.client.get(
            "/goals_predictions_paywall",
            params={
                "select": select_query,
                "order": "probability.desc",
                "limit": "1000"
            }
        )
        resp.raise_for_status()
        goals_predictions = resp.json()

        leagues_resp = self.client.get(
            "/football_leagues",
            params={"select": "id,name,code,country", "order": "name.asc"}
        )
        leagues_resp.raise_for_status()
        leagues = leagues_resp.json()

        return {
            "predictions": goals_predictions or [],
            "leagues": leagues or [],
            "cached_at": datetime.now(timezone.utc).isoformat()
        }

    # -------------------------------------------------------------------------
    # 3. CORNERS SNAPSHOT (feed:corners)
    # -------------------------------------------------------------------------
    def build_corners_snapshot(self) -> Dict[str, Any]:
        """Pre-computes feed:corners for market-feed.ts."""
        logger.info("Building corners snapshot...")
        select_query = (
            "id,fixture_id,market,predicted_total_corners,probability,corner_tier,target_kickoff_at,"
            "settlement_status,settled_at,actual_corners,settlement_notes,publication_status,"
            "fixture:football_fixtures!inner("
            "id,canonical_key,target_kickoff_at,status,home_score,away_score,match_minute,period,"
            "half_time_home_score,half_time_away_score,corners_home,corners_away,venue,"
            "league:football_leagues!inner(id,name,code,country),"
            "home_team:football_teams!football_fixtures_home_team_id_fkey(id,name,short_name),"
            "away_team:football_teams!football_fixtures_away_team_id_fkey(id,name,short_name)"
            ")"
        )

        resp = self.client.get(
            "/corner_predictions",
            params={
                "select": select_query,
                "settlement_status": "neq.void",
                "publication_status": "neq.archived",
                "order": "probability.desc",
                "limit": "1000"
            }
        )
        resp.raise_for_status()
        raw_corners = resp.json()

        # Filter out cancelled / postponed fixtures
        corners = [
            c for c in (raw_corners or [])
            if (c.get("fixture") or {}).get("status") not in ("cancelled", "postponed")
        ]

        leagues_resp = self.client.get(
            "/football_leagues",
            params={"select": "id,name,code,country", "order": "name.asc"}
        )
        leagues_resp.raise_for_status()
        leagues = leagues_resp.json()

        return {
            "predictions": corners,
            "leagues": leagues or [],
            "cached_at": datetime.now(timezone.utc).isoformat()
        }

    # -------------------------------------------------------------------------
    # 4. MARKET COUNTS SNAPSHOT (feed:market:counts)
    # -------------------------------------------------------------------------
    def build_market_counts_snapshot(self) -> Dict[str, Any]:
        """Pre-computes badge counts for market-feed.ts."""
        logger.info("Building market counts snapshot...")
        # Fetch minimal fields for corners and goals
        cr_resp = self.client.get(
            "/corner_predictions",
            params={
                "select": "id,target_kickoff_at,settlement_status,publication_status,fixture:football_fixtures!inner(id,status)",
                "settlement_status": "neq.void",
                "publication_status": "neq.archived",
                "limit": "1000"
            }
        )
        gl_resp = self.client.get(
            "/goals_predictions",
            params={
                "select": "id,market,target_kickoff_at,settlement_status,publication_status,fixture:football_fixtures!inner(id,status)",
                "settlement_status": "neq.void",
                "publication_status": "neq.archived",
                "limit": "1000"
            }
        )

        cr_list = cr_resp.json() if cr_resp.status_code == 200 else []
        gl_list = gl_resp.json() if gl_resp.status_code == 200 else []

        now_lagos = datetime.now(timezone(timedelta(hours=1)))
        today_str = now_lagos.strftime("%Y-%m-%d")
        tomorrow_str = (now_lagos + timedelta(days=1)).strftime("%Y-%m-%d")
        yesterday_str = (now_lagos - timedelta(days=1)).strftime("%Y-%m-%d")

        def compute_for_date(date_param: str) -> Dict[str, int]:
            target_date = ""
            if date_param == "today":
                target_date = today_str
            elif date_param == "tomorrow":
                target_date = tomorrow_str
            elif date_param == "yesterday":
                target_date = yesterday_str

            def filter_list(items):
                res = []
                for it in items:
                    fix_st = (it.get("fixture") or {}).get("status")
                    if fix_st in ("cancelled", "postponed"):
                        continue
                    d = parse_iso_to_lagos_date(it.get("target_kickoff_at"))
                    if date_param != "all":
                        if d == target_date:
                            res.append(it)
                    else:
                        if not d or d >= today_str:
                            res.append(it)
                return res

            c_filtered = filter_list(cr_list)
            g_filtered = filter_list(gl_list)

            over25_count = sum(1 for g in g_filtered if g.get("market") == "over_2.5_goals")
            ht_count = sum(1 for g in g_filtered if g.get("market") == "ht_over_0.5_goals")
            corners_count = len(c_filtered)

            return {
                "all": len(g_filtered) + len(c_filtered),
                "home_win": 0,
                "away_win": 0,
                "draw": 0,
                "corners": corners_count,
                "goals": len(g_filtered),
                "ht_over_0.5_goals": ht_count,
                "over_2.5_goals": over25_count,
            }

        return {
            "counts_all": compute_for_date("all"),
            "counts_today": compute_for_date("today"),
            "counts_tomorrow": compute_for_date("tomorrow"),
            "counts_yesterday": compute_for_date("yesterday"),
            "cached_at": datetime.now(timezone.utc).isoformat()
        }

    # -------------------------------------------------------------------------
    # 5. BASKETBALL SNAPSHOT (feed:basketball)
    # -------------------------------------------------------------------------
    def build_basketball_snapshot(self) -> Dict[str, Any]:
        """Pre-computes feed:basketball for basketball-feed.ts."""
        logger.info("Building basketball snapshot...")
        now = datetime.now(timezone.utc)
        min_date = (now - timedelta(days=7)).isoformat()

        pred_select = (
            "id,fixture_id,market,prediction,probability,confidence_category,secondary_predictions,"
            "metadata,simulations_count,simulated_home_score,simulated_away_score,edge_percentage,"
            "fair_odds,market_odds,tier_required,publication_status,target_kickoff_at,"
            "settlement_status,settlement_notes,settled_at,actual_result,"
            "fixture:basketball_fixtures("
            "id,canonical_key,target_kickoff_at,status,home_score,away_score,period_scores,"
            "current_period,time_remaining,market_spread,market_total,home_moneyline_odds,"
            "away_moneyline_odds,home_rest_days,away_rest_days,is_home_b2b,is_away_b2b,"
            "league:basketball_leagues(id,code,name,country,quarter_minutes,periods_count,default_pace),"
            "home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(id,canonical_name,short_name,city,state,arena_name,altitude_ft,offensive_rating,defensive_rating,net_rating,pace,four_factors,logo_url),"
            "away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(id,canonical_name,short_name,city,state,arena_name,altitude_ft,offensive_rating,defensive_rating,net_rating,pace,four_factors,logo_url)"
            ")"
        )
        settle_select = "id,prediction_id,fixture_id,status,final_home_score,final_away_score,score_margin,total_points,notes,settled_at"

        preds_resp = self.client.get(
            "/basketball_predictions",
            params={
                "select": pred_select,
                "target_kickoff_at": f"gte.{min_date}",
                "order": "target_kickoff_at.asc",
                "limit": "1000"
            }
        )
        leagues_resp = self.client.get(
            "/basketball_leagues",
            params={
                "select": "id,code,name,country,quarter_minutes,periods_count,default_pace",
                "is_active": "eq.true",
                "order": "name.asc",
                "limit": "100"
            }
        )
        settle_resp = self.client.get(
            "/basketball_settlements",
            params={
                "select": settle_select,
                "order": "settled_at.desc",
                "limit": "100"
            }
        )

        raw_preds = preds_resp.json() if preds_resp.status_code == 200 else []
        leagues = leagues_resp.json() if leagues_resp.status_code == 200 else []
        settlements = settle_resp.json() if settle_resp.status_code == 200 else []

        # Prune and deduplicate
        pruned_predictions = []
        seen_keys = set()
        for p in raw_preds:
            fix = p.get("fixture") or {}
            h_name = ((fix.get("home_team") or {}).get("canonical_name") or "").lower().strip()
            a_name = ((fix.get("away_team") or {}).get("canonical_name") or "").lower().strip()
            dt = (p.get("target_kickoff_at") or fix.get("target_kickoff_at") or "")[:10]
            mkt = (p.get("market") or "").lower()
            k = f"{h_name}_{a_name}_{dt}_{mkt}"
            if k in seen_keys:
                continue
            seen_keys.add(k)

            meta = p.get("metadata") or {}
            if isinstance(meta, str):
                try:
                    meta = json.loads(meta)
                except Exception:
                    meta = {}
            pruned_meta = {}
            if "simulation" in meta:
                pruned_meta["simulation"] = meta["simulation"]
            if "ai_tactical_analysis" in meta:
                pruned_meta["ai_tactical_analysis"] = meta["ai_tactical_analysis"]

            pruned_fix = {
                "id": fix.get("id"),
                "canonical_key": fix.get("canonical_key") or fix.get("id"),
                "status": fix.get("status"),
                "target_kickoff_at": fix.get("target_kickoff_at"),
                "home_score": fix.get("home_score"),
                "away_score": fix.get("away_score"),
                "period_scores": fix.get("period_scores"),
                "current_period": fix.get("current_period"),
                "time_remaining": fix.get("time_remaining"),
                "market_spread": fix.get("market_spread"),
                "market_total": fix.get("market_total"),
                "home_moneyline_odds": fix.get("home_moneyline_odds"),
                "away_moneyline_odds": fix.get("away_moneyline_odds"),
                "home_rest_days": fix.get("home_rest_days"),
                "away_rest_days": fix.get("away_rest_days"),
                "is_home_b2b": fix.get("is_home_b2b"),
                "is_away_b2b": fix.get("is_away_b2b"),
                "league": fix.get("league"),
                "home_team": fix.get("home_team"),
                "away_team": fix.get("away_team"),
            }

            pruned_predictions.append({
                "id": p.get("id"),
                "fixture_id": p.get("fixture_id"),
                "market": p.get("market"),
                "prediction": p.get("prediction"),
                "probability": p.get("probability"),
                "confidence_category": p.get("confidence_category"),
                "secondary_predictions": p.get("secondary_predictions") or [],
                "simulations_count": p.get("simulations_count") or 250000,
                "simulated_home_score": p.get("simulated_home_score"),
                "simulated_away_score": p.get("simulated_away_score"),
                "edge_percentage": p.get("edge_percentage"),
                "fair_odds": p.get("fair_odds"),
                "market_odds": p.get("market_odds"),
                "tier_required": p.get("tier_required") or "vip",
                "publication_status": p.get("publication_status") or "published",
                "target_kickoff_at": p.get("target_kickoff_at"),
                "settlement_status": p.get("settlement_status"),
                "settlement_notes": p.get("settlement_notes"),
                "settled_at": p.get("settled_at"),
                "actual_result": p.get("actual_result"),
                "is_locked": False,
                "metadata": pruned_meta,
                "fixture": pruned_fix,
            })

        # Calculate stats
        bangers = sum(1 for p in pruned_predictions if p.get("confidence_category") == "BANGER")
        top_picks = sum(1 for p in pruned_predictions if p.get("confidence_category") == "TOP PICK")
        high_conf = sum(1 for p in pruned_predictions if p.get("confidence_category") == "HIGH CONFIDENCE")

        settled_won = sum(1 for s in settlements if (s.get("status") or "").lower() == "won")
        settled_lost = sum(1 for s in settlements if (s.get("status") or "").lower() == "lost")
        settled_void = sum(1 for s in settlements if (s.get("status") or "").lower() == "void")
        decisive = settled_won + settled_lost
        win_rate = round((settled_won / decisive) * 100) if decisive > 0 else 0

        stats = {
            "total_matches": len(pruned_predictions),
            "bangers_count": bangers,
            "top_picks_count": top_picks,
            "high_confidence_count": high_conf,
            "leagues_count": len(leagues),
            "settled_count": len(settlements),
            "settled_won": settled_won,
            "settled_lost": settled_lost,
            "settled_void": settled_void,
            "win_rate": win_rate,
        }

        return {
            "predictions": pruned_predictions,
            "leagues": leagues,
            "settlements": settlements,
            "stats": stats,
            "cached_at": datetime.now(timezone.utc).isoformat()
        }

    # -------------------------------------------------------------------------
    # 6. TENNIS SNAPSHOT (feed:tennis)
    # -------------------------------------------------------------------------
    def build_tennis_snapshot(self) -> Dict[str, Any]:
        """Pre-computes feed:tennis for tennis-feed.ts."""
        logger.info("Building tennis snapshot...")
        now = datetime.now(timezone.utc)
        min_date = (now - timedelta(days=7)).isoformat()
        max_date = (now + timedelta(days=5)).isoformat()

        pred_select = (
            "*,fixture:tennis_fixtures("
            "id,canonical_key,round,best_of_sets,target_kickoff_at,status,score_p1_sets,score_p2_sets,"
            "set_scores,current_game_score,server_indicator,"
            "tournament:tennis_tournaments(id,name,tour,category,surface,court_pace_index),"
            "player1:tennis_players!tennis_fixtures_player1_id_fkey(id,display_name,canonical_name,country,current_rank,hard_elo,clay_elo,grass_elo,indoor_elo),"
            "player2:tennis_players!tennis_fixtures_player2_id_fkey(id,display_name,canonical_name,country,current_rank,hard_elo,clay_elo,grass_elo,indoor_elo)"
            ")"
        )
        settle_select = (
            "*,fixture:tennis_fixtures("
            "id,canonical_key,round,status,score_p1_sets,score_p2_sets,set_scores,"
            "tournament:tennis_tournaments(name,tour,surface,court_pace_index),"
            "player1:tennis_players!tennis_fixtures_player1_id_fkey(display_name),"
            "player2:tennis_players!tennis_fixtures_player2_id_fkey(display_name)"
            ")"
        )

        preds_resp = self.client.get(
            "/tennis_predictions",
            params={
                "select": pred_select,
                "target_kickoff_at": f"gte.{min_date}",
                "and": f"(target_kickoff_at.lte.{max_date})",
                "order": "target_kickoff_at.asc",
                "limit": "1000"
            }
        )
        tourneys_resp = self.client.get(
            "/tennis_tournaments",
            params={"select": "*", "order": "name.asc", "limit": "100"}
        )
        settle_resp = self.client.get(
            "/tennis_settlements",
            params={"select": settle_select, "order": "settled_at.desc", "limit": "100"}
        )

        predictions = preds_resp.json() if preds_resp.status_code == 200 else []
        tournaments = tourneys_resp.json() if tourneys_resp.status_code == 200 else []
        settlements = settle_resp.json() if settle_resp.status_code == 200 else []

        for p in predictions:
            if p.get("is_locked") and not p.get("secondary_predictions"):
                p["secondary_predictions"] = [
                    {"market": "game_handicap", "prediction": "🔒 VIP Banker", "probability": None, "locked": True},
                    {"market": "first_set_winner", "prediction": "🔒 VIP Banker", "probability": None, "locked": True},
                    {"market": "set_handicap", "prediction": "🔒 VIP Banker", "probability": None, "locked": True},
                    {"market": "total_games_over_under", "prediction": "🔒 VIP Banker", "probability": None, "locked": True},
                ]

        bangers = sum(1 for p in predictions if p.get("confidence_category") == "BANGER")
        top_picks = sum(1 for p in predictions if p.get("confidence_category") == "TOP PICK")
        high_conf = sum(1 for p in predictions if p.get("confidence_category") == "HIGH CONFIDENCE")

        settled_won = sum(1 for s in settlements if (s.get("status") or "").lower() == "won")
        settled_lost = sum(1 for s in settlements if (s.get("status") or "").lower() == "lost")
        settled_void = sum(1 for s in settlements if (s.get("status") or "").lower() == "void")
        decisive = settled_won + settled_lost
        win_rate = round((settled_won / decisive) * 100) if decisive > 0 else 0

        stats = {
            "total_matches": len(predictions),
            "bangers_count": bangers,
            "top_picks_count": top_picks,
            "high_confidence_count": high_conf,
            "tournaments_count": len(tournaments),
            "settled_count": len(settlements),
            "settled_won": settled_won,
            "settled_lost": settled_lost,
            "settled_void": settled_void,
            "win_rate": win_rate,
        }

        return {
            "predictions": predictions,
            "tournaments": tournaments,
            "settlements": settlements,
            "stats": stats,
            "cached_at": datetime.now(timezone.utc).isoformat()
        }

    # -------------------------------------------------------------------------
    # MASTER SYNC
    # -------------------------------------------------------------------------
    def sync_all_feeds(self) -> Dict[str, bool]:
        """Pre-computes and syncs all 6 snapshots into public.cached_feeds."""
        logger.info("==========================================================")
        logger.info("Oddsbanta — Commencing Master Feed Snapshot Pre-computation")
        logger.info("==========================================================")
        results = {}

        try:
            fb = self.build_football_today_snapshot()
            results["feed:football:today"] = self.write_snapshot("feed:football:today", fb)
        except Exception as e:
            logger.error(f"Error building football:today: {e}")
            results["feed:football:today"] = False

        try:
            gl = self.build_goals_snapshot()
            results["feed:goals"] = self.write_snapshot("feed:goals", gl)
        except Exception as e:
            logger.error(f"Error building goals: {e}")
            results["feed:goals"] = False

        try:
            cr = self.build_corners_snapshot()
            results["feed:corners"] = self.write_snapshot("feed:corners", cr)
        except Exception as e:
            logger.error(f"Error building corners: {e}")
            results["feed:corners"] = False

        try:
            mc = self.build_market_counts_snapshot()
            results["feed:market:counts"] = self.write_snapshot("feed:market:counts", mc)
        except Exception as e:
            logger.error(f"Error building market:counts: {e}")
            results["feed:market:counts"] = False

        try:
            bb = self.build_basketball_snapshot()
            results["feed:basketball"] = self.write_snapshot("feed:basketball", bb)
        except Exception as e:
            logger.error(f"Error building basketball: {e}")
            results["feed:basketball"] = False

        try:
            tn = self.build_tennis_snapshot()
            results["feed:tennis"] = self.write_snapshot("feed:tennis", tn)
        except Exception as e:
            logger.error(f"Error building tennis: {e}")
            results["feed:tennis"] = False

        logger.info(f"Master Feed Snapshot Pre-computation complete: {results}")
        # Automatically trigger Edge Cache Invalidation across Vercel PoPs (Sub-Phase 2.4)
        self.notify_edge_invalidation()
        return results

    def notify_edge_invalidation(self, feeds: Optional[List[str]] = None) -> bool:
        """
        Notifies the Edge Cache Invalidation endpoint to immediately bust SWR caches
        after pre-computing new snapshots in Supabase (Sub-Phase 2.4).
        """
        app_url = os.getenv("ODDSBANTA_API_URL") or os.getenv("VERCEL_URL") or os.getenv("APP_URL") or "https://www.oddsbanta.com"
        if not app_url.startswith("http"):
            app_url = f"https://{app_url}"

        endpoint = f"{app_url}/api/invalidate-cache"
        headers = {
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json"
        }
        payload = {"feeds": feeds} if feeds else {"all": True}
        try:
            with httpx.Client(timeout=5.0, follow_redirects=True) as client:
                resp = client.post(endpoint, json=payload, headers=headers)
                if resp.status_code == 200:
                    logger.info(f"Edge cache successfully invalidated via {endpoint}: {resp.json().get('invalidated')}")
                    return True
                else:
                    logger.warning(f"Edge cache invalidation returned status {resp.status_code}: {resp.text}")
                    return False
        except Exception as e:
            logger.info(f"Edge cache invalidation ping skipped (non-fatal, e.g. local offline environment): {e}")
            return False


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Oddsbanta Feed Snapshot Pre-computation Engine")
    parser.add_argument("--feed", type=str, choices=["football", "goals", "corners", "counts", "basketball", "tennis", "all"], default="all")
    args = parser.parse_args()

    engine = FeedSnapshotEngine()
    if args.feed == "all":
        engine.sync_all_feeds()
    elif args.feed == "football":
        engine.write_snapshot("feed:football:today", engine.build_football_today_snapshot())
    elif args.feed == "goals":
        engine.write_snapshot("feed:goals", engine.build_goals_snapshot())
    elif args.feed == "corners":
        engine.write_snapshot("feed:corners", engine.build_corners_snapshot())
    elif args.feed == "counts":
        engine.write_snapshot("feed:market:counts", engine.build_market_counts_snapshot())
    elif args.feed == "basketball":
        engine.write_snapshot("feed:basketball", engine.build_basketball_snapshot())
    elif args.feed == "tennis":
        engine.write_snapshot("feed:tennis", engine.build_tennis_snapshot())
