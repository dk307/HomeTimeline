"""Unit tests for the per-camera purge service."""

from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from app.models.base import utcnow
from app.models.recording import Recording
from app.services import purger


def _hikvision_camera(camera, tmp_path):
    camera.camera_type = "hikvision"
    camera.host = "192.168.1.10"
    camera.recording_path = str(tmp_path)
    camera.save()
    return camera


def _make_recording(camera, tmp_path, name, start, *, with_thumb=True, on_disk=True):
    """Create a Recording row backed by a real file (and optional thumbnail)."""
    video = tmp_path / name
    thumb = tmp_path / (name + ".jpg")
    if on_disk:
        video.write_bytes(b"x" * 2048)
        if with_thumb:
            thumb.write_bytes(b"t" * 128)
    return Recording.create(
        camera=camera,
        file_path=str(video),
        start_time=start,
        end_time=start + timedelta(minutes=5),
        file_size_bytes=2048,
        thumbnail_path=str(thumb) if with_thumb else None,
        status="ready",
    )


# ------------------------------------------------------------------ locking


def test_is_purging_is_per_camera(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    assert purger.is_purging(cam.id) is False
    with purger._acquire_purge_lock(cam.id):
        assert purger.is_purging(cam.id) is True
        assert purger.is_purging(cam.id + 999) is False
        assert purger.is_purging() is True
    assert purger.is_purging(cam.id) is False


def test_acquire_purge_lock_raises_when_busy(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    with purger._acquire_purge_lock(cam.id):
        with pytest.raises(RuntimeError):
            with purger._acquire_purge_lock(cam.id):
                pass


def test_request_purge_stop_only_when_purging(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    assert purger.request_purge_stop(cam.id) is False
    with purger._acquire_purge_lock(cam.id):
        assert purger.request_purge_stop(cam.id) is True
        assert purger._stop_requested(cam.id) is True
    assert purger._stop_requested(cam.id) is False


# ------------------------------------------------------------------ purge_camera


def test_purge_camera_never_is_noop(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = None
    cam.save()
    old = _make_recording(cam, tmp_path, "old.mp4", utcnow() - timedelta(days=100))
    deleted, freed = purger.purge_camera(cam)
    assert (deleted, freed) == (0, 0)
    assert Recording.get_or_none(Recording.id == old.id) is not None


def test_purge_camera_deletes_only_old_clips(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 30
    cam.save()
    old = _make_recording(cam, tmp_path, "old.mp4", utcnow() - timedelta(days=45))
    recent = _make_recording(cam, tmp_path, "recent.mp4", utcnow() - timedelta(days=5))

    deleted, freed = purger.purge_camera(cam)

    assert deleted == 1
    assert freed == 2048
    # Old row + its files are gone; recent is untouched.
    assert Recording.get_or_none(Recording.id == old.id) is None
    assert not (tmp_path / "old.mp4").exists()
    assert not (tmp_path / "old.mp4.jpg").exists()
    assert Recording.get_or_none(Recording.id == recent.id) is not None
    assert (tmp_path / "recent.mp4").exists()


def test_purge_camera_handles_missing_files(camera, tmp_path):
    """A row whose file is already gone is still removed (freed=0 for it)."""
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 1
    cam.save()
    rec = _make_recording(cam, tmp_path, "gone.mp4", utcnow() - timedelta(days=10), on_disk=False)
    deleted, freed = purger.purge_camera(cam)
    assert deleted == 1
    assert freed == 0
    assert Recording.get_or_none(Recording.id == rec.id) is None


def test_purge_camera_skips_missing_thumbnail_path(camera, tmp_path):
    """A recording with no thumbnail_path is deleted without touching the disk."""
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 1
    cam.save()
    rec = _make_recording(
        cam, tmp_path, "nothumb.mp4", utcnow() - timedelta(days=10), with_thumb=False
    )
    deleted, freed = purger.purge_camera(cam)
    assert deleted == 1
    assert freed == 2048
    assert Recording.get_or_none(Recording.id == rec.id) is None
    assert not (tmp_path / "nothumb.mp4").exists()


def test_purge_camera_retains_row_when_unlink_fails(camera, tmp_path):
    """A file that exists but can't be unlinked is kept indexed (not orphaned)."""
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 1
    cam.save()
    rec = _make_recording(cam, tmp_path, "locked.mp4", utcnow() - timedelta(days=10))
    with patch("app.services.purger.Path.unlink", side_effect=OSError("permission denied")):
        deleted, freed = purger.purge_camera(cam)
    # Nothing deleted or freed; the index row survives so the clip isn't orphaned.
    assert deleted == 0
    assert freed == 0
    assert Recording.get_or_none(Recording.id == rec.id) is not None
    assert (tmp_path / "locked.mp4").exists()


def test_purge_camera_stops_between_clips(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 1
    cam.save()
    _make_recording(cam, tmp_path, "a.mp4", utcnow() - timedelta(days=10))
    _make_recording(cam, tmp_path, "b.mp4", utcnow() - timedelta(days=9))
    with patch("app.services.purger._stop_requested", return_value=True):
        deleted, freed = purger.purge_camera(cam)
    assert (deleted, freed) == (0, 0)
    assert Recording.select().count() == 2


# --------------------------------------------------------- purge_single_camera


def test_purge_single_camera_missing_returns_empty():
    assert purger.purge_single_camera(99999) == {}


def test_purge_single_camera_skips_disabled_without_force(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.enabled = False
    cam.purge_older_than_days = 30
    cam.save()
    assert purger.purge_single_camera(cam.id) == {}


def test_purge_single_camera_force_runs_when_disabled(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.enabled = False
    cam.purge_older_than_days = 30
    cam.save()
    with patch("app.services.purger.purge_camera", return_value=(0, 0)):
        assert purger.purge_single_camera(cam.id, force=True) == {cam.name: 0}


def test_purge_single_camera_records_event(camera, tmp_path):
    from app.models.camera import Camera
    from app.models.purge_event import PurgeEvent

    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 30
    cam.save()
    with patch("app.services.purger.purge_camera", return_value=(3, 6144)):
        result = purger.purge_single_camera(cam.id, force=True)

    assert result == {cam.name: 3}
    event = PurgeEvent.select().order_by(PurgeEvent.id.desc()).first()
    assert event.status == "ok"
    assert event.deleted == 3
    assert event.freed_bytes == 6144
    assert "3 deleted" in event.detail
    assert Camera.get_by_id(cam.id).last_purged_at is not None
    assert purger.is_purging(cam.id) is False


def test_purge_single_camera_records_error(camera, tmp_path):
    from app.models.purge_event import PurgeEvent

    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 30
    cam.save()
    with patch("app.services.purger.purge_camera", side_effect=RuntimeError("disk gone")):
        assert purger.purge_single_camera(cam.id, force=True) == {}
    event = PurgeEvent.select().order_by(PurgeEvent.id.desc()).first()
    assert event.status == "error"
    assert "disk gone" in event.detail
    assert purger.is_purging(cam.id) is False


def test_purge_single_camera_skips_when_already_purging(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 30
    cam.save()
    with purger._acquire_purge_lock(cam.id):
        assert purger.purge_single_camera(cam.id, force=True) == {}


def test_purge_single_camera_releases_lock_on_event_create_failure(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 30
    cam.save()
    with patch("app.models.purge_event.PurgeEvent.create", side_effect=RuntimeError("db down")):
        with pytest.raises(RuntimeError):
            purger.purge_single_camera(cam.id, force=True)
    assert purger.is_purging(cam.id) is False


def test_fmt_bytes_scales_units():
    assert purger._fmt_bytes(0) == "0 B"
    assert purger._fmt_bytes(512) == "512 B"
    assert purger._fmt_bytes(1536) == "1.5 KB"
    assert purger._fmt_bytes(5 * 1024 * 1024) == "5.0 MB"
    assert purger._fmt_bytes(3 * 1024**3) == "3.0 GB"
    assert purger._fmt_bytes(2 * 1024**4) == "2.0 TB"


def test_purge_single_camera_end_to_end(camera, tmp_path):
    """Full path: real files older than the window are deleted and indexed rows go."""
    cam = _hikvision_camera(camera, tmp_path)
    cam.purge_older_than_days = 7
    cam.save()
    _make_recording(cam, tmp_path, "old.mp4", datetime(2020, 1, 1, 0, 0))
    _make_recording(cam, tmp_path, "fresh.mp4", utcnow() - timedelta(days=1))

    result = purger.purge_single_camera(cam.id, force=True)

    assert result == {cam.name: 1}
    assert Recording.select().count() == 1
    assert Recording.get().file_path.endswith("fresh.mp4")
    assert not (tmp_path / "old.mp4").exists()
