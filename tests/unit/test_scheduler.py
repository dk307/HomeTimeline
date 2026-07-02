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


def test_run_scan_logs_total_on_success():
    """_run_scan logs the result count on success (covers the sum() branch)."""
    from app.workers import scheduler

    with patch("app.services.scanner.scan_all", return_value={"cam1": 3, "cam2": 2}):
        scheduler._run_scan()  # should not raise; covers lines 18-20


def test_start_scheduler_adds_job_with_correct_interval(test_db):
    """start_scheduler passes the DB scan_interval_minutes to the IntervalTrigger."""
    from unittest.mock import MagicMock, patch

    from app.models.app_settings import AppSettings

    s = AppSettings.get_instance()
    s.scan_interval_minutes = 17
    s.save()

    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    mock_sched = MagicMock()
    try:
        with patch("app.workers.scheduler.BackgroundScheduler", return_value=mock_sched):
            sched_mod.start_scheduler()

        add_call = mock_sched.add_job.call_args
        trigger = add_call.kwargs.get("trigger") or add_call.args[1]
        # IntervalTrigger stores interval as a timedelta or has minutes attr
        from apscheduler.triggers.interval import IntervalTrigger

        assert isinstance(trigger, IntervalTrigger)
        assert trigger.interval.seconds == 17 * 60
    finally:
        sched_mod._scheduler = original


def test_start_scheduler_creates_and_starts(test_db):
    """start_scheduler() creates a BackgroundScheduler and starts it."""
    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    try:
        sched_mod.start_scheduler()
        assert sched_mod._scheduler is not None
        assert sched_mod._scheduler.running
    finally:
        if sched_mod._scheduler and sched_mod._scheduler.running:
            sched_mod._scheduler.shutdown(wait=False)
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
