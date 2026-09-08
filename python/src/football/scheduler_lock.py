"""
JamBets — Phase 6: Distributed Scheduler Lock & Worker Crash Recovery
Database-backed distributed locking using Cloud Supabase public.system_jobs table.
Guarantees mutual exclusion, prevents concurrent duplicate cycles, and automatically
recovers from worker crashes using active heartbeat timeouts.
"""

import os
import socket
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple, Dict, Any

from python.src.db.supabase_client import CloudSupabaseClient


class DistributedSchedulerLock:
    """
    Database-backed distributed lock with worker attribution and crash recovery.
    """

    LOCK_TIMEOUT_MINUTES = 10  # Stale lock threshold for crash recovery

    def __init__(self, supabase: Optional[CloudSupabaseClient] = None, worker_id: Optional[str] = None):
        self.supabase = supabase or CloudSupabaseClient()
        self.worker_id = worker_id or f"{socket.gethostname()}-{os.getpid()}-{str(uuid.uuid4())[:8]}"

    def acquire(
        self,
        idempotency_key: str,
        timeout_minutes: int = LOCK_TIMEOUT_MINUTES,
        extra_metadata: Optional[Dict[str, Any]] = None
    ) -> Tuple[bool, Optional[str], str]:
        """
        Attempts to acquire the distributed lock for a specific cycle idempotency key.

        Returns:
            (acquired: bool, job_id: Optional[str], status_reason: str)
            status_reason in ('ACQUIRED', 'ALREADY_COMPLETED', 'LOCKED_BY_ACTIVE_WORKER', 'CRASH_RECOVERED_ACQUIRED', 'ERROR')
        """
        now_utc = datetime.now(timezone.utc)
        meta = extra_metadata or {}
        meta["worker_id"] = self.worker_id
        meta["heartbeat_at"] = now_utc.isoformat()
        meta["locked_at"] = now_utc.isoformat()

        try:
            existing = self.supabase.get_system_job_by_key(idempotency_key)

            if existing is None:
                # No job exists for this idempotency key — acquire fresh lock
                payload = {
                    "job_type": "prediction_worker",
                    "status": "running",
                    "started_at": now_utc.isoformat(),
                    "idempotency_key": idempotency_key,
                    "metadata": meta
                }
                created = self.supabase.create_system_job(payload)
                job_id = created.get("id")
                return True, job_id, "ACQUIRED"

            existing_status = existing.get("status")
            job_id = existing.get("id")
            existing_meta = existing.get("metadata") or {}

            # Case 1: Job was already successfully completed
            if existing_status == "completed":
                return False, job_id, "ALREADY_COMPLETED"

            # Case 2: Job is currently marked 'running'
            if existing_status == "running":
                heartbeat_str = existing_meta.get("heartbeat_at")
                is_stale = False

                if heartbeat_str:
                    try:
                        heartbeat_dt = datetime.fromisoformat(heartbeat_str.replace("Z", "+00:00"))
                        if (now_utc - heartbeat_dt) > timedelta(minutes=timeout_minutes):
                            is_stale = True
                    except Exception:
                        is_stale = True
                else:
                    started_str = existing.get("started_at")
                    if started_str:
                        try:
                            started_dt = datetime.fromisoformat(started_str.replace("Z", "+00:00"))
                            if (now_utc - started_dt) > timedelta(minutes=timeout_minutes):
                                is_stale = True
                        except Exception:
                            is_stale = True
                    else:
                        is_stale = True

                if is_stale:
                    # Stale crashed worker detected — break lock and recover
                    merged_meta = dict(existing_meta)
                    merged_meta.update(meta)
                    merged_meta["crash_recovered_at"] = now_utc.isoformat()
                    merged_meta["previous_worker"] = existing_meta.get("worker_id", "unknown")

                    self.supabase.update_system_job(job_id, {
                        "status": "running",
                        "started_at": now_utc.isoformat(),
                        "error_message": "PREVIOUS_WORKER_CRASH_RECOVERED",
                        "metadata": merged_meta
                    })
                    return True, job_id, "CRASH_RECOVERED_ACQUIRED"
                else:
                    # Active worker holds the lock and heartbeat is fresh
                    return False, job_id, "LOCKED_BY_ACTIVE_WORKER"

            # Case 3: Job previously failed or skipped — allow retry
            if existing_status in ("failed", "skipped"):
                merged_meta = dict(existing_meta)
                merged_meta.update(meta)
                merged_meta["retry_started_at"] = now_utc.isoformat()

                self.supabase.update_system_job(job_id, {
                    "status": "running",
                    "started_at": now_utc.isoformat(),
                    "completed_at": None,
                    "error_message": None,
                    "metadata": merged_meta
                })
                return True, job_id, "ACQUIRED"

            return False, job_id, f"UNKNOWN_STATE_{existing_status}"

        except Exception as exc:
            return False, None, f"ERROR: {str(exc)}"

    def heartbeat(self, job_id: str, updates: Optional[Dict[str, Any]] = None) -> bool:
        """
        Refreshes worker heartbeat timestamp to prevent lock expiration.
        """
        now_utc = datetime.now(timezone.utc)
        try:
            records = self.supabase.get("system_jobs", {"id": f"eq.{job_id}", "select": "metadata"})
            if not records:
                return False
            meta = records[0].get("metadata") or {}
            meta["heartbeat_at"] = now_utc.isoformat()
            if updates:
                meta.update(updates)

            self.supabase.update_system_job(job_id, {"metadata": meta})
            return True
        except Exception:
            return False

    def release(
        self,
        job_id: str,
        status: str = "completed",
        items_processed: int = 0,
        items_failed: int = 0,
        error_message: Optional[str] = None,
        final_metadata: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Releases the distributed lock and updates final job status and telemetry.
        """
        now_utc = datetime.now(timezone.utc)
        try:
            records = self.supabase.get("system_jobs", {"id": f"eq.{job_id}", "select": "metadata"})
            meta = records[0].get("metadata") or {} if records else {}
            if final_metadata:
                meta.update(final_metadata)
            meta["released_at"] = now_utc.isoformat()

            update_payload: Dict[str, Any] = {
                "status": status,
                "completed_at": now_utc.isoformat(),
                "items_processed": items_processed,
                "items_failed": items_failed,
                "metadata": meta
            }
            if error_message:
                update_payload["error_message"] = error_message

            self.supabase.update_system_job(job_id, update_payload)
            return True
        except Exception as exc:
            print(f"[ERROR] Failed to release lock for job {job_id}: {exc}")
            return False
