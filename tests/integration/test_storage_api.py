"""Integration tests for the storage stats API."""


def test_storage_stats_empty(client):
    r = client.get("/api/v1/storage/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["indexed_recordings"] == 0
    assert body["indexed_size_bytes"] == 0
    assert body["cameras"] == []
    assert body["last_scan_finished"] is None


def test_storage_stats_with_data(client, recording, camera):
    r = client.get("/api/v1/storage/stats")
    assert r.status_code == 200
    body = r.json()
    assert body["indexed_recordings"] == 1
    assert body["indexed_size_bytes"] == 1024 * 1024
    assert len(body["cameras"]) == 1
    cam = body["cameras"][0]
    assert cam["id"] == camera.id
    assert cam["recordings"] == 1
    assert cam["latest_video_at"] is not None


def test_storage_stats_last_scan(client, test_db):
    from datetime import datetime, timezone

    from app.models.scan_event import ScanEvent

    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
        finished_at=datetime(2024, 1, 15, 10, 1, tzinfo=timezone.utc),
        cameras_scanned=1,
        status="ok",
    )
    r = client.get("/api/v1/storage/stats")
    assert r.json()["last_scan_finished"] is not None
