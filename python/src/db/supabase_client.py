"""
JamBets — Cloud Supabase Data Access Client
Authoritative persistence client for storing verified football feeds,
canonical fixtures, provenance records, and conflict audits.
"""

import os
import httpx
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv

load_dotenv()

class SupabaseClient:
    def __init__(self, url: Optional[str] = None, service_key: Optional[str] = None):
        self.url = url or os.getenv("SUPABASE_URL")
        self.key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        if not self.url or not self.key:
            raise ValueError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured")

        self.headers = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates"
        }
        self.client = httpx.Client(base_url=f"{self.url}/rest/v1", headers=self.headers, timeout=20.0)

    def get(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        resp = self.client.get(f"/{table}", params=params)
        resp.raise_for_status()
        return resp.json()

    def post(self, table: str, data: Any, on_conflict: Optional[str] = None) -> List[Dict[str, Any]]:
        headers = dict(self.headers)
        if on_conflict:
            headers["Prefer"] = f"return=representation,resolution=merge-duplicates"
        resp = self.client.post(f"/{table}", json=data, headers=headers)
        resp.raise_for_status()
        return resp.json() if resp.text else []

    def patch(self, table: str, data: Dict[str, Any], params: Dict[str, str]) -> List[Dict[str, Any]]:
        resp = self.client.patch(f"/{table}", json=data, params=params)
        resp.raise_for_status()
        return resp.json() if resp.text else []

    def get_source_id_by_slug(self, slug: str) -> Optional[str]:
        """Retrieves data_source UUID by slug."""
        records = self.get("data_sources", {"slug": f"eq.{slug}", "select": "id"})
        if records:
            return records[0]["id"]
        # Try by name if slug fails
        records_name = self.get("data_sources", {"name": f"ilike.{slug}", "select": "id"})
        return records_name[0]["id"] if records_name else None

    def get_league_id_by_code(self, code: str) -> Optional[str]:
        """Retrieves football_league UUID by code."""
        records = self.get("football_leagues", {"code": f"eq.{code}", "select": "id"})
        return records[0]["id"] if records else None

    def upsert_team(self, name: str, short_name: Optional[str] = None) -> str:
        """Finds or creates a team and returns its UUID."""
        existing = self.get("football_teams", {"name": f"eq.{name}", "select": "id"})
        if existing:
            return existing[0]["id"]
        created = self.post("football_teams", {"name": name, "short_name": short_name})
        return created[0]["id"]

    def upsert_fixture(self, fixture_payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Upserts a canonical fixture record using canonical_key for deduplication.
        If canonical_key exists in database, updates the fixture; otherwise inserts.
        """
        canonical_key = fixture_payload.get("canonical_key")
        if canonical_key:
            existing = self.get("football_fixtures", {"canonical_key": f"eq.{canonical_key}", "select": "id"})
            if existing:
                fixture_id = existing[0]["id"]
                # Update existing record
                update_url = f"{self.base_url}/football_fixtures?id=eq.{fixture_id}"
                resp = self.client.patch(update_url, json=fixture_payload, headers={"Prefer": "return=representation"})
                resp.raise_for_status()
                return resp.json()[0]

        return self.post("football_fixtures", fixture_payload)[0]

    def get_prediction_queue(self, queue_day: Optional[int] = None, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Retrieves fixtures currently in the four-day prediction queue.
        Optionally filters by queue_day (0 to 4).
        """
        params: Dict[str, Any] = {
            "select": "*",
            "order": "target_kickoff_at.asc",
            "limit": str(limit)
        }
        if queue_day is not None:
            params["queue_day"] = f"eq.{queue_day}"
        return self.get("football_prediction_queue", params)

    def record_fixture_source(self, fixture_id: str, source_id: str, provider_event_id: str, provider_data: Optional[Dict[str, Any]] = None) -> None:
        """Records source provenance for a fixture."""
        payload = {
            "fixture_id": fixture_id,
            "source_id": source_id,
            "provider_event_id": provider_event_id,
            "fetched_at": datetime.now(timezone.utc).isoformat()
        }
        self.post("football_fixture_sources", payload)

    def log_conflict(self, fixture_id: str, conflict_type: str, source_a_id: str, source_b_id: str, details_a: Dict, details_b: Dict) -> None:
        """Records a multi-source data conflict in the audit table."""
        payload = {
            "fixture_id": fixture_id,
            "conflict_type": conflict_type,
            "source_a_id": source_a_id,
            "source_b_id": source_b_id,
            "source_a_data": details_a,
            "source_b_data": details_b,
            "resolution": "unresolved"
        }
        self.post("football_data_conflicts", payload)
