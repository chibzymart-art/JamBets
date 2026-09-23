"""
Oddsbanta — Isolated Basketball Database Client & Persistence Gateway
Phase 1: Autonomous Basketball Storage Layer

Invariant: Strictly manages basketball_* tables. Zero interactions with football/tennis data.
"""

import os
import httpx
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()


class BasketballDbClient:
    """
    Dedicated Supabase REST persistence gateway for the Autonomous Basketball Engine.
    Operates strictly within public.basketball_* database namespace.
    """

    def __init__(self, url: Optional[str] = None, service_key: Optional[str] = None):
        self.url = url or os.getenv("SUPABASE_URL")
        self.key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in environment.")

        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        }
        self.client = httpx.Client(
            base_url=f"{self.url}/rest/v1",
            headers=self.headers,
            timeout=25.0
        )

    # ------------------------------------------------------------------
    # Leagues
    # ------------------------------------------------------------------
    def get_leagues(self, active_only: bool = True) -> List[Dict[str, Any]]:
        params = {"is_active": "eq.true"} if active_only else {}
        resp = self.client.get("/basketball_leagues", params=params)
        resp.raise_for_status()
        return resp.json()

    def upsert_league(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/basketball_leagues", json=data, headers=headers, params={"on_conflict": "code"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    # ------------------------------------------------------------------
    # Teams
    # ------------------------------------------------------------------
    def get_team_by_canonical(self, canonical_name: str) -> Optional[Dict[str, Any]]:
        resp = self.client.get("/basketball_teams", params={"canonical_name": f"eq.{canonical_name}"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else None

    def get_teams_by_league(self, league_id: str) -> List[Dict[str, Any]]:
        resp = self.client.get("/basketball_teams", params={"league_id": f"eq.{league_id}"})
        resp.raise_for_status()
        return resp.json()

    def upsert_team(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/basketball_teams", json=data, headers=headers, params={"on_conflict": "canonical_name"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    # ------------------------------------------------------------------
    # Players
    # ------------------------------------------------------------------
    def get_players_by_team(self, team_id: str) -> List[Dict[str, Any]]:
        resp = self.client.get("/basketball_players", params={"team_id": f"eq.{team_id}"})
        resp.raise_for_status()
        return resp.json()

    def upsert_player(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/basketball_players", json=data, headers=headers, params={"on_conflict": "team_id,canonical_name"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    # ------------------------------------------------------------------
    # Fixtures
    # ------------------------------------------------------------------
    def get_upcoming_fixtures(self, start_iso: str, end_iso: str) -> List[Dict[str, Any]]:
        params = {
            "and": f"(target_kickoff_at.gte.{start_iso},target_kickoff_at.lte.{end_iso})",
            "status": "eq.scheduled",
            "select": "*,league:basketball_leagues(*),home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(*),away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(*)",
            "order": "target_kickoff_at.asc"
        }
        resp = self.client.get("/basketball_fixtures", params=params)
        resp.raise_for_status()
        return resp.json()

    def get_fixture_by_canonical(self, canonical_key: str) -> Optional[Dict[str, Any]]:
        params = {
            "canonical_key": f"eq.{canonical_key}",
            "select": "*,league:basketball_leagues(*),home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(*),away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(*)"
        }
        resp = self.client.get("/basketball_fixtures", params=params)
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else None

    def upsert_fixture(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/basketball_fixtures", json=data, headers=headers, params={"on_conflict": "canonical_key"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    def update_fixture_score(self, fixture_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        resp = self.client.patch("/basketball_fixtures", json=updates, params={"id": f"eq.{fixture_id}"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    # ------------------------------------------------------------------
    # Predictions
    # ------------------------------------------------------------------
    def get_predictions_feed(self, limit: int = 500) -> List[Dict[str, Any]]:
        params = {
            "publication_status": "eq.published",
            "select": "*,fixture:basketball_fixtures(*,league:basketball_leagues(*),home_team:basketball_teams!basketball_fixtures_home_team_id_fkey(*),away_team:basketball_teams!basketball_fixtures_away_team_id_fkey(*))",
            "order": "target_kickoff_at.asc",
            "limit": str(limit)
        }
        resp = self.client.get("/basketball_predictions", params=params)
        resp.raise_for_status()
        return resp.json()

    def save_prediction(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/basketball_predictions", json=data, headers=headers, params={"on_conflict": "fixture_id"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    # ------------------------------------------------------------------
    # Settlements
    # ------------------------------------------------------------------
    def settle_prediction(
        self,
        prediction_id: str,
        fixture_id: str,
        status: str,
        notes: str,
        final_home_score: int,
        final_away_score: int,
        was_overtime: bool = False,
        actual_result: Optional[str] = None
    ) -> Dict[str, Any]:
        now_iso = datetime.now(timezone.utc).isoformat()
        score_margin = final_home_score - final_away_score
        total_points = final_home_score + final_away_score

        # 1. Update basketball_predictions table
        pred_update = {
            "settlement_status": status,
            "settlement_notes": notes,
            "settled_at": now_iso
        }
        if actual_result:
            pred_update["actual_result"] = actual_result
        self.client.patch("/basketball_predictions", json=pred_update, params={"id": f"eq.{prediction_id}"})

        # 2. Audit record in basketball_settlements table
        settlement_entry = {
            "prediction_id": prediction_id,
            "fixture_id": fixture_id,
            "status": status,
            "final_home_score": final_home_score,
            "final_away_score": final_away_score,
            "score_margin": score_margin,
            "total_points": total_points,
            "was_overtime": was_overtime,
            "settlement_logic_version": "1.0",
            "notes": notes,
            "settled_at": now_iso
        }
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/basketball_settlements", json=settlement_entry, headers=headers, params={"on_conflict": "prediction_id"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    def close(self):
        self.client.close()
