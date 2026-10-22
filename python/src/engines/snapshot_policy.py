"""
Who refreshes the feed snapshots (public.cached_feeds) after an engine run.

Every GitHub Actions workflow has a dedicated "Refresh ... Feed Snapshot Cache" step that runs after
the engine step, even if the engine step failed (if: !cancelled()). The engine scripts also refreshed
the same snapshots themselves, so each run built them twice. The workflows now set
SNAPSHOTS_BUILT_BY_WORKFLOW=1 on their engine steps, and the scripts then leave the refresh to that
step. Run by hand (no variable set), the scripts refresh the snapshots exactly as before.

This only affects the snapshot copies used by the website. Prediction and settlement writes are not
touched by it.
"""

import os

ENV_FLAG = "SNAPSHOTS_BUILT_BY_WORKFLOW"


def inline_snapshot_refresh_enabled() -> bool:
    """True unless the calling workflow builds the snapshots in its own step."""
    return os.environ.get(ENV_FLAG, "").strip() != "1"


def skipped_message() -> str:
    return (
        f"[INFO] Feed snapshot refresh skipped here: this workflow refreshes them in its own snapshot "
        f"step ({ENV_FLAG}=1)."
    )
