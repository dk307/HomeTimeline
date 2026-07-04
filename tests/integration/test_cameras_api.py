"""Integration tests for the cameras API."""


def test_list_cameras_empty(client):
    r = client.get("/api/v1/cameras/")
    assert r.status_code == 200
    assert r.json() == []


def test_create_camera(client, location):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": "Front Cam",
            "recording_path": "/mnt/front",
            "location_id": location.id,
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Front Cam"
    assert body["enabled"] is True
    assert body["location_id"] == location.id
    assert body["time_source"] == "mtime"  # default
    assert body["scan_interval_minutes"] is None  # default: Never


def test_create_camera_with_scan_interval(client):
    r = client.post(
        "/api/v1/cameras/",
        json={"name": "Auto Cam", "recording_path": "/mnt/auto", "scan_interval_minutes": 30},
    )
    assert r.status_code == 201
    assert r.json()["scan_interval_minutes"] == 30


def test_create_camera_scan_interval_out_of_range(client):
    too_low = client.post(
        "/api/v1/cameras/",
        json={"name": "A", "recording_path": "/mnt/a", "scan_interval_minutes": 0},
    )
    too_high = client.post(
        "/api/v1/cameras/",
        json={"name": "B", "recording_path": "/mnt/b", "scan_interval_minutes": 1441},
    )
    assert too_low.status_code == 422
    assert too_high.status_code == 422


def test_update_camera_scan_interval(client, camera):
    r = client.patch(f"/api/v1/cameras/{camera.id}", json={"scan_interval_minutes": 45})
    assert r.status_code == 200
    assert r.json()["scan_interval_minutes"] == 45


def test_update_camera_scan_interval_to_never(client, camera):
    """Explicit null switches a camera back to Never (manual-only)."""
    client.patch(f"/api/v1/cameras/{camera.id}", json={"scan_interval_minutes": 20})
    r = client.patch(f"/api/v1/cameras/{camera.id}", json={"scan_interval_minutes": None})
    assert r.status_code == 200
    assert r.json()["scan_interval_minutes"] is None


def test_create_camera_with_time_source(client):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": "Old Cam",
            "recording_path": "/mnt/old",
            "time_source": "folder_date",
        },
    )
    assert r.status_code == 201
    assert r.json()["time_source"] == "folder_date"


def test_create_camera_invalid_location(client):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": "Orphan",
            "recording_path": "/mnt/x",
            "location_id": 9999,
        },
    )
    assert r.status_code == 404


def test_get_camera(client, camera):
    r = client.get(f"/api/v1/cameras/{camera.id}")
    assert r.status_code == 200
    assert r.json()["id"] == camera.id


def test_get_camera_not_found(client):
    r = client.get("/api/v1/cameras/9999")
    assert r.status_code == 404


def test_update_camera(client, camera):
    r = client.patch(f"/api/v1/cameras/{camera.id}", json={"enabled": False})
    assert r.status_code == 200
    assert r.json()["enabled"] is False


def test_update_camera_time_source(client, camera):
    r = client.patch(f"/api/v1/cameras/{camera.id}", json={"time_source": "folder_date"})
    assert r.status_code == 200
    assert r.json()["time_source"] == "folder_date"


def test_delete_camera(client, camera):
    r = client.delete(f"/api/v1/cameras/{camera.id}")
    assert r.status_code == 204
    assert client.get(f"/api/v1/cameras/{camera.id}").status_code == 404


def test_list_cameras_filter_enabled(client, camera):
    r = client.get("/api/v1/cameras/?enabled=true")
    assert len(r.json()) == 1
    client.patch(f"/api/v1/cameras/{camera.id}", json={"enabled": False})
    assert client.get("/api/v1/cameras/?enabled=true").json() == []


def test_drop_camera_index(client, camera, recording):
    # Recording exists
    assert client.get(f"/api/v1/recordings/?camera_id={camera.id}").json() != []
    r = client.delete(f"/api/v1/cameras/{camera.id}/recordings")
    assert r.status_code == 200
    assert r.json()["deleted"] == 1
    assert client.get(f"/api/v1/recordings/?camera_id={camera.id}").json() == []


def test_drop_camera_index_not_found(client):
    r = client.delete("/api/v1/cameras/9999/recordings")
    assert r.status_code == 404


def test_reindex_camera(client, camera):
    r = client.post(f"/api/v1/cameras/{camera.id}/reindex")
    assert r.status_code == 202
    assert r.json()["status"] == "started"


def test_reindex_camera_not_found(client):
    r = client.post("/api/v1/cameras/9999/reindex")
    assert r.status_code == 404


def test_update_camera_not_found(client):
    r = client.patch("/api/v1/cameras/9999", json={"enabled": False})
    assert r.status_code == 404


def test_update_camera_invalid_location(client, camera):
    r = client.patch(f"/api/v1/cameras/{camera.id}", json={"location_id": 9999})
    assert r.status_code == 404


def test_delete_camera_not_found(client):
    r = client.delete("/api/v1/cameras/9999")
    assert r.status_code == 404


def test_reindex_camera_already_scanning(client, camera):
    from unittest.mock import patch

    with patch("app.services.scanner.is_scanning", return_value=True):
        r = client.post(f"/api/v1/cameras/{camera.id}/reindex")
    assert r.status_code == 409


def test_scan_camera_endpoint(client, camera):
    """POST /scan runs a non-destructive per-camera scan and records a ScanEvent."""
    from app.models.scan_event import ScanEvent

    before = ScanEvent.select().count()
    r = client.post(f"/api/v1/cameras/{camera.id}/scan")
    assert r.status_code == 202
    body = r.json()
    assert body["status"] == "started"
    assert body["camera"] == camera.name
    # TestClient runs the background task after the response — a scan event exists.
    assert ScanEvent.select().count() == before + 1


def test_scan_camera_endpoint_not_found(client):
    r = client.post("/api/v1/cameras/9999/scan")
    assert r.status_code == 404


def test_scan_camera_endpoint_conflict_when_scanning(client, camera):
    from unittest.mock import patch

    with patch("app.services.scanner.is_scanning", return_value=True):
        r = client.post(f"/api/v1/cameras/{camera.id}/scan")
    assert r.status_code == 409


def test_scan_camera_endpoint_conflict_is_per_camera(client, camera):
    """A scan in progress for one camera returns 409 for that camera only —
    another camera can still be scanned concurrently."""
    from app.models.camera import Camera
    from app.services import scanner

    other = Camera.create(name="Other", recording_path="/tmp/other")
    with scanner._acquire_scan_lock(camera.id):  # `camera` is mid-scan
        busy = client.post(f"/api/v1/cameras/{camera.id}/scan")
        free = client.post(f"/api/v1/cameras/{other.id}/scan")
    assert busy.status_code == 409
    assert free.status_code == 202


def test_scan_camera_endpoint_runs_when_disabled(client, camera):
    """A manual scan overrides the schedule — it runs even for a disabled camera."""
    from app.models.scan_event import ScanEvent

    camera.enabled = False
    camera.save()
    before = ScanEvent.select().count()
    r = client.post(f"/api/v1/cameras/{camera.id}/scan")
    assert r.status_code == 202
    assert ScanEvent.select().count() == before + 1


def test_camera_stats_empty(client, camera):
    r = client.get(f"/api/v1/cameras/{camera.id}/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["id"] == camera.id
    assert data["name"] == camera.name
    assert data["total_recordings"] == 0
    assert data["total_duration_secs"] == 0
    assert data["indexed_size_bytes"] == 0
    assert data["last_video_at"] is None


def test_camera_stats_with_recording(client, camera, recording):
    r = client.get(f"/api/v1/cameras/{camera.id}/stats")
    assert r.status_code == 200
    data = r.json()
    assert data["total_recordings"] == 1
    assert data["total_duration_secs"] == 60.0
    assert data["indexed_size_bytes"] == 1024 * 1024
    assert data["last_video_at"] is not None


def test_camera_stats_last_video_prefers_active_recording(client, camera):
    """An active clip (null end_time) with the newest start must win last_video_at,
    not an older completed clip — ordering uses COALESCE(end_time, start_time)."""
    from datetime import datetime

    from app.models.recording import Recording

    Recording.create(
        camera=camera,
        file_path="/tmp/test_recordings/old.mp4",
        start_time=datetime(2024, 1, 15, 10, 0),
        end_time=datetime(2024, 1, 15, 10, 5),
        status="ready",
    )
    Recording.create(
        camera=camera,
        file_path="/tmp/test_recordings/active.mp4",
        start_time=datetime(2024, 1, 16, 9, 0),
        end_time=None,  # still recording — must not be sorted last and missed
        status="ready",
    )

    data = client.get(f"/api/v1/cameras/{camera.id}/stats").json()
    # The active clip's start (Jan 16) is the most recent effective timestamp.
    assert data["last_video_at"].startswith("2024-01-16")


def test_camera_stats_not_found(client):
    r = client.get("/api/v1/cameras/9999/stats")
    assert r.status_code == 404
