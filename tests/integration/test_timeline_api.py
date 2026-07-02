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


def test_timeline_end_time_none_included(client, camera):
    """A recording with end_time=None whose start_time falls in the range must appear."""
    from datetime import datetime

    from app.models.recording import Recording

    rec = Recording.create(
        camera=camera,
        file_path="/tmp/live.mp4",
        start_time=datetime(2024, 1, 15, 10, 0),
        end_time=None,
        status="ready",
    )
    r = client.get("/api/v1/timeline/?date=2024-01-15")
    assert r.status_code == 200
    ids = [s["recording_id"] for s in r.json()]
    assert rec.id in ids, "Recording with null end_time must appear in timeline"


def test_timeline_days_over_limit_returns_422(client):
    """`days` has an upper limit of 90; requesting 100 must return 422."""
    r = client.get("/api/v1/timeline/?date=2024-01-15&days=100")
    assert r.status_code == 422


def test_timeline_bad_camera_ids_ignored(client, recording):
    """Non-numeric values in camera_ids are silently ignored; full results returned."""
    r = client.get("/api/v1/timeline/?date=2024-01-15&camera_ids=bad,abc")
    assert r.status_code == 200
    assert len(r.json()) >= 1


def test_timeline_start_time_at_day_end_excluded(client, camera):
    """A recording whose start_time equals day_end must not be returned."""
    from datetime import datetime

    from app.models.recording import Recording

    Recording.create(
        camera=camera,
        file_path="/tmp/boundary.mp4",
        start_time=datetime(2024, 1, 16, 0, 0, 0),
        end_time=datetime(2024, 1, 16, 0, 1, 0),
        status="ready",
    )
    r = client.get("/api/v1/timeline/?date=2024-01-15")
    assert r.status_code == 200
    for seg in r.json():
        assert seg["start_time"] < "2024-01-16T00:00:00"
