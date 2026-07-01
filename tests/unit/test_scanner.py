"""Unit tests for the scanner service."""

from datetime import datetime
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


def test_times_from_mtime_with_duration(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    start, end = scanner._times_from_mtime(f, 3600.0)
    assert end is not None
    assert (end - start).seconds == 3600
    # end should be close to the file's mtime
    mtime = datetime.fromtimestamp(f.stat().st_mtime)
    assert abs((end - mtime).total_seconds()) < 2


def test_times_from_mtime_without_duration(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    start, end = scanner._times_from_mtime(f, None)
    assert end is None or end == start


def test_date_from_folder_detects_format(tmp_path):
    deep = tmp_path / "cam" / "2024-06-15" / "clips"
    deep.mkdir(parents=True)
    f = deep / "clip.mp4"
    f.write_bytes(b"x")
    d = scanner._date_from_folder(f)
    assert d is not None
    assert d.year == 2024 and d.month == 6 and d.day == 15


def test_date_from_folder_none_when_no_match(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    assert scanner._date_from_folder(f) is None


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
    with patch("app.services.scanner._probe_duration") as mock:
        assert scanner.scan_camera(camera) == (0, 1)
    mock.assert_not_called()


def test_scan_camera_indexes_with_mtime(tmp_path, camera):
    """Default time_source=mtime: end_time = file mtime, start = mtime - duration."""
    camera.recording_path = str(tmp_path)
    camera.time_source = "mtime"
    camera.save()
    mp4 = tmp_path / "clip.mp4"
    mp4.write_bytes(b"fake mp4")

    with (
        patch("app.services.scanner._probe_duration", return_value=60.0),
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


def test_scan_camera_indexes_with_folder_date(tmp_path, camera):
    """time_source=folder_date uses the date folder name."""
    dated = tmp_path / "2024-03-10"
    dated.mkdir()
    camera.recording_path = str(tmp_path)
    camera.time_source = "folder_date"
    camera.save()
    mp4 = dated / "clip.mp4"
    mp4.write_bytes(b"fake")

    with (
        patch("app.services.scanner._probe_duration", return_value=300.0),
        patch("app.services.scanner._make_thumbnail", return_value=None),
        patch("app.services.scanner._file_hash", return_value="def456"),
    ):
        result = scanner.scan_camera(camera)

    assert result == (1, 0)
    rec = Recording.get(Recording.camera == camera)
    assert rec.start_time.date() == datetime(2024, 3, 10).date()


def test_scan_camera_handles_probe_failure(tmp_path, camera):
    """When ffprobe fails, mtime still gives valid start/end → ready with null duration."""
    camera.recording_path = str(tmp_path)
    camera.save()
    mp4 = tmp_path / "bad.mp4"
    mp4.write_bytes(b"junk")
    with (
        patch("app.services.scanner._probe_duration", return_value=None),
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
