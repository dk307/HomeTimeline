"""Unit tests for the per-camera Hikvision downloader."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import downloader


def _hikvision_camera(camera, tmp_path):
    camera.camera_type = "hikvision"
    camera.host = "192.168.1.10"
    camera.username = "admin"
    camera.password = "pw"
    camera.recording_path = str(tmp_path)
    camera.save()
    return camera


class _FakeClient:
    """Stand-in for HikvisionClient: returns canned recordings, writes fake files."""

    def __init__(self, recordings):
        self._recordings = recordings

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def search_all_recordings(self, batch_size=40):
        return list(self._recordings)

    async def download_clip(self, playback_uri, dest, should_stop=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"video-bytes")
        return dest


def _rec(name, start):
    return {
        "track_id": 101,
        "start_time": start,
        "end_time": start + timedelta(minutes=5),
        "playback_uri": f"rtsp://cam/Streaming?name={name}" if name else "rtsp://cam/Streaming",
    }


# ------------------------------------------------------------------ locking


def test_is_downloading_is_per_camera(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    assert downloader.is_downloading(cam.id) is False
    with downloader._acquire_download_lock(cam.id):
        assert downloader.is_downloading(cam.id) is True
        assert downloader.is_downloading(cam.id + 999) is False
        assert downloader.is_downloading() is True
    assert downloader.is_downloading(cam.id) is False


def test_acquire_download_lock_raises_when_busy(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    with downloader._acquire_download_lock(cam.id):
        with pytest.raises(RuntimeError):
            with downloader._acquire_download_lock(cam.id):
                pass


# ------------------------------------------------------- download_single_camera


def test_download_single_camera_skips_non_hikvision(camera, tmp_path):
    camera.camera_type = "aqura"
    camera.recording_path = str(tmp_path)
    camera.save()
    assert downloader.download_single_camera(camera.id) == {}


def test_download_single_camera_missing_returns_empty():
    assert downloader.download_single_camera(99999) == {}


def test_download_single_camera_skips_disabled_without_force(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.enabled = False
    cam.save()
    assert downloader.download_single_camera(cam.id) == {}


def test_download_single_camera_records_event_and_indexes(camera, tmp_path):
    from app.models.camera import Camera
    from app.models.download_event import DownloadEvent

    cam = _hikvision_camera(camera, tmp_path)
    with patch("app.services.downloader.download_camera", return_value=(2, 2, 0)):
        result = downloader.download_single_camera(cam.id, force=True)

    assert result == {cam.name: 2}
    event = DownloadEvent.select().order_by(DownloadEvent.id.desc()).first()
    assert event.status == "ok"
    assert event.downloaded == 2
    assert event.indexed == 2
    assert Camera.get_by_id(cam.id).last_downloaded_at is not None
    assert downloader.is_downloading(cam.id) is False


def test_download_single_camera_force_runs_when_disabled(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    cam.enabled = False
    cam.save()
    with patch("app.services.downloader.download_camera", return_value=(0, 0, 0)):
        assert downloader.download_single_camera(cam.id, force=True) == {cam.name: 0}


def test_download_single_camera_skips_when_already_downloading(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    with downloader._acquire_download_lock(cam.id):
        assert downloader.download_single_camera(cam.id, force=True) == {}


def test_download_single_camera_records_error(camera, tmp_path):
    from app.models.download_event import DownloadEvent

    cam = _hikvision_camera(camera, tmp_path)
    with patch("app.services.downloader.download_camera", side_effect=RuntimeError("net down")):
        assert downloader.download_single_camera(cam.id, force=True) == {}
    event = DownloadEvent.select().order_by(DownloadEvent.id.desc()).first()
    assert event.status == "error"
    assert "net down" in event.detail
    assert downloader.is_downloading(cam.id) is False


def test_download_single_camera_releases_lock_on_event_create_failure(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    with patch(
        "app.models.download_event.DownloadEvent.create", side_effect=RuntimeError("db down")
    ):
        with pytest.raises(RuntimeError):
            downloader.download_single_camera(cam.id, force=True)
    assert downloader.is_downloading(cam.id) is False


# ------------------------------------------------------------- download_camera


def test_download_camera_indexes_each_clip(camera, tmp_path):
    """Each downloaded clip is indexed inline (a Recording row is created)."""
    from app.models.recording import Recording

    cam = _hikvision_camera(camera, tmp_path)
    recs = [_rec("clipA", datetime(2024, 1, 15, 10, 0, tzinfo=UTC))]
    with (
        patch("app.services.hikvision.HikvisionClient", return_value=_FakeClient(recs)),
        patch("app.services.scanner._make_thumbnail", return_value=None),
        patch("app.services.scanner._file_hash", return_value="h1"),
        patch("app.services.hikvision.set_mp4_metadata") as mock_meta,
    ):
        downloaded, indexed, errored = downloader.download_camera(cam)
    assert (downloaded, indexed, errored) == (1, 1, 0)
    assert Recording.select().count() == 1
    rec = Recording.get()
    assert rec.file_path.endswith("clipA.mp4")
    assert rec.status == "ready"
    mock_meta.assert_called_once()
    args, _ = mock_meta.call_args
    assert args[2] == 101  # track_id
    assert args[3] == "Test Cam"  # camera_name
    assert args[4] == "clipA"  # clip_name
    assert isinstance(args[0], Path)  # dest_mp4
    assert args[1] == recs[0]["start_time"]


def test_download_camera_writes_and_skips_existing(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    recs = [_rec("clipA", datetime(2024, 1, 15, 10, 0, tzinfo=UTC))]

    with (
        patch("app.services.hikvision.HikvisionClient", return_value=_FakeClient(recs)),
        patch("app.services.scanner.index_recording", return_value="added"),
        patch("app.services.hikvision.set_mp4_metadata") as mock_meta,
    ):
        downloaded, indexed, errored = downloader.download_camera(cam)
    assert (downloaded, indexed, errored) == (1, 1, 0)
    files = list(tmp_path.rglob("*.mp4"))
    assert len(files) == 1
    assert files[0].name == "clipA.mp4"
    mock_meta.assert_called_once()
    args, _ = mock_meta.call_args
    assert args[4] == "clipA"

    # Second run: file already on disk → skipped, nothing re-downloaded/indexed.
    with (
        patch("app.services.hikvision.HikvisionClient", return_value=_FakeClient(recs)),
        patch("app.services.scanner.index_recording", return_value="added"),
        patch("app.services.hikvision.set_mp4_metadata"),
    ):
        downloaded2, indexed2, errored2 = downloader.download_camera(cam)
    assert (downloaded2, indexed2, errored2) == (0, 0, 0)
    assert len(list(tmp_path.rglob("*.mp4"))) == 1


def test_download_camera_day_folder_uses_app_timezone(camera, tmp_path):
    """The YYYY-MM-DD folder follows the app timezone, not the container's UTC —
    so clips match the pyscript's layout and don't duplicate across the day line."""
    from app.models.app_settings import AppSettings
    from app.services.tz import invalidate_tz_cache

    cam = _hikvision_camera(camera, tmp_path)
    settings_row = AppSettings.get_instance()
    settings_row.timezone = "America/Los_Angeles"
    settings_row.save()
    invalidate_tz_cache()
    try:
        # 03:00 UTC Jan 15 == 19:00 PST Jan 14 → LA day folder is 2026-01-14.
        recs = [_rec("clipX", datetime(2026, 1, 15, 3, 0, tzinfo=UTC))]
        with (
            patch("app.services.hikvision.HikvisionClient", return_value=_FakeClient(recs)),
            patch("app.services.scanner.index_recording", return_value="added"),
            patch("app.services.hikvision.set_mp4_metadata") as mock_meta,
        ):
            downloader.download_camera(cam)
        assert (tmp_path / "2026-01-14" / "clipX.mp4").exists()
        assert not (tmp_path / "2026-01-15" / "clipX.mp4").exists()
        mock_meta.assert_called_once()
        args, _ = mock_meta.call_args
        assert args[4] == "clipX"
    finally:
        invalidate_tz_cache()


def test_download_camera_counts_missing_name_as_error(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    recs = [_rec("", datetime(2024, 1, 15, 10, 0, tzinfo=UTC))]

    with patch("app.services.hikvision.HikvisionClient", return_value=_FakeClient(recs)):
        downloaded, indexed, errored = downloader.download_camera(cam)
    assert (downloaded, indexed, errored) == (0, 0, 1)
    assert list(tmp_path.rglob("*.mp4")) == []


def test_request_download_stop_only_when_downloading(camera, tmp_path):
    cam = _hikvision_camera(camera, tmp_path)
    assert downloader.request_download_stop(cam.id) is False
    with downloader._acquire_download_lock(cam.id):
        assert downloader.request_download_stop(cam.id) is True
        assert downloader._stop_requested(cam.id) is True
    assert downloader._stop_requested(cam.id) is False


def test_download_camera_stops_between_clips(camera, tmp_path):
    """A stop request aborts the loop before downloading any (more) clips."""
    cam = _hikvision_camera(camera, tmp_path)
    recs = [
        _rec("a", datetime(2024, 1, 15, 10, 0, tzinfo=UTC)),
        _rec("b", datetime(2024, 1, 15, 11, 0, tzinfo=UTC)),
    ]
    with (
        patch("app.services.hikvision.HikvisionClient", return_value=_FakeClient(recs)),
        patch("app.services.downloader._stop_requested", return_value=True),
    ):
        downloaded, indexed, errored = downloader.download_camera(cam)
    assert (downloaded, indexed, errored) == (0, 0, 0)
    assert list(tmp_path.rglob("*.mp4")) == []


class _StoppingClient(_FakeClient):
    """A client whose download_clip aborts mid-stream (as if stopped)."""

    async def download_clip(self, playback_uri, dest, should_stop=None):
        from app.services.hikvision import DownloadStopped

        raise DownloadStopped()


def test_download_camera_stops_mid_clip(camera, tmp_path):
    """DownloadStopped raised inside a clip download breaks the loop cleanly
    (not counted as an error)."""
    cam = _hikvision_camera(camera, tmp_path)
    recs = [
        _rec("a", datetime(2024, 1, 15, 10, 0, tzinfo=UTC)),
        _rec("b", datetime(2024, 1, 15, 11, 0, tzinfo=UTC)),
    ]
    with patch("app.services.hikvision.HikvisionClient", return_value=_StoppingClient(recs)):
        downloaded, indexed, errored = downloader.download_camera(cam)
    assert (downloaded, indexed, errored) == (0, 0, 0)


class _FailingClient(_FakeClient):
    async def download_clip(self, playback_uri, dest, should_stop=None):
        raise RuntimeError("network error")


def test_download_camera_counts_clip_failure(camera, tmp_path):
    """A failed clip download is counted as an error, not fatal."""
    cam = _hikvision_camera(camera, tmp_path)
    recs = [_rec("a", datetime(2024, 1, 15, 10, 0, tzinfo=UTC))]
    with patch("app.services.hikvision.HikvisionClient", return_value=_FailingClient(recs)):
        downloaded, indexed, errored = downloader.download_camera(cam)
    assert (downloaded, indexed, errored) == (0, 0, 1)


def test_has_downloadable_camera(camera, tmp_path):
    camera.camera_type = "aqura"
    camera.save()
    assert downloader.has_downloadable_camera() is False  # aqura not downloadable
    cam = _hikvision_camera(camera, tmp_path)
    assert downloader.has_downloadable_camera() is True
    cam.enabled = False
    cam.save()
    assert downloader.has_downloadable_camera() is False


def test_download_all_iterates_enabled_hikvision(camera, location, tmp_path):
    from app.models.camera import Camera

    hik = _hikvision_camera(camera, tmp_path)
    # An aqura camera must be ignored by the bulk download.
    Camera.create(
        name="Aqura", camera_type="aqura", recording_path=str(tmp_path / "g"), location=location
    )
    with patch("app.services.downloader.download_single_camera", return_value={"Hik": 2}) as mock:
        results = downloader.download_all()
    assert mock.call_count == 1
    assert mock.call_args.args[0] == hik.id
    assert results == {"Hik": 2}


def test_download_single_camera_detail_reports_failures(camera, tmp_path):
    from app.models.download_event import DownloadEvent

    cam = _hikvision_camera(camera, tmp_path)
    with patch("app.services.downloader.download_camera", return_value=(1, 1, 2)):
        downloader.download_single_camera(cam.id, force=True)
    e = DownloadEvent.select().order_by(DownloadEvent.id.desc()).first()
    assert "2 failed" in e.detail
    assert "+1 indexed" in e.detail
