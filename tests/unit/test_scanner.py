"""Unit tests for the scanner service."""

from datetime import UTC, datetime
from unittest.mock import patch

import pytest

from app.models.recording import Recording
from app.services import scanner


def test_file_hash_consistent(tmp_path):
    f = tmp_path / "video.mp4"
    f.write_bytes(b"fake video data")
    assert scanner._file_hash(f) == scanner._file_hash(f)
    assert len(scanner._file_hash(f)) == 64


def test_file_hash_differs_for_different_content(tmp_path):
    f1 = tmp_path / "a.mp4"
    f1.write_bytes(b"data1")
    f2 = tmp_path / "b.mp4"
    f2.write_bytes(b"data2")
    assert scanner._file_hash(f1) != scanner._file_hash(f2)


def test_probe_duration_returns_none_on_failure(tmp_path):
    bad = tmp_path / "not_a_video.mp4"
    bad.write_bytes(b"not video")
    with patch("app.services.scanner.ffmpeg.probe", side_effect=Exception("fail")):
        assert scanner._probe_duration(bad) is None


def test_probe_duration_returns_float(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    fake_probe = {"format": {"duration": "120.5"}}
    with patch("app.services.scanner.ffmpeg.probe", return_value=fake_probe):
        assert scanner._probe_duration(f) == pytest.approx(120.5)


def test_probe_video_returns_duration_and_creation_time(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    fake = {"format": {"duration": "60.0", "tags": {"creation_time": "2026-06-15T14:30:00.000Z"}}}
    with patch("app.services.scanner.ffmpeg.probe", return_value=fake):
        result = scanner._probe_video(f)
    assert result["duration"] == pytest.approx(60.0)
    assert result["creation_time"] == datetime(2026, 6, 15, 14, 30, 0, tzinfo=UTC).replace(
        tzinfo=None
    )


def test_probe_video_falls_back_to_apple_tag(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    fake = {
        "format": {
            "duration": "30.0",
            "tags": {"com.apple.quicktime.creationdate": "2026-06-15T14:30:00.000Z"},
        }
    }
    with patch("app.services.scanner.ffmpeg.probe", return_value=fake):
        result = scanner._probe_video(f)
    assert result["duration"] == pytest.approx(30.0)
    assert result["creation_time"] == datetime(2026, 6, 15, 14, 30, 0, tzinfo=UTC).replace(
        tzinfo=None
    )


def test_probe_video_no_creation_tag(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    fake = {"format": {"duration": "45.0", "tags": {}}}
    with patch("app.services.scanner.ffmpeg.probe", return_value=fake):
        result = scanner._probe_video(f)
    assert result["duration"] == pytest.approx(45.0)
    assert result["creation_time"] is None


def test_probe_video_ffprobe_fails(tmp_path):
    bad = tmp_path / "not_a_video.mp4"
    bad.write_bytes(b"not video")
    with patch("app.services.scanner.ffmpeg.probe", side_effect=Exception("fail")):
        result = scanner._probe_video(bad)
    assert result["duration"] is None
    assert result["creation_time"] is None


def test_times_from_mtime_with_duration(tmp_path):

    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    start, end = scanner._times_from_mtime(f, 3600.0)
    assert end is not None
    assert (end - start).seconds == 3600
    # end is the file's mtime as UTC-naive (independent of the server's local tz).
    mtime_utc = datetime.fromtimestamp(f.stat().st_mtime, tz=UTC).replace(tzinfo=None)
    assert abs((end - mtime_utc).total_seconds()) < 2


def test_times_from_mtime_without_duration(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    start, end = scanner._times_from_mtime(f, None)
    assert end is None or end == start


def test_request_scan_stop_only_when_scanning(camera):
    assert scanner.request_scan_stop(camera.id) is False  # not scanning
    with scanner._acquire_scan_lock(camera.id):
        assert scanner.request_scan_stop(camera.id) is True
        assert scanner._stop_requested(camera.id) is True
    # flag cleared when the scan lock is released
    assert scanner._stop_requested(camera.id) is False


def test_scan_camera_stops_when_requested(tmp_path, camera):
    """A stop request aborts the file loop before indexing anything further."""
    camera.recording_path = str(tmp_path)
    camera.save()
    (tmp_path / "a.mp4").write_bytes(b"x")
    (tmp_path / "b.mp4").write_bytes(b"x")
    with patch("app.services.scanner._stop_requested", return_value=True):
        assert scanner.scan_camera(camera) == (0, 0)
    assert Recording.select().count() == 0


def test_scan_camera_skips_nonexistent_path(camera):
    camera.recording_path = "/path/that/does/not/exist"
    camera.save()
    assert scanner.scan_camera(camera) == (0, 0)


def test_scan_camera_skips_already_indexed(tmp_path, camera):
    camera.recording_path = str(tmp_path)
    camera.save()
    mp4 = tmp_path / "clip.mp4"
    mp4.write_bytes(b"fake")
    Recording.create(camera=camera, file_path=str(mp4), start_time=datetime.now(), status="ready")
    with patch("app.services.scanner._probe_video") as mock:
        assert scanner.scan_camera(camera) == (0, 1)
    mock.assert_not_called()


def test_scan_camera_indexes_with_mtime(tmp_path, camera):
    """daily_folder strategy: end_time = file mtime, start = mtime - duration."""
    camera.recording_path = str(tmp_path)
    camera.save()
    mp4 = tmp_path / "clip.mp4"
    mp4.write_bytes(b"fake mp4")

    with (
        patch(
            "app.services.scanner._probe_video",
            return_value={"duration": 60.0, "creation_time": None},
        ),
        patch("app.services.scanner._make_thumbnail", return_value=None),
        patch("app.services.scanner._file_hash", return_value="abc123"),
    ):
        result = scanner.scan_camera(camera)

    assert result == (1, 0)
    rec = Recording.get(Recording.camera == camera)
    assert rec.status == "ready"
    assert rec.duration_secs == 60.0
    # end_time ≈ mtime; start_time = end_time - 60s
    assert rec.end_time is not None
    assert abs((rec.end_time - rec.start_time).total_seconds() - 60) < 2


def test_scan_camera_indexes_with_creation_time(tmp_path, camera):
    """When creation_time is embedded, start_time uses it directly."""
    camera.recording_path = str(tmp_path)
    camera.save()
    mp4 = tmp_path / "clip.mp4"
    mp4.write_bytes(b"fake mp4")
    ct = datetime(2026, 6, 15, 14, 30, 0)  # tz-naive UTC (matches DB convention)

    with (
        patch(
            "app.services.scanner._probe_video",
            return_value={"duration": 120.0, "creation_time": ct},
        ),
        patch("app.services.scanner._make_thumbnail", return_value=None),
        patch("app.services.scanner._file_hash", return_value="abc123"),
    ):
        result = scanner.scan_camera(camera)

    assert result == (1, 0)
    rec = Recording.get(Recording.camera == camera)
    assert rec.status == "ready"
    assert rec.duration_secs == 120.0
    assert rec.start_time == ct
    assert rec.end_time is not None
    assert abs((rec.end_time - rec.start_time).total_seconds() - 120) < 1


def test_scan_camera_handles_probe_failure(tmp_path, camera):
    """When ffprobe fails, mtime still gives valid start/end → ready with null duration."""
    camera.recording_path = str(tmp_path)
    camera.save()
    mp4 = tmp_path / "bad.mp4"
    mp4.write_bytes(b"junk")
    with (
        patch(
            "app.services.scanner._probe_video",
            return_value={"duration": None, "creation_time": None},
        ),
        patch("app.services.scanner._make_thumbnail", return_value=None),
        patch("app.services.scanner._file_hash", return_value="aaa"),
    ):
        result = scanner.scan_camera(camera)
    assert result == (1, 0)
    rec = Recording.get(Recording.camera == camera)
    # mtime-based: no duration but still indexable as ready
    assert rec.status == "ready"
    assert rec.duration_secs is None


def test_scan_all_iterates_enabled_cameras(camera):
    with patch("app.services.scanner.scan_camera", return_value=(3, 0)) as mock:
        results = scanner.scan_all()
    mock.assert_called_once_with(camera)
    assert results[camera.name] == 3


def test_scan_all_skips_disabled_cameras(camera):
    camera.enabled = False
    camera.save()
    with patch("app.services.scanner.scan_camera") as _mock:
        scanner.scan_all()


def test_is_scanning_false_by_default():
    from app.services import scanner

    assert scanner.is_scanning() is False


def test_scan_single_camera_missing_returns_empty(test_db):
    assert scanner.scan_single_camera(999999) == {}


def test_scan_single_camera_disabled_returns_empty(camera):
    camera.enabled = False
    camera.save()
    with patch("app.services.scanner.scan_camera") as mock:
        assert scanner.scan_single_camera(camera.id) == {}
    mock.assert_not_called()


def test_scan_single_camera_force_scans_disabled(camera):
    """force=True (manual scan) scans even a disabled camera."""
    camera.enabled = False
    camera.save()
    with (
        patch("app.services.scanner.cleanup_missing", return_value=0),
        patch("app.services.scanner.scan_camera", return_value=(1, 0)) as mock,
    ):
        result = scanner.scan_single_camera(camera.id, force=True)
    mock.assert_called_once()
    assert result == {camera.name: 1}


def test_scan_single_camera_scans_and_records_event(camera):
    from app.models.scan_event import ScanEvent

    with (
        patch("app.services.scanner.cleanup_missing", return_value=1),
        patch("app.services.scanner.scan_camera", return_value=(2, 1)) as mock,
    ):
        result = scanner.scan_single_camera(camera.id)

    mock.assert_called_once()
    assert result == {camera.name: 2}
    # A completed ScanEvent for this single camera is recorded.
    event = ScanEvent.select().order_by(ScanEvent.id.desc()).first()
    assert event.cameras_scanned == 1
    assert event.new_recordings == 2
    assert event.skipped_recordings == 1
    assert event.status == "ok"
    # Detail summarizes new / already-indexed / pruned counts.
    assert "+2 new" in event.detail
    assert "1 already indexed" in event.detail
    assert "1 pruned" in event.detail


def test_scan_single_camera_releases_lock_on_event_create_failure(camera):
    """The scan lock must be released even if ScanEvent.create() itself raises."""
    with patch("app.models.scan_event.ScanEvent.create", side_effect=RuntimeError("db down")):
        with pytest.raises(RuntimeError):
            scanner.scan_single_camera(camera.id)
    # Lock must not be stuck held.
    assert scanner.is_scanning() is False


def test_scan_single_camera_skips_when_already_scanning(camera):
    """If this camera's scan lock is held, the scheduled scan skips gracefully."""
    with scanner._acquire_scan_lock(camera.id):
        assert scanner.scan_single_camera(camera.id) == {}


def test_is_scanning_is_per_camera(test_db):
    """is_scanning() reports global state with no arg, and per-camera with an id."""
    from app.models.camera import Camera

    a = Camera.create(name="A", recording_path="/tmp/a")
    b = Camera.create(name="B", recording_path="/tmp/b")

    assert scanner.is_scanning() is False
    with scanner._acquire_scan_lock(a.id):
        assert scanner.is_scanning() is True  # some camera is scanning
        assert scanner.is_scanning(a.id) is True  # A specifically
        assert scanner.is_scanning(b.id) is False  # B is free
    assert scanner.is_scanning() is False


def test_scan_single_camera_runs_while_other_camera_scanning(test_db):
    """Per-camera lock: scanning camera B is not blocked by camera A's scan."""
    from app.models.camera import Camera

    a = Camera.create(name="A", recording_path="/tmp/a")
    b = Camera.create(name="B", recording_path="/tmp/b")

    with (
        scanner._acquire_scan_lock(a.id),  # A is mid-scan
        patch("app.services.scanner.cleanup_missing", return_value=0),
        patch("app.services.scanner.scan_camera", return_value=(1, 0)) as mock,
    ):
        result = scanner.scan_single_camera(b.id)

    mock.assert_called_once()
    assert result == {b.name: 1}


def test_scan_single_camera_records_error_on_failure(camera):
    from app.models.scan_event import ScanEvent

    with (
        patch("app.services.scanner.cleanup_missing", return_value=0),
        patch("app.services.scanner.scan_camera", side_effect=RuntimeError("boom")),
    ):
        assert scanner.scan_single_camera(camera.id) == {}

    event = ScanEvent.select().order_by(ScanEvent.id.desc()).first()
    assert event.status == "error"
    assert "boom" in event.detail


def test_cleanup_missing_removes_stale_records(tmp_path, camera):
    from datetime import datetime

    from app.models.recording import Recording

    # Create a DB record pointing to a file that doesn't exist
    Recording.create(
        camera=camera,
        file_path=str(tmp_path / "gone.mp4"),
        start_time=datetime.now(),
        status="ready",
    )
    assert Recording.select().where(Recording.camera == camera).count() == 1
    removed = scanner.cleanup_missing(camera)
    assert removed == 1
    assert Recording.select().where(Recording.camera == camera).count() == 0


def test_cleanup_missing_keeps_existing_files(tmp_path, camera):
    from datetime import datetime

    from app.models.recording import Recording

    f = tmp_path / "real.mp4"
    f.write_bytes(b"data")
    Recording.create(
        camera=camera,
        file_path=str(f),
        start_time=datetime.now(),
        status="ready",
    )
    removed = scanner.cleanup_missing(camera)
    assert removed == 0
    assert Recording.select().where(Recording.camera == camera).count() == 1


def test_scan_camera_skips_non_video_files(tmp_path, camera):
    camera.recording_path = str(tmp_path)
    camera.save()
    (tmp_path / "readme.txt").write_bytes(b"not a video")
    (tmp_path / "image.jpg").write_bytes(b"not a video either")
    added, skipped = scanner.scan_camera(camera)
    assert added == 0 and skipped == 0


def test_scan_camera_integrity_error_counts_as_skipped(tmp_path, camera):
    """If RecordingCreate raises IntegrityError (race), file is counted as skipped."""
    from unittest.mock import patch

    from peewee import IntegrityError

    camera.recording_path = str(tmp_path)
    camera.save()
    (tmp_path / "dup.mp4").write_bytes(b"fake")
    with (
        patch(
            "app.services.scanner._probe_video",
            return_value={"duration": 10.0, "creation_time": None},
        ),
        patch("app.services.scanner._make_thumbnail", return_value=None),
        patch("app.services.scanner._file_hash", return_value="abc"),
        patch("app.services.scanner.Recording.create", side_effect=IntegrityError),
    ):
        added, skipped = scanner.scan_camera(camera)
    assert added == 0 and skipped == 1


def test_scan_camera_general_exception_creates_error_record(tmp_path, camera):
    """Non-IntegrityError exceptions create an error-status Recording."""
    from unittest.mock import patch

    camera.recording_path = str(tmp_path)
    camera.save()
    (tmp_path / "bad.mp4").write_bytes(b"fake")
    with (
        patch(
            "app.services.scanner._probe_video",
            return_value={"duration": 60.0, "creation_time": None},
        ),
        patch("app.services.scanner._make_thumbnail", side_effect=RuntimeError("boom")),
    ):
        added, skipped = scanner.scan_camera(camera)
    assert added == 1
    from app.models.recording import Recording

    rec = Recording.get(Recording.camera == camera)
    assert rec.status == "error"


def test_make_thumbnail_returns_existing_without_rerunning(tmp_path):
    """If the thumbnail already exists on disk it is returned without calling ffmpeg."""
    from unittest.mock import patch

    with patch("app.services.scanner.settings") as mock_settings:
        mock_settings.thumbnail_dir = str(tmp_path)
        video = tmp_path / "clip.mp4"
        video.write_bytes(b"x")
        # Pre-create the thumbnail
        thumb = tmp_path / "clip.jpg"
        thumb.write_bytes(b"jpg")
        with patch("app.services.scanner.ffmpeg") as mock_ffmpeg:
            result = scanner._make_thumbnail(video)
        mock_ffmpeg.input.assert_not_called()
    assert result == str(thumb)


def test_scan_all_skips_camera_already_scanning(camera):
    """scan_all skips a camera whose per-camera lock is held, rather than blocking."""
    from app.models.scan_event import ScanEvent

    with (
        patch("app.services.scanner.scan_camera") as mock_scan,
        scanner._acquire_scan_lock(camera.id),  # this camera is "being scanned"
    ):
        result = scanner.scan_all()
    # The only camera was locked → skipped; scan_camera never ran for it.
    mock_scan.assert_not_called()
    assert result == {}
    # cameras_scanned reflects cameras actually processed, not the enabled total.
    event = ScanEvent.select().order_by(ScanEvent.id.desc()).first()
    assert event.cameras_scanned == 0


def test_scan_all_cameras_scanned_excludes_skipped(test_db):
    """With one camera locked and one free, cameras_scanned counts only the free one."""
    from app.models.camera import Camera
    from app.models.scan_event import ScanEvent

    busy = Camera.create(name="Busy", recording_path="/tmp/busy")
    free = Camera.create(name="Free", recording_path="/tmp/free")

    with (
        patch("app.services.scanner.cleanup_missing", return_value=0),
        patch("app.services.scanner.scan_camera", return_value=(2, 0)) as mock_scan,
        scanner._acquire_scan_lock(busy.id),  # `busy` is already being scanned
    ):
        result = scanner.scan_all()

    assert result == {free.name: 2}
    mock_scan.assert_called_once_with(free)
    event = ScanEvent.select().order_by(ScanEvent.id.desc()).first()
    assert event.cameras_scanned == 1  # only `free`, `busy` skipped


def test_scan_all_marks_event_error_on_exception(camera):
    """An exception inside scan_all sets the ScanEvent status to 'error'."""
    from unittest.mock import patch

    from app.models.scan_event import ScanEvent

    with (
        patch("app.services.scanner.cleanup_missing", side_effect=RuntimeError("disk gone")),
    ):
        scanner.scan_all()
    event = ScanEvent.select().order_by(ScanEvent.id.desc()).first()
    assert event is not None
    assert event.status == "error"
    assert "disk gone" in (event.detail or "")


def test_scan_camera_locked_runs_scan(tmp_path, camera):
    """scan_camera_locked acquires lock and delegates to scan_camera."""
    from unittest.mock import patch

    camera.recording_path = str(tmp_path)
    camera.save()
    with (
        patch("app.services.scanner.scan_camera", return_value=(2, 1)) as mock_scan,
    ):
        result = scanner.scan_camera_locked(camera)
    mock_scan.assert_called_once_with(camera)
    assert result == (2, 1)


def test_scan_camera_error_record_creation_also_fails(tmp_path, camera):
    """When the error-status Recording.create itself raises, the exception is silently swallowed."""
    from unittest.mock import patch

    camera.recording_path = str(tmp_path)
    camera.save()
    (tmp_path / "bad.mp4").write_bytes(b"fake")

    original_create = Recording.create
    call_count = [0]

    def flaky_create(**kwargs):
        call_count[0] += 1
        if call_count[0] <= 2:
            # First call: ready record fails. Second call: error record also fails.
            raise Exception("DB write failed")
        return original_create(**kwargs)

    with (
        patch(
            "app.services.scanner._probe_video",
            return_value={"duration": None, "creation_time": None},
        ),
        patch("app.services.scanner.Recording.create", side_effect=flaky_create),
        patch("app.services.scanner._make_thumbnail", return_value=None),
    ):
        added, skipped = scanner.scan_camera(camera)
    assert added == 0


def test_scan_all_no_enabled_cameras_produces_ok_event(test_db):
    """scan_all with no enabled cameras returns {} and records a ScanEvent cameras_scanned=0."""
    from app.models.scan_event import ScanEvent
    from app.services import scanner as sc

    result = sc.scan_all()
    assert result == {}
    event = ScanEvent.select().order_by(ScanEvent.id.desc()).first()
    assert event is not None
    assert event.cameras_scanned == 0
    assert event.status == "ok"


def test_make_thumbnail_returns_none_when_mkdir_fails(tmp_path):
    """_make_thumbnail returns None (without propagating) when mkdir raises OSError."""
    from unittest.mock import MagicMock, patch

    mock_ffmpeg = MagicMock()
    with patch("app.services.scanner.settings") as mock_settings:
        mock_settings.thumbnail_dir = str(tmp_path / "no_perms")
        video = tmp_path / "clip.mp4"
        video.write_bytes(b"x")
        with (
            patch("app.services.scanner.ffmpeg", mock_ffmpeg),
            patch("pathlib.Path.mkdir", side_effect=OSError("permission denied")),
        ):
            result = scanner._make_thumbnail(video)
    assert result is None
