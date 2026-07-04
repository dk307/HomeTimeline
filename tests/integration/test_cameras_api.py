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
    assert body["camera_type"] == "generic"  # default
    assert body["clip_strategy"] == "daily_folder"  # default
    assert body["scan_interval_minutes"] is None  # default: Never
    assert body["has_password"] is False
    assert "password" not in body  # never exposed


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


def test_create_hikvision_camera_hides_password(client):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": "Hik Cam",
            "recording_path": "/mnt/hik",
            "camera_type": "hikvision",
            "host": "192.168.1.10",
            "username": "admin",
            "password": "secret",
            "download_interval_minutes": 30,
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["camera_type"] == "hikvision"
    assert body["host"] == "192.168.1.10"
    assert body["username"] == "admin"
    assert body["download_interval_minutes"] == 30
    assert body["has_password"] is True
    assert "password" not in body


def test_create_camera_rejects_unknown_type(client):
    r = client.post(
        "/api/v1/cameras/",
        json={"name": "X", "recording_path": "/mnt/x", "camera_type": "bogus"},
    )
    assert r.status_code == 422


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


def test_update_camera_password_only_when_provided(client, camera):
    """A blank/omitted password must not overwrite a stored one."""
    from app.models.camera import Camera

    client.patch(
        f"/api/v1/cameras/{camera.id}",
        json={"camera_type": "hikvision", "host": "10.0.0.5", "password": "pw1"},
    )
    assert Camera.get_by_id(camera.id).password == "pw1"
    # Update something else without sending a password → password unchanged.
    r = client.patch(f"/api/v1/cameras/{camera.id}", json={"host": "10.0.0.6"})
    assert r.status_code == 200
    assert r.json()["has_password"] is True
    assert Camera.get_by_id(camera.id).password == "pw1"


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
    assert data["last_downloaded_at"] is None


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


# --------------------------------------------------------------- downloading


def _make_hikvision(client, name="Hik"):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": name,
            "recording_path": "/tmp/test_recordings",
            "camera_type": "hikvision",
            "host": "192.168.1.10",
            "username": "admin",
            "password": "secret",
        },
    )
    assert r.status_code == 201
    return r.json()


def test_download_endpoint_starts(client):
    """POST /download schedules a background download for a Hikvision camera."""
    from unittest.mock import patch

    cam = _make_hikvision(client)
    with patch("app.services.downloader.download_single_camera", return_value={}) as mock:
        r = client.post(f"/api/v1/cameras/{cam['id']}/download")
    assert r.status_code == 202
    assert r.json()["camera"] == cam["name"]
    mock.assert_called_once()


def test_download_endpoint_rejects_generic(client, camera):
    r = client.post(f"/api/v1/cameras/{camera.id}/download")
    assert r.status_code == 400


def test_download_endpoint_not_found(client):
    r = client.post("/api/v1/cameras/9999/download")
    assert r.status_code == 404


def test_download_endpoint_conflict_when_downloading(client):
    from app.services import downloader

    cam = _make_hikvision(client)
    with downloader._acquire_download_lock(cam["id"]):  # camera is mid-download
        r = client.post(f"/api/v1/cameras/{cam['id']}/download")
    assert r.status_code == 409


def test_download_status(client):
    cam = _make_hikvision(client)
    r = client.get(f"/api/v1/cameras/{cam['id']}/download-status")
    assert r.status_code == 200
    body = r.json()
    assert body["running"] is False
    assert body["last_downloaded_at"] is None


def test_download_events_empty(client):
    cam = _make_hikvision(client)
    r = client.get(f"/api/v1/cameras/{cam['id']}/download-events")
    assert r.status_code == 200
    assert r.json() == []


def test_download_events_lists_history(client):
    from app.models.camera import Camera
    from app.models.download_event import DownloadEvent

    cam = _make_hikvision(client)
    DownloadEvent.create(
        camera=Camera.get_by_id(cam["id"]),
        downloaded=3,
        indexed=2,
        status="ok",
        detail="Hik · 3 downloaded",
    )
    body = client.get(f"/api/v1/cameras/{cam['id']}/download-events").json()
    assert len(body) == 1
    assert body[0]["downloaded"] == 3
    assert body[0]["indexed"] == 2
    assert body[0]["status"] == "ok"


def test_device_info_rejects_generic(client, camera):
    r = client.get(f"/api/v1/cameras/{camera.id}/device-info")
    assert r.status_code == 400


def test_update_camera_download_interval(client):
    cam = _make_hikvision(client)
    r = client.patch(f"/api/v1/cameras/{cam['id']}", json={"download_interval_minutes": 90})
    assert r.status_code == 200
    assert r.json()["download_interval_minutes"] == 90


def test_download_status_not_found(client):
    assert client.get("/api/v1/cameras/9999/download-status").status_code == 404


def test_download_events_not_found(client):
    assert client.get("/api/v1/cameras/9999/download-events").status_code == 404


def test_device_info_not_found(client):
    assert client.get("/api/v1/cameras/9999/device-info").status_code == 404


def test_device_info_no_host_configured(client):
    r = client.post(
        "/api/v1/cameras/",
        json={"name": "NoHost", "recording_path": "/tmp/nh", "camera_type": "hikvision"},
    )
    cid = r.json()["id"]
    body = client.get(f"/api/v1/cameras/{cid}/device-info").json()
    assert body["available"] is False
    assert "No host" in body["error"]


def test_device_info_returns_details(client):
    from unittest.mock import AsyncMock, patch

    cam = _make_hikvision(client)
    fake = AsyncMock(return_value={"model": "DS-2CD", "firmwareVersion": "V5.7"})
    with patch("app.services.hikvision.HikvisionClient.get_device_info", new=fake):
        r = client.get(f"/api/v1/cameras/{cam['id']}/device-info")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is True
    assert body["info"]["model"] == "DS-2CD"
    assert body["rtsp_url"].startswith("rtsp://")
    assert "snapshot_url" in body


def test_device_info_unreachable_is_graceful(client):
    from unittest.mock import AsyncMock, patch

    cam = _make_hikvision(client)
    fail = AsyncMock(side_effect=RuntimeError("timeout"))
    with patch("app.services.hikvision.HikvisionClient.get_device_info", new=fail):
        r = client.get(f"/api/v1/cameras/{cam['id']}/device-info")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] is False
    assert "timeout" in body["error"]


# ----------------------------------------------------------- stop scan/download


def test_scan_status_endpoint(client, camera):
    r = client.get(f"/api/v1/cameras/{camera.id}/scan-status")
    assert r.status_code == 200
    assert r.json()["running"] is False


def test_scan_status_not_found(client):
    assert client.get("/api/v1/cameras/9999/scan-status").status_code == 404


def test_stop_scan_not_running(client, camera):
    r = client.post(f"/api/v1/cameras/{camera.id}/scan/stop")
    assert r.status_code == 200
    assert r.json()["status"] == "not_running"


def test_stop_scan_when_running(client, camera):
    from app.services import scanner

    with scanner._acquire_scan_lock(camera.id):  # camera is mid-scan
        r = client.post(f"/api/v1/cameras/{camera.id}/scan/stop")
    assert r.status_code == 200
    assert r.json()["status"] == "stopping"


def test_stop_scan_not_found(client):
    assert client.post("/api/v1/cameras/9999/scan/stop").status_code == 404


def test_stop_download_not_running(client):
    cam = _make_hikvision(client)
    r = client.post(f"/api/v1/cameras/{cam['id']}/download/stop")
    assert r.status_code == 200
    assert r.json()["status"] == "not_running"


def test_stop_download_when_running(client):
    from app.services import downloader

    cam = _make_hikvision(client)
    with downloader._acquire_download_lock(cam["id"]):  # camera is mid-download
        r = client.post(f"/api/v1/cameras/{cam['id']}/download/stop")
    assert r.status_code == 200
    assert r.json()["status"] == "stopping"


def test_stop_download_not_found(client):
    assert client.post("/api/v1/cameras/9999/download/stop").status_code == 404
