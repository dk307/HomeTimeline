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
    """Empty DB returns zero counts and null last_scan."""
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
