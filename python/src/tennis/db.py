"""
Oddsbanta — Isolated Tennis Database Client & Persistence Gateway
Phase 1: Autonomous Tennis Storage Layer

Invariant: Strictly manages tennis_* tables. Zero interactions with football data.
"""

import os
import httpx
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()


class TennisDbClient:
    """
    Dedicated Supabase REST persistence gateway for the Autonomous Tennis Engine.
    Operates strictly within public.tennis_* database namespace.
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
    # Tournaments
    # ------------------------------------------------------------------
    def get_tournaments(self, active_only: bool = True) -> List[Dict[str, Any]]:
        params = {"is_active": "eq.true"} if active_only else {}
        resp = self.client.get("/tennis_tournaments", params=params)
        resp.raise_for_status()
        return resp.json()

    def upsert_tournament(self, data: Dict[str, Any]) -> Dict[str, Any]:
        resp = self.client.post("/tennis_tournaments", json=data)
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    # ------------------------------------------------------------------
    # Players
    # ------------------------------------------------------------------
    def get_player_by_canonical(self, canonical_name: str) -> Optional[Dict[str, Any]]:
        resp = self.client.get("/tennis_players", params={"canonical_name": f"eq.{canonical_name}"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else None

    def upsert_player(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/tennis_players", json=data, headers=headers, params={"on_conflict": "canonical_name"})
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
            "select": "*,tournament:tennis_tournaments(*),player1:tennis_players!tennis_fixtures_player1_id_fkey(*),player2:tennis_players!tennis_fixtures_player2_id_fkey(*)",
            "order": "target_kickoff_at.asc"
        }
        resp = self.client.get("/tennis_fixtures", params=params)
        resp.raise_for_status()
        return resp.json()

    def upsert_fixture(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/tennis_fixtures", json=data, headers=headers, params={"on_conflict": "canonical_key"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    def update_fixture_score(self, fixture_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        resp = self.client.patch("/tennis_fixtures", json=updates, params={"id": f"eq.{fixture_id}"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    # ------------------------------------------------------------------
    # Predictions
    # ------------------------------------------------------------------
    def get_predictions_feed(self, limit: int = 500) -> List[Dict[str, Any]]:
        params = {
            "publication_status": "eq.published",
            "select": "*,fixture:tennis_fixtures(*,tournament:tennis_tournaments(*),player1:tennis_players!tennis_fixtures_player1_id_fkey(*),player2:tennis_players!tennis_fixtures_player2_id_fkey(*))",
            "order": "target_kickoff_at.asc",
            "limit": str(limit)
        }
        resp = self.client.get("/tennis_predictions", params=params)
        resp.raise_for_status()
        return resp.json()

    def save_prediction(self, data: Dict[str, Any]) -> Dict[str, Any]:
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/tennis_predictions", json=data, headers=headers, params={"on_conflict": "fixture_id"})
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
        p1_sets: int,
        p2_sets: int,
        total_games: int,
        was_retired: bool = False,
        was_walkover: bool = False,
        actual_result: Optional[str] = None
    ) -> Dict[str, Any]:
        now_iso = datetime.now(timezone.utc).isoformat()

        # 1. Update tennis_predictions table
        pred_update = {
            "settlement_status": status,
            "settlement_notes": notes,
            "settled_at": now_iso
        }
        if actual_result:
            pred_update["actual_result"] = actual_result
        self.client.patch("/tennis_predictions", json=pred_update, params={"id": f"eq.{prediction_id}"})

        # 2. Audit record in tennis_settlements table
        settlement_entry = {
            "prediction_id": prediction_id,
            "fixture_id": fixture_id,
            "status": status,
            "p1_sets": p1_sets,
            "p2_sets": p2_sets,
            "total_games": total_games,
            "was_retired": was_retired,
            "was_walkover": was_walkover,
            "settlement_logic_version": "1.0",
            "notes": notes,
            "settled_at": now_iso
        }
        headers = dict(self.headers)
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
        resp = self.client.post("/tennis_settlements", json=settlement_entry, headers=headers, params={"on_conflict": "prediction_id"})
        resp.raise_for_status()
        res = resp.json()
        return res[0] if res else {}

    def close(self):
        self.client.close()
