"""Unit tests for the per-camera scan scheduler worker."""

from unittest.mock import MagicMock, patch


def _make_camera(test_db, **kwargs):
    from app.models.camera import Camera

    defaults = {"name": "Cam", "recording_path": "/tmp/rec"}
    defaults.update(kwargs)
    return Camera.create(**defaults)


def test_reschedule_camera_no_op_when_scheduler_not_running():
    """reschedule_camera() silently does nothing if the scheduler hasn't started."""
    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    sched_mod._scheduler = None
    try:
        sched_mod.reschedule_camera(1, 10)  # should not raise
    finally:
        sched_mod._scheduler = original


def test_reschedule_camera_adds_job_when_interval_set():
    import app.workers.scheduler as sched_mod

    mock_scheduler = MagicMock()
    mock_scheduler.running = True
    original = sched_mod._scheduler
    sched_mod._scheduler = mock_scheduler
    try:
        sched_mod.reschedule_camera(7, 15)
        mock_scheduler.add_job.assert_called_once()
        kwargs = mock_scheduler.add_job.call_args.kwargs
        assert kwargs["id"] == "camera_scan_7"
        assert kwargs["args"] == [7]
        from apscheduler.triggers.interval import IntervalTrigger

        assert isinstance(kwargs["trigger"], IntervalTrigger)
        assert kwargs["trigger"].interval.total_seconds() == 15 * 60
    finally:
        sched_mod._scheduler = original


def test_reschedule_camera_removes_job_when_never():
    """A falsy interval (None/0 = Never) removes any existing job for that camera."""
    import app.workers.scheduler as sched_mod

    mock_scheduler = MagicMock()
    mock_scheduler.running = True
    mock_scheduler.get_job.return_value = object()  # a job exists
    original = sched_mod._scheduler
    sched_mod._scheduler = mock_scheduler
    try:
        sched_mod.reschedule_camera(3, None)
        mock_scheduler.remove_job.assert_called_once_with("camera_scan_3")
        mock_scheduler.add_job.assert_not_called()
    finally:
        sched_mod._scheduler = original


def test_reschedule_camera_never_no_existing_job_is_noop():
    import app.workers.scheduler as sched_mod

    mock_scheduler = MagicMock()
    mock_scheduler.running = True
    mock_scheduler.get_job.return_value = None  # nothing to remove
    original = sched_mod._scheduler
    sched_mod._scheduler = mock_scheduler
    try:
        sched_mod.reschedule_camera(3, 0)
        mock_scheduler.remove_job.assert_not_called()
        mock_scheduler.add_job.assert_not_called()
    finally:
        sched_mod._scheduler = original


def test_start_scheduler_schedules_only_cameras_with_interval(test_db):
    """start_scheduler adds a job for each enabled camera with a positive interval."""
    _make_camera(test_db, name="Auto", scan_interval_minutes=10, enabled=True)
    _make_camera(test_db, name="Never", scan_interval_minutes=None, enabled=True)
    _make_camera(test_db, name="Disabled", scan_interval_minutes=10, enabled=False)

    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    mock_sched = MagicMock()
    mock_sched.running = True
    try:
        with patch("app.workers.scheduler.BackgroundScheduler", return_value=mock_sched):
            sched_mod.start_scheduler()
        # Only the enabled camera with an interval gets scheduled.
        assert mock_sched.add_job.call_count == 1
        assert mock_sched.add_job.call_args.kwargs["trigger"].interval.total_seconds() == 10 * 60
    finally:
        sched_mod._scheduler = original


def test_start_scheduler_isolates_per_camera_failures(test_db):
    """One camera failing to schedule must not skip the remaining cameras."""
    _make_camera(test_db, name="A", scan_interval_minutes=10, enabled=True)
    _make_camera(test_db, name="B", scan_interval_minutes=20, enabled=True)

    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    mock_sched = MagicMock()
    mock_sched.running = True
    calls = []

    def flaky(camera_id, minutes):
        calls.append(camera_id)
        if len(calls) == 1:
            raise RuntimeError("boom")

    try:
        with (
            patch("app.workers.scheduler.BackgroundScheduler", return_value=mock_sched),
            patch("app.workers.scheduler.reschedule_camera", side_effect=flaky),
        ):
            sched_mod.start_scheduler()  # must not raise
        # Both cameras were attempted even though the first raised.
        assert len(calls) == 2
    finally:
        sched_mod._scheduler = original


def test_start_scheduler_survives_camera_query_error(test_db):
    """A failure enumerating cameras is logged, not propagated (scheduler stays up)."""
    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    mock_sched = MagicMock()
    mock_sched.running = True
    try:
        with (
            patch("app.workers.scheduler.BackgroundScheduler", return_value=mock_sched),
            patch("app.models.camera.Camera.select", side_effect=RuntimeError("db down")),
        ):
            sched_mod.start_scheduler()  # should not raise
        mock_sched.start.assert_called_once()
        mock_sched.add_job.assert_not_called()
    finally:
        sched_mod._scheduler = original


def test_start_scheduler_creates_and_starts(test_db):
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


def test_run_camera_scan_catches_exceptions():
    """_run_camera_scan logs errors instead of propagating exceptions."""
    from app.workers import scheduler

    with patch("app.services.scanner.scan_single_camera", side_effect=RuntimeError("boom")):
        scheduler._run_camera_scan(1)  # should not raise


def test_run_camera_scan_logs_total_on_success():
    from app.workers import scheduler

    with patch("app.services.scanner.scan_single_camera", return_value={"cam": 4}):
        scheduler._run_camera_scan(1)  # should not raise; covers the sum() branch


def test_reschedule_camera_download_adds_job():
    import app.workers.scheduler as sched_mod

    mock_scheduler = MagicMock()
    mock_scheduler.running = True
    original = sched_mod._scheduler
    sched_mod._scheduler = mock_scheduler
    try:
        sched_mod.reschedule_camera_download(9, 30)
        mock_scheduler.add_job.assert_called_once()
        kwargs = mock_scheduler.add_job.call_args.kwargs
        assert kwargs["id"] == "camera_download_9"
        assert kwargs["args"] == [9]
        assert kwargs["trigger"].interval.total_seconds() == 30 * 60
    finally:
        sched_mod._scheduler = original


def test_reschedule_camera_download_removes_when_never():
    import app.workers.scheduler as sched_mod

    mock_scheduler = MagicMock()
    mock_scheduler.running = True
    mock_scheduler.get_job.return_value = object()
    original = sched_mod._scheduler
    sched_mod._scheduler = mock_scheduler
    try:
        sched_mod.reschedule_camera_download(4, None)
        mock_scheduler.remove_job.assert_called_once_with("camera_download_4")
        mock_scheduler.add_job.assert_not_called()
    finally:
        sched_mod._scheduler = original


def test_start_scheduler_schedules_hikvision_downloads(test_db):
    """Only enabled Hikvision cameras with a positive download interval get a job."""
    _make_camera(
        test_db, name="Hik", camera_type="hikvision", download_interval_minutes=20, enabled=True
    )
    _make_camera(test_db, name="HikNever", camera_type="hikvision", download_interval_minutes=None)
    _make_camera(test_db, name="Generic", camera_type="generic", download_interval_minutes=20)

    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    mock_sched = MagicMock()
    mock_sched.running = True
    try:
        with patch("app.workers.scheduler.BackgroundScheduler", return_value=mock_sched):
            sched_mod.start_scheduler()
        download_jobs = [
            c
            for c in mock_sched.add_job.call_args_list
            if c.kwargs["id"].startswith("camera_download_")
        ]
        assert len(download_jobs) == 1
        assert download_jobs[0].kwargs["trigger"].interval.total_seconds() == 20 * 60
    finally:
        sched_mod._scheduler = original


def test_run_camera_download_catches_exceptions():
    from app.workers import scheduler

    with patch("app.services.downloader.download_single_camera", side_effect=RuntimeError("boom")):
        scheduler._run_camera_download(1)  # should not raise


def test_run_camera_download_logs_total_on_success():
    from app.workers import scheduler

    with patch("app.services.downloader.download_single_camera", return_value={"cam": 3}):
        scheduler._run_camera_download(1)  # should not raise; covers the sum() branch


def test_stop_scheduler_safe_when_not_running():
    import app.workers.scheduler as sched_mod

    original = sched_mod._scheduler
    sched_mod._scheduler = None
    try:
        sched_mod.stop_scheduler()  # should not raise
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
