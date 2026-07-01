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
