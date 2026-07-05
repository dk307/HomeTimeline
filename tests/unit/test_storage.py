"""Unit tests for storage stats service."""

from datetime import UTC

from app.services.storage import get_storage_stats
from tests.asserts import assert_offset_aware_iso


def test_storage_stats_structure(recording):
    stats = get_storage_stats()
    assert "indexed_recordings" in stats
    assert "indexed_size_bytes" in stats
    assert "last_scan_finished" in stats
    assert "cameras" in stats
    assert stats["indexed_recordings"] == 1
    assert stats["indexed_size_bytes"] == 1024 * 1024


def test_storage_stats_per_camera(recording, camera):
    stats = get_storage_stats()
    assert len(stats["cameras"]) >= 1
    cam = stats["cameras"][0]
    assert "id" in cam
    assert "name" in cam
    assert "recordings" in cam
    assert "indexed_size_bytes" in cam
    assert "latest_video_at" in cam
    assert cam["recordings"] >= 1


def test_storage_stats_no_recordings(test_db):
    """Empty DB returns zero counts and null last_scan"""
    stats = get_storage_stats()
    assert stats["indexed_recordings"] == 0
    assert stats["indexed_size_bytes"] == 0
    assert stats["last_scan_finished"] is None
    assert stats["cameras"] == []


def test_fmt_dt_naive_gets_tz_offset():
    """fmt_dt treats naive datetimes as UTC and returns an offset-aware ISO string."""
    from datetime import datetime

    from app.services.tz import fmt_dt

    result = fmt_dt(datetime(2024, 1, 15, 10, 30, 0))
    # Must be offset-aware (not a bare naive string): ends with Z or carries a
    # ±HH:MM offset — sign-agnostic so it holds under any local timezone.
    assert_offset_aware_iso(result)


def test_fmt_dt_none():
    from app.services.tz import fmt_dt

    assert fmt_dt(None) is None


def test_fmt_dt_converts_to_app_tz():
    """fmt_dt converts aware datetimes to the configured app TZ."""
    import zoneinfo
    from datetime import datetime, timedelta, timezone
    from unittest.mock import patch

    from app.services.tz import fmt_dt

    tz_minus5 = timezone(timedelta(hours=-5))
    dt = datetime(2024, 1, 15, 10, 30, 0, tzinfo=tz_minus5)
    eastern = zoneinfo.ZoneInfo("America/New_York")
    with patch("app.services.tz.get_app_tz", return_value=eastern):
        result = fmt_dt(dt)
    assert result is not None
    # 10:30 -05:00 = 15:30 UTC = 10:30 EST (Jan) → -05:00
    assert "-05:00" in result
    assert not result.endswith("Z")


def test_fmt_dt_utc_aware_no_double_z():
    """fmt_dt on a UTC-aware datetime must not produce a trailing Z after +00:00."""
    from datetime import datetime

    from app.services.tz import fmt_dt

    result = fmt_dt(datetime(2024, 1, 15, 10, 30, 0, tzinfo=UTC))
    assert result is not None
    assert not result.endswith("+00:00Z")
    # Offset-aware output, sign-agnostic (app tz may be behind or ahead of UTC).
    assert_offset_aware_iso(result)


def test_storage_stats_multiple_cameras(test_db, location):
    """Two cameras with different recording sizes — per-camera stats are correct."""
    from datetime import datetime

    from app.models.camera import Camera
    from app.models.recording import Recording
    from app.services.tz import fmt_dt

    cam1 = Camera.create(name="Cam A", recording_path="/tmp/a", location=location)
    cam2 = Camera.create(name="Cam B", recording_path="/tmp/b", location=location)

    t1 = datetime(2024, 1, 15, 10, 0)
    t2 = datetime(2024, 1, 15, 11, 0)
    t3 = datetime(2024, 1, 15, 12, 0)

    Recording.create(
        camera=cam1,
        file_path="/tmp/a/1.mp4",
        start_time=t1,
        end_time=t2,
        file_size_bytes=1000,
        status="ready",
    )
    Recording.create(
        camera=cam2,
        file_path="/tmp/b/2.mp4",
        start_time=t2,
        end_time=t3,
        file_size_bytes=2000,
        status="ready",
    )

    stats = get_storage_stats()
    assert stats["indexed_size_bytes"] == 3000
    by_name = {c["name"]: c for c in stats["cameras"]}
    assert by_name["Cam A"]["indexed_size_bytes"] == 1000
    assert by_name["Cam B"]["indexed_size_bytes"] == 2000
    assert by_name["Cam B"]["latest_video_at"] == fmt_dt(t3)


def test_storage_stats_latest_video_at_is_most_recent(test_db, camera):
    """latest_video_at reflects the most recent recording's end_time."""
    from datetime import datetime

    from app.models.recording import Recording
    from app.services.tz import fmt_dt

    t_old = datetime(2024, 1, 10, 8, 0)
    t_new = datetime(2024, 1, 15, 10, 0)
    t_new_end = datetime(2024, 1, 15, 11, 0)

    Recording.create(
        camera=camera,
        file_path="/tmp/old.mp4",
        start_time=t_old,
        end_time=t_old,
        file_size_bytes=500,
        status="ready",
    )
    Recording.create(
        camera=camera,
        file_path="/tmp/new.mp4",
        start_time=t_new,
        end_time=t_new_end,
        file_size_bytes=500,
        status="ready",
    )

    stats = get_storage_stats()
    cam_stat = stats["cameras"][0]
    assert cam_stat["latest_video_at"] == fmt_dt(t_new_end)


def test_storage_stats_last_scan(test_db):
    """last_scan_finished reflects the most recent completed scan."""
    from datetime import datetime

    from app.models.scan_event import ScanEvent
    from app.services.tz import fmt_dt

    t = datetime(2024, 1, 15, 10, 0, tzinfo=UTC)
    ScanEvent.create(started_at=t, finished_at=t, status="ok")
    stats = get_storage_stats()
    assert stats["last_scan_finished"] == fmt_dt(t)
