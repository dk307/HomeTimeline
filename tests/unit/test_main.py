"""Tests for app/main.py — lifespan startup/shutdown hooks and API routes.

main.py has module-level side effects (logging setup, StaticFiles mounts) that run
on first import.  We pop it from sys.modules and re-import under patches so the
lifespan hooks (init_db / start_scheduler / stop_scheduler / close_db) are mocked.
"""

import sys
from unittest.mock import patch


def test_lifespan_calls_init_and_scheduler_hooks(test_db):
    """Startup runs init_db + start_scheduler; shutdown runs stop_scheduler + close_db."""
    # Remove cached module so module-level code re-runs under our patches.
    sys.modules.pop("app.main", None)

    try:
        with (
            patch("app.database.init_db") as mock_init,
            patch("app.database.close_db") as mock_close,
            patch("app.workers.scheduler.start_scheduler") as mock_start,
            patch("app.workers.scheduler.stop_scheduler") as mock_stop,
            # Suppress the FileHandler side effect of logging.basicConfig
            patch("logging.FileHandler"),
        ):
            from fastapi.testclient import TestClient

            import app.main as m  # fresh import; 'from app.database import init_db' gets mock

            with TestClient(m.app) as c:
                r = c.get("/api/v1/health")
                assert r.status_code == 200

            mock_init.assert_called_once()
            mock_start.assert_called_once()
            mock_stop.assert_called_once()
            mock_close.assert_called_once()
    finally:
        # Evict the module so later tests get fresh real bindings, not the mocked ones.
        sys.modules.pop("app.main", None)
