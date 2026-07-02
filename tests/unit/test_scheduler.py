"""Unit tests for the scheduler worker."""

from unittest.mock import MagicMock, patch


def test_interval_minutes_reads_from_db(test_db):
    from app.models.app_settings import AppSettings
    from app.workers.scheduler import _interval_minutes

    AppSettings.get_instance()  # seed row
    s = AppSettings.get_instance()
    s.scan_interval_minutes = 42
    s.save()
    assert _interval_minutes() == 42


def test_interval_minutes_falls_back_to_env():
    from app.workers.scheduler import _interval_minutes

    # AppSettings is lazily imported inside the function — patch at its source
    with patch("app.models.app_settings.AppSettings.get_instance", side_effect=Exception("no db")):
        with patch("app.workers.scheduler.settings") as mock_settings:
            mock_settings.scan_interval_minutes = 99
            result = _interval_minutes()
    assert result == 99


def test_reschedule_no_op_when_scheduler_not_running():
    """reschedule() silently does nothing if the scheduler hasn't started."""
    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    sched_mod._scheduler = None
    try:
        sched_mod.reschedule(10)  # should not raise
    finally:
        sched_mod._scheduler = original


def test_stop_scheduler_safe_when_not_running():
    """stop_scheduler() is safe to call when nothing is started."""
    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    sched_mod._scheduler = None
    try:
        sched_mod.stop_scheduler()  # should not raise
    finally:
        sched_mod._scheduler = original


def test_run_scan_catches_exceptions():
    """_run_scan logs errors instead of propagating exceptions."""
    from app.workers import scheduler

    with patch("app.services.scanner.scan_all", side_effect=RuntimeError("boom")):
        scheduler._run_scan()  # should not raise


def test_reschedule_calls_scheduler_when_running():

    mock_scheduler = MagicMock()
    mock_scheduler.running = True
    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    sched_mod._scheduler = mock_scheduler
    try:
        sched_mod.reschedule(15)
        mock_scheduler.reschedule_job.assert_called_once()
    finally:
        sched_mod._scheduler = original


def test_stop_scheduler_shuts_down_when_running():
    from app.workers import scheduler as sched_mod

    mock_scheduler = MagicMock()
    mock_scheduler.running = True
    original = sched_mod._scheduler
    sched_mod._scheduler = mock_scheduler
    try:
        sched_mod.stop_scheduler()
        mock_scheduler.shutdown.assert_called_once_with(wait=False)
    finally:
        sched_mod._scheduler = original
