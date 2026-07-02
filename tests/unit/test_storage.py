"""Unit tests for storage stats service."""

from app.services.storage import get_storage_stats


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
    from app.services.storage import get_storage_stats

    stats = get_storage_stats()
    assert stats["indexed_recordings"] == 0
    assert stats["indexed_size_bytes"] == 0
    assert stats["last_scan_finished"] is None
    assert stats["cameras"] == []


def test_fmt_dt_appends_z_for_naive():
    """_fmt_dt appends Z to naive datetimes (no timezone info)."""
    from datetime import datetime

    from app.services.storage import _fmt_dt

    dt = datetime(2024, 1, 15, 10, 30, 0)  # naive, no tz
    result = _fmt_dt(dt)
    assert result is not None
    assert result.endswith("Z")


def test_fmt_dt_none():
    from app.services.storage import _fmt_dt

    assert _fmt_dt(None) is None


def test_fmt_dt_negative_offset_does_not_append_z():
    """_fmt_dt must NOT append Z to aware datetimes with a negative UTC offset."""
    from datetime import datetime, timezone, timedelta

    from app.services.storage import _fmt_dt

    tz_minus5 = timezone(timedelta(hours=-5))
    dt = datetime(2024, 1, 15, 10, 30, 0, tzinfo=tz_minus5)
    result = _fmt_dt(dt)
    assert result is not None
    assert result.endswith("-05:00"), f"Expected -05:00 suffix, got: {result}"
    assert not result.endswith("Z")


def test_fmt_dt_timezone_aware_keeps_offset():
    """_fmt_dt on a UTC-aware datetime keeps the +00:00 offset and adds no extra Z."""
    from datetime import datetime, timezone

    from app.services.storage import _fmt_dt

    dt = datetime(2024, 1, 15, 10, 30, 0, tzinfo=timezone.utc)
    result = _fmt_dt(dt)
    assert result is not None
    # isoformat() produces +00:00; our function must NOT add another Z
    assert not result.endswith("+00:00Z")
    assert "+00:00" in result or result.endswith("Z")


def test_storage_stats_multiple_cameras(test_db, location):
    """Two cameras with different recording sizes — aggregate and per-camera stats are correct."""
    from datetime import datetime

    from app.models.camera import Camera
    from app.models.recording import Recording

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
    # latest_video_at for Cam B should be exactly t3 formatted as ISO 8601 with Z
    from app.services.storage import _fmt_dt

    assert by_name["Cam B"]["latest_video_at"] == _fmt_dt(t3)


def test_storage_stats_latest_video_at_is_most_recent(test_db, camera):
    """latest_video_at reflects the most recent recording's end_time."""
    from datetime import datetime

    from app.models.recording import Recording

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

    from app.services.storage import _fmt_dt

    stats = get_storage_stats()
    cam_stat = stats["cameras"][0]
    # Should reflect exactly t_new_end (the later recording's end_time)
    assert cam_stat["latest_video_at"] == _fmt_dt(t_new_end)


def test_storage_stats_last_scan(test_db, recording):
    from datetime import datetime, timezone

    from app.models.scan_event import ScanEvent
    from app.services.storage import get_storage_stats

    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
        finished_at=datetime(2024, 1, 15, 10, 1, tzinfo=timezone.utc),
        cameras_scanned=1,
        status="ok",
    )
    stats = get_storage_stats()
    assert stats["last_scan_finished"] is not None
