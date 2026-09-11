"""
JamBets — Cloud Supabase Data Access Client
Authoritative persistence client for storing verified football feeds,
canonical fixtures, provenance records, and conflict audits.
"""

import os
import httpx
from datetime import datetime, timezone, timedelta
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
        self._leagues_cache: Dict[str, str] = {}
        self._teams_cache: Dict[str, str] = {}
        self._sources_cache: Dict[str, str] = {}

    def get(self, table: str, params: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        resp = self.client.get(f"/{table}", params=params)
        resp.raise_for_status()
        return resp.json()

    def post(self, table: str, data: Any, on_conflict: Optional[str] = None) -> List[Dict[str, Any]]:
        headers = dict(self.headers)
        params = None
        if on_conflict:
            headers["Prefer"] = f"return=representation,resolution=merge-duplicates"
            params = {"on_conflict": on_conflict}
        resp = self.client.post(f"/{table}", json=data, headers=headers, params=params)
        resp.raise_for_status()
        return resp.json() if resp.text else []

    def patch(self, table: str, data: Dict[str, Any], params: Dict[str, str]) -> List[Dict[str, Any]]:
        resp = self.client.patch(f"/{table}", json=data, params=params)
        resp.raise_for_status()
        return resp.json() if resp.text else []

    def delete(self, table: str, params: Dict[str, str]) -> List[Dict[str, Any]]:
        resp = self.client.delete(f"/{table}", params=params)
        resp.raise_for_status()
        return resp.json() if resp.text else []

    def get_source_id_by_slug(self, slug: str) -> Optional[str]:
        """Retrieves data_source UUID by slug (cached)."""
        if slug in self._sources_cache:
            return self._sources_cache[slug]
        records = self.get("data_sources", {"slug": f"eq.{slug}", "select": "id"})
        if records:
            sid = records[0]["id"]
            self._sources_cache[slug] = sid
            return sid
        # Try by name if slug fails
        records_name = self.get("data_sources", {"name": f"ilike.{slug}", "select": "id"})
        if records_name:
            sid = records_name[0]["id"]
            self._sources_cache[slug] = sid
            return sid
        return None

    def get_league_id_by_code(self, code: str) -> Optional[str]:
        """Retrieves football_league UUID by code (cached)."""
        if code in self._leagues_cache:
            return self._leagues_cache[code]
        records = self.get("football_leagues", {"code": f"eq.{code}", "select": "id"})
        if records:
            self._leagues_cache[code] = records[0]["id"]
            return records[0]["id"]
        return None

    def upsert_team(self, name: str, short_name: Optional[str] = None) -> str:
        """Finds or creates a team and returns its UUID (cached)."""
        if name in self._teams_cache:
            return self._teams_cache[name]
        existing = self.get("football_teams", {"name": f"eq.{name}", "select": "id"})
        if existing:
            self._teams_cache[name] = existing[0]["id"]
            return existing[0]["id"]
        created = self.post("football_teams", {"name": name, "short_name": short_name})
        team_id = created[0]["id"]
        self._teams_cache[name] = team_id
        return team_id

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
                resp = self.patch("football_fixtures", fixture_payload, {"id": f"eq.{fixture_id}"})
                return resp[0] if resp else existing[0]

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

    def get_forward_prediction_queue(
        self,
        ref_time_utc: Optional[datetime] = None,
        max_days: int = 4,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Retrieves fixtures strictly forward-looking from ref_time_utc:
        target_kickoff_at > ref_time_utc AND target_kickoff_at <= ref_time_utc + max_days.
        Past or live matches are strictly excluded.
        """
        if ref_time_utc is None:
            ref_time_utc = datetime.now(timezone.utc)
        elif ref_time_utc.tzinfo is None:
            ref_time_utc = ref_time_utc.replace(tzinfo=timezone.utc)

        now_iso = ref_time_utc.isoformat()
        # Cover full day of day 4 through 23:59:59 UTC
        max_time_utc = (ref_time_utc + timedelta(days=max_days)).replace(hour=23, minute=59, second=59)

        # Query post-ref_time fixtures from Cloud Supabase
        fetch_limit = min(max(limit * 3, 200), 2000)
        params: Dict[str, Any] = {
            "select": "*",
            "target_kickoff_at": f"gte.{now_iso}",
            "order": "target_kickoff_at.asc",
            "limit": str(fetch_limit)
        }
        try:
            records = self.get("football_prediction_queue", params)
        except Exception:
            records = self.get("football_fixtures", params)

        # Strict Python temporal filter
        filtered = []
        for r in records:
            kickoff_str = r.get("target_kickoff_at")
            if not kickoff_str:
                continue
            try:
                k_utc = datetime.fromisoformat(kickoff_str.replace("Z", "+00:00"))
                if ref_time_utc <= k_utc <= max_time_utc:
                    filtered.append(r)
                    if len(filtered) >= limit:
                        break
            except Exception:
                continue
        return filtered

    def update_fixture_status(self, fixture_id: str, status: str, reason: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Updates the status (e.g. data_unavailable) of a fixture."""
        payload: Dict[str, Any] = {"status": status}
        records = self.patch("football_fixtures", payload, {"id": f"eq.{fixture_id}"})
        if reason:
            try:
                self.record_audit_log(
                    actor_type="prediction_engine",
                    action="fixture_status_updated",
                    resource_type="football_fixtures",
                    resource_id=fixture_id,
                    details={"new_status": status, "reason": reason}
                )
            except Exception:
                pass
        return records[0] if records else None

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


    def get_system_job_by_key(self, idempotency_key: str) -> Optional[Dict[str, Any]]:
        """Retrieves system job record by idempotency key."""
        records = self.get("system_jobs", {"idempotency_key": f"eq.{idempotency_key}"})
        return records[0] if records else None

    def create_system_job(self, job_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Creates a new system job record."""
        res = self.post("system_jobs", job_payload)
        return res[0] if res else {}

    def update_system_job(self, job_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Updates an existing system job record."""
        records = self.patch("system_jobs", updates, {"id": f"eq.{job_id}"})
        return records[0] if records else None

    def record_audit_log(
        self,
        actor_type: str,
        action: str,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        actor_id: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Appends an immutable audit log entry."""
        payload = {
            "actor_type": actor_type,
            "actor_id": actor_id or "prediction_scheduler_wat",
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details or {}
        }
        res = self.post("audit_logs", payload)
        return res[0] if res else None

    def has_unresolved_conflict(self, fixture_id: str) -> bool:
        """Checks whether a fixture has any unresolved data conflicts."""
        conflicts = self.get("football_data_conflicts", {
            "fixture_id": f"eq.{fixture_id}",
            "resolution": "eq.unresolved",
            "limit": "1"
        })
        return len(conflicts) > 0

    def get_existing_predictions(self, fixture_id: str) -> List[Dict[str, Any]]:
        """Retrieves existing published predictions for a fixture."""
        return self.get("football_predictions", {
            "fixture_id": f"eq.{fixture_id}",
            "publication_status": "eq.published"
        })

    def get_unsettled_predictions(self, fixture_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves published predictions that are pending settlement."""
        params = {
            "publication_status": "eq.published",
            "settlement_status": "eq.pending",
            "order": "target_kickoff_at.asc"
        }
        if fixture_id:
            params["fixture_id"] = f"eq.{fixture_id}"
        return self.get("football_predictions", params)

    def get_active_fixtures_for_monitoring(self, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Retrieves fixtures that need live monitoring or settlement:
        Matches that are in prediction queue or recently kicked off / live / finished.
        """
        params = {
            "order": "target_kickoff_at.asc",
            "limit": str(limit)
        }
        try:
            return self.get("football_prediction_queue", params)
        except Exception:
            return self.get("football_fixtures", params)

    def update_fixture_live_state(self, fixture_id: str, state_dict: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Updates live score, minute, period, and status for a fixture."""
        records = self.patch("football_fixtures", state_dict, {"id": f"eq.{fixture_id}"})
        return records[0] if records else None

    def record_live_events(self, events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Appends verified live match events to football_live_events."""
        if not events:
            return []
        return self.post("football_live_events", events)

    def record_football_result(self, result_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Upserts a verified final result record into football_results."""
        res = self.post("football_results", result_payload, on_conflict="fixture_id")
        return res[0] if res else {}

    def upsert_settlement(self, settlement_dict: Dict[str, Any]) -> Dict[str, Any]:
        """
        Persists an immutable settlement record in football_settlements
        and mirrors settlement_status to football_predictions for client indexing.
        """
        res = self.post("football_settlements", settlement_dict, on_conflict="prediction_id")

        # Update mirrored fields on football_predictions
        pred_id = settlement_dict.get("prediction_id")
        if pred_id:
            status_val = settlement_dict.get("status", "pending")
            # Normalize 'voided' to 'void' if needed
            if status_val == "voided":
                status_val = "void"

            self.patch("football_predictions", {
                "settlement_status": status_val,
                "settled_at": settlement_dict.get("settlement_timestamp") or datetime.now(timezone.utc).isoformat(),
                "settlement_notes": settlement_dict.get("notes"),
                "actual_score": settlement_dict.get("actual_score")
            }, {"id": f"eq.{pred_id}"})

        return res[0] if res else {}

    def get_settlements_by_fixture(self, fixture_id: str) -> List[Dict[str, Any]]:
        """Retrieves settlement records for predictions associated with a fixture."""
        preds = self.get("football_predictions", {"fixture_id": f"eq.{fixture_id}", "select": "id"})
        if not preds:
            return []
        pred_ids = [p["id"] for p in preds]
        # In PostgREST in syntax: id=in.(id1,id2)
        id_list = ",".join(pred_ids)
        return self.get("football_settlements", {"prediction_id": f"in.({id_list})"})

    def get_pending_admin_tasks(self) -> List[Dict[str, Any]]:
        """Retrieves pending admin override tasks ordered by creation time."""
        params = {
            "status": "eq.PENDING",
            "order": "created_at.asc",
            "limit": "10"
        }
        try:
            return self.get("admin_tasks", params)
        except Exception as exc:
            print(f"[WARN] Error querying admin_tasks: {exc}")
            return []

    def update_admin_task(
        self,
        task_id: str,
        status: str,
        metadata: Optional[Dict[str, Any]] = None,
        error_message: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Updates status, metadata, and error message of an admin task."""
        payload: Dict[str, Any] = {
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        if metadata is not None:
            payload["metadata"] = metadata
        if error_message is not None:
            payload["error_message"] = error_message

        records = self.patch("admin_tasks", payload, {"id": f"eq.{task_id}"})
        return records[0] if records else None

    def create_admin_task(
        self,
        task_name: str,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Creates a new admin task with PENDING status."""
        payload = {
            "task_name": task_name,
            "status": "PENDING",
            "metadata": metadata or {},
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        res = self.post("admin_tasks", payload)
        return res[0] if res else {}


# Alias for explicit domain naming
CloudSupabaseClient = SupabaseClient


