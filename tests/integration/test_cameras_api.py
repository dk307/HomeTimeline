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
