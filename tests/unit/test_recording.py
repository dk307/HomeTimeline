"""Unit tests for Recording.delete_files()."""

from unittest.mock import patch

import pytest

from app.models.recording import Recording


def test_delete_files_removes_video_and_thumbnail(tmp_path, camera):
    """Both the video file and its thumbnail are deleted; freed bytes are returned."""
    video = tmp_path / "clip.mp4"
    thumb = tmp_path / "clip.mp4.jpg"
    video.write_bytes(b"v" * 4096)
    thumb.write_bytes(b"t" * 512)
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time="2024-01-15 10:00:00",
        thumbnail_path=str(thumb),
        status="ready",
    )
    freed = rec.delete_files()
    assert freed == 4096 + 512
    assert not video.exists()
    assert not thumb.exists()


def test_delete_files_no_thumbnail(tmp_path, camera):
    """Only the video file is deleted when thumbnail_path is None."""
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"v" * 2048)
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time="2024-01-15 10:00:00",
        thumbnail_path=None,
        status="ready",
    )
    freed = rec.delete_files()
    assert freed == 2048
    assert not video.exists()


def test_delete_files_already_missing(tmp_path, camera):
    """Files already gone → freed=0, no exception."""
    rec = Recording.create(
        camera=camera,
        file_path=str(tmp_path / "gone.mp4"),
        start_time="2024-01-15 10:00:00",
        thumbnail_path=str(tmp_path / "gone.mp4.jpg"),
        status="ready",
    )
    assert rec.delete_files() == 0


def test_delete_files_unlink_failure_raises(tmp_path, camera):
    """If unlink fails with a non-FileNotFoundError OSError, it propagates so
    callers can skip DB removal and allow retry."""
    video = tmp_path / "locked.mp4"
    video.write_bytes(b"v" * 1024)
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time="2024-01-15 10:00:00",
        status="ready",
    )
    with patch("pathlib.Path.unlink", side_effect=OSError("permission denied")):
        with pytest.raises(OSError, match="permission denied"):
            rec.delete_files()
    assert video.exists()
