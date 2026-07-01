"""Integration tests for the timeline API."""


def test_timeline_returns_segments(client, recording, camera):
    r = client.get("/api/v1/timeline/?date=2024-01-15")
    assert r.status_code == 200
    segments = r.json()
    assert len(segments) == 1
    s = segments[0]
    assert s["camera_id"] == camera.id
    assert s["camera_name"] == camera.name
    assert s["recording_id"] == recording.id
    assert s["duration_secs"] == 60.0


def test_timeline_empty_for_other_date(client, recording):
    r = client.get("/api/v1/timeline/?date=2024-01-20")
    assert r.status_code == 200
    assert r.json() == []


def test_timeline_invalid_date(client):
    r = client.get("/api/v1/timeline/?date=notadate")
    assert r.status_code == 400


def test_timeline_filter_by_camera(client, recording, camera):
    r = client.get(f"/api/v1/timeline/?date=2024-01-15&camera_ids={camera.id}")
    assert len(r.json()) == 1

    r2 = client.get("/api/v1/timeline/?date=2024-01-15&camera_ids=9999")
    assert r2.json() == []


def test_timeline_excludes_error_recordings(client, camera):
    from datetime import datetime

    from app.models.recording import Recording

    Recording.create(
        camera=camera,
        file_path="/tmp/bad.mp4",
        start_time=datetime(2024, 1, 15, 12, 0),
        end_time=datetime(2024, 1, 15, 12, 1),
        status="error",
    )
    r = client.get("/api/v1/timeline/?date=2024-01-15")
    assert all(s["status"] == "ready" for s in r.json())


def test_health(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] in ("ok", "degraded")
