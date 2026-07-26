"""Unit tests for the Recording model."""

from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from app.models.recording import Recording


def test_delete_files_removes_video_and_thumbnail(tmp_path):
    video = tmp_path / "clip.mp4"
    thumb = tmp_path / "clip.mp4.jpg"
    video.write_bytes(b"v" * 1024)
    thumb.write_bytes(b"t" * 256)

    rec = Recording(
        id=999001,
        file_path=str(video),
        thumbnail_path=str(thumb),
        start_time=datetime.now(),
        status="ready",
    )
    freed = rec.delete_files()

    assert not video.exists()
    assert not thumb.exists()
    assert freed == 1024 + 256


def test_delete_files_no_thumbnail(tmp_path):
    video = tmp_path / "clip.mp4"
    video.write_bytes(b"v" * 512)

    rec = Recording(
        id=999002,
        file_path=str(video),
        thumbnail_path=None,
        start_time=datetime.now(),
        status="ready",
    )
    freed = rec.delete_files()

    assert not video.exists()
    assert freed == 512


def test_delete_files_already_missing(tmp_path):
    rec = Recording(
        id=999003,
        file_path=str(tmp_path / "gone.mp4"),
        thumbnail_path=str(tmp_path / "gone.mp4.jpg"),
        start_time=datetime.now(),
        status="ready",
    )
    freed = rec.delete_files()
    assert freed == 0


def test_delete_files_unlinked_video_skips_thumbnail(tmp_path):
    """If the video unlink fails, thumbnail is still attempted."""
    video = tmp_path / "locked.mp4"
    video.write_bytes(b"v" * 128)
    thumb = tmp_path / "locked.mp4.jpg"
    thumb.write_bytes(b"t" * 64)

    rec = Recording(
        id=999004,
        file_path=str(video),
        thumbnail_path=str(thumb),
        start_time=datetime.now(),
        status="ready",
    )

    original_unlink = Path.unlink
    call_count = 0

    def flaky_unlink(self, *args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise OSError("permission denied")
        return original_unlink(self, *args, **kwargs)

    with patch.object(Path, "unlink", flaky_unlink):
        freed = rec.delete_files()

    assert video.exists()
    assert not thumb.exists()
    assert freed == 64
