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
    assert body["camera_type"] == "hikvision"  # default
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
    assert client.get(f"/api/v1/recordings/?camera_id={camera.id}").json()["recordings"] != []
    r = client.delete(f"/api/v1/cameras/{camera.id}/recordings")
    assert r.status_code == 200
    assert r.json()["deleted"] == 1
    assert client.get(f"/api/v1/recordings/?camera_id={camera.id}").json()["recordings"] == []


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


def test_reindex_camera_records_error_event(client, camera):
    """If the background scan raises, the ScanEvent is finalized as an error."""
    from unittest.mock import patch

    from app.models.scan_event import ScanEvent

    before = ScanEvent.select().count()
    with patch("app.services.scanner.scan_camera", side_effect=Exception("boom")):
        # TestClient runs the background task after the response returns.
        r = client.post(f"/api/v1/cameras/{camera.id}/reindex")
    assert r.status_code == 202
    assert ScanEvent.select().count() == before + 1
    event = ScanEvent.select().order_by(ScanEvent.id.desc()).get()
    assert event.status == "error"
    assert event.detail == "boom"
    assert event.finished_at is not None


def test_reindex_camera_records_lock_conflict_event(client, camera):
    """A RuntimeError (lock lost to the scheduler mid-task) is recorded as an error."""
    from unittest.mock import patch

    from app.models.scan_event import ScanEvent

    with patch(
        "app.services.scanner._acquire_scan_lock",
        side_effect=RuntimeError("scan already running"),
    ):
        r = client.post(f"/api/v1/cameras/{camera.id}/reindex")
    assert r.status_code == 202
    event = ScanEvent.select().order_by(ScanEvent.id.desc()).get()
    assert event.status == "error"
    assert event.detail == "scan already running"
    assert event.finished_at is not None


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


def test_download_endpoint_rejects_aqura(client, camera):
    camera.camera_type = "aqura"
    camera.save()
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


def test_device_info_rejects_aqura(client, camera):
    camera.camera_type = "aqura"
    camera.save()
    r = client.get(f"/api/v1/cameras/{camera.id}/device-info")
    assert r.status_code == 400


def test_update_camera_download_interval(client):
    cam = _make_hikvision(client)
    r = client.patch(f"/api/v1/cameras/{cam['id']}", json={"download_interval_minutes": 90})
    assert r.status_code == 200
    assert r.json()["download_interval_minutes"] == 90


def test_download_status_not_found(client):
    assert client.get("/api/v1/cameras/9999/download-status").status_code == 404


# --------------------------------------------------------------- purging


def test_purge_endpoint_starts(client):
    """POST /purge schedules a background purge for a configured Hikvision camera."""
    from unittest.mock import patch

    cam = _make_hikvision(client)
    client.patch(f"/api/v1/cameras/{cam['id']}", json={"purge_older_than_days": 30})
    with patch("app.services.purger.purge_single_camera", return_value={}) as mock:
        r = client.post(f"/api/v1/cameras/{cam['id']}/purge")
    assert r.status_code == 202
    assert r.json()["camera"] == cam["name"]
    mock.assert_called_once()


def test_purge_endpoint_rejects_aqura(client, camera):
    camera.camera_type = "aqura"
    camera.save()
    r = client.post(f"/api/v1/cameras/{camera.id}/purge")
    assert r.status_code == 400


def test_purge_endpoint_rejects_when_retention_never(client):
    """Without a retention window there is nothing to purge — reject with 400."""
    cam = _make_hikvision(client)
    r = client.post(f"/api/v1/cameras/{cam['id']}/purge")
    assert r.status_code == 400


def test_purge_endpoint_not_found(client):
    assert client.post("/api/v1/cameras/9999/purge").status_code == 404


def test_purge_endpoint_conflict_when_purging(client):
    from app.services import purger

    cam = _make_hikvision(client)
    client.patch(f"/api/v1/cameras/{cam['id']}", json={"purge_older_than_days": 30})
    with purger._acquire_purge_lock(cam["id"]):  # camera is mid-purge
        r = client.post(f"/api/v1/cameras/{cam['id']}/purge")
    assert r.status_code == 409


def test_purge_status(client):
    cam = _make_hikvision(client)
    r = client.get(f"/api/v1/cameras/{cam['id']}/purge-status")
    assert r.status_code == 200
    body = r.json()
    assert body["running"] is False
    assert body["last_purged_at"] is None


def test_purge_status_not_found(client):
    assert client.get("/api/v1/cameras/9999/purge-status").status_code == 404


def test_stop_purge_reports_not_running(client):
    cam = _make_hikvision(client)
    r = client.post(f"/api/v1/cameras/{cam['id']}/purge/stop")
    assert r.status_code == 200
    assert r.json()["status"] == "not_running"


def test_stop_purge_reports_stopping_when_active(client):
    from app.services import purger

    cam = _make_hikvision(client)
    with purger._acquire_purge_lock(cam["id"]):
        r = client.post(f"/api/v1/cameras/{cam['id']}/purge/stop")
    assert r.json()["status"] == "stopping"


def test_stop_purge_not_found(client):
    assert client.post("/api/v1/cameras/9999/purge/stop").status_code == 404


def test_update_camera_purge_settings(client):
    cam = _make_hikvision(client)
    r = client.patch(
        f"/api/v1/cameras/{cam['id']}",
        json={"purge_older_than_days": 14, "purge_interval_minutes": 720},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["purge_older_than_days"] == 14
    assert body["purge_interval_minutes"] == 720


def test_update_camera_purge_to_never(client):
    cam = _make_hikvision(client)
    client.patch(f"/api/v1/cameras/{cam['id']}", json={"purge_older_than_days": 14})
    r = client.patch(f"/api/v1/cameras/{cam['id']}", json={"purge_older_than_days": None})
    assert r.status_code == 200
    assert r.json()["purge_older_than_days"] is None


# --------------------------------------------------------------- bulk (all)


def test_download_all_status_reflects_availability(client, camera):
    # Only an aqura camera exists → bulk download unavailable.
    camera.camera_type = "aqura"
    camera.save()
    r = client.get("/api/v1/cameras/download-all/status")
    assert r.status_code == 200
    assert r.json() == {"running": False, "available": False}
    # Add a Hikvision camera → available.
    _make_hikvision(client)
    assert client.get("/api/v1/cameras/download-all/status").json()["available"] is True


def test_download_all_endpoint_starts(client):
    from unittest.mock import patch

    _make_hikvision(client)
    with patch("app.services.downloader.download_all", return_value={}) as mock:
        r = client.post("/api/v1/cameras/download-all")
    assert r.status_code == 202
    assert r.json()["status"] == "started"
    mock.assert_called_once()


def test_download_all_endpoint_rejects_when_no_hikvision(client, camera):
    camera.camera_type = "aqura"
    camera.save()
    assert client.post("/api/v1/cameras/download-all").status_code == 400


def test_purge_all_status_reflects_availability(client):
    cam = _make_hikvision(client)
    # Hikvision but no retention → unavailable.
    assert client.get("/api/v1/cameras/purge-all/status").json() == {
        "running": False,
        "available": False,
    }
    client.patch(f"/api/v1/cameras/{cam['id']}", json={"purge_older_than_days": 30})
    assert client.get("/api/v1/cameras/purge-all/status").json()["available"] is True


def test_purge_all_endpoint_starts(client):
    from unittest.mock import patch

    cam = _make_hikvision(client)
    client.patch(f"/api/v1/cameras/{cam['id']}", json={"purge_older_than_days": 30})
    with patch("app.services.purger.purge_all", return_value={}) as mock:
        r = client.post("/api/v1/cameras/purge-all")
    assert r.status_code == 202
    assert r.json()["status"] == "started"
    mock.assert_called_once()


def test_purge_all_endpoint_rejects_when_none_configured(client):
    _make_hikvision(client)  # Hikvision but no retention set
    assert client.post("/api/v1/cameras/purge-all").status_code == 400


def test_download_events_not_found(client):
    assert client.get("/api/v1/cameras/9999/download-events").status_code == 404


def test_download_events_rejects_nonpositive_limit(client):
    cam = _make_hikvision(client)
    assert client.get(f"/api/v1/cameras/{cam['id']}/download-events?limit=-5").status_code == 422
    assert client.get(f"/api/v1/cameras/{cam['id']}/download-events?limit=0").status_code == 422


def test_device_info_not_found(client):
    assert client.get("/api/v1/cameras/9999/device-info").status_code == 404


def test_device_info_no_host_configured(client):
    r = client.post(
        "/api/v1/cameras/",
        json={"name": "NoHost", "recording_path": "/tmp/nh", "camera_type": "hikvision"},
    )
    assert r.status_code == 201
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


# --------------------------------------------------------------- live streams


def test_streams_rejects_aqura_without_streams(client, camera):
    camera.camera_type = "aqura"
    camera.save()
    body = client.get(f"/api/v1/cameras/{camera.id}/streams").json()
    assert body["available"] is False
    assert "stream" in body["reason"].lower()


def test_streams_not_found(client):
    assert client.get("/api/v1/cameras/9999/streams").status_code == 404


def test_streams_no_host_configured(client):
    r = client.post(
        "/api/v1/cameras/",
        json={"name": "NoHost", "recording_path": "/tmp/nh", "camera_type": "hikvision"},
    )
    assert r.status_code == 201
    body = client.get(f"/api/v1/cameras/{r.json()['id']}/streams").json()
    assert body["available"] is False
    assert "host" in body["reason"].lower()


def test_streams_unavailable_when_go2rtc_down(client):
    from unittest.mock import patch

    cam = _make_hikvision(client)
    with patch("app.services.go2rtc.is_available", return_value=False):
        body = client.get(f"/api/v1/cameras/{cam['id']}/streams").json()
    assert body["available"] is False
    assert "not running" in body["reason"]


def test_streams_register_failure_is_graceful(client):
    from unittest.mock import patch

    cam = _make_hikvision(client)
    with (
        patch("app.services.go2rtc.is_available", return_value=True),
        patch("app.services.go2rtc.ensure_camera_streams", return_value=None),
    ):
        body = client.get(f"/api/v1/cameras/{cam['id']}/streams").json()
    assert body["available"] is False
    assert "register" in body["reason"].lower()


def test_streams_lists_main_and_sub(client):
    from unittest.mock import patch

    cam = _make_hikvision(client)
    names = {"main": f"cam{cam['id']}_main", "sub": f"cam{cam['id']}_sub"}
    with (
        patch("app.services.go2rtc.is_available", return_value=True),
        patch("app.services.go2rtc.ensure_camera_streams", return_value=names),
    ):
        body = client.get(f"/api/v1/cameras/{cam['id']}/streams").json()
    assert body["available"] is True
    qualities = [s["quality"] for s in body["streams"]]
    assert qualities == ["main", "sub"]
    assert body["streams"][0]["name"] == names["main"]


def test_live_ws_rejects_invalid_src(client):
    from starlette.websockets import WebSocketDisconnect

    # A name that doesn't match cam<id>_(main|sub) is rejected before accept.
    try:
        with client.websocket_connect("/api/v1/cameras/live/ws?src=evil"):
            pass
        raise AssertionError("expected the connection to be rejected")
    except WebSocketDisconnect:
        pass


def test_live_ws_rejects_when_go2rtc_down(client):
    from unittest.mock import patch

    from starlette.websockets import WebSocketDisconnect

    cam = _make_hikvision(client)
    # Valid src, but the streaming service is down → connection is closed pre-accept.
    with patch("app.services.go2rtc.is_available", return_value=False):
        try:
            with client.websocket_connect(f"/api/v1/cameras/live/ws?src=cam{cam['id']}_main"):
                pass
            raise AssertionError("expected the connection to be rejected")
        except WebSocketDisconnect:
            pass


class _WSMsg:
    def __init__(self, type, data):
        self.type = type
        self.data = data


class _FakeUpstream:
    """Stand-in for a go2rtc client WebSocket used by the proxy.

    Yields ``msgs`` to the client direction; if ``block`` is set it then stays
    open (so the client→upstream direction can run) until cancelled. Records
    frames relayed from the browser in ``sent``.
    """

    def __init__(self, msgs, block, sent):
        self._msgs = list(msgs)
        self._block = block
        self.sent = sent

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def __aiter__(self):
        self._it = iter(self._msgs)
        return self

    async def __anext__(self):
        import asyncio

        try:
            return next(self._it)
        except StopIteration:
            if self._block:
                await asyncio.Event().wait()  # stay open until cancelled
            raise StopAsyncIteration

    async def send_str(self, s):
        self.sent.append(("text", s))

    async def send_bytes(self, b):
        self.sent.append(("bytes", b))


def _fake_session_cls(msgs, block, sent, connect_exc=None):
    import aiohttp

    class _FakeSession:
        def __init__(self, *a, **k):
            pass

        def ws_connect(self, url):
            if connect_exc:
                raise aiohttp.ClientError("upstream down")
            return _FakeUpstream(msgs, block, sent)

        async def close(self):
            pass

    return _FakeSession


def test_live_ws_relays_upstream_frames(client):
    """The proxy relays go2rtc text + binary frames, and handles upstream CLOSE."""
    from unittest.mock import patch

    import aiohttp

    msgs = [
        _WSMsg(aiohttp.WSMsgType.BINARY, b"seg-data"),
        _WSMsg(aiohttp.WSMsgType.TEXT, '{"type":"webrtc/answer","value":"sdp"}'),
        _WSMsg(aiohttp.WSMsgType.CLOSE, None),
    ]
    cam = _make_hikvision(client)
    with (
        patch("app.services.go2rtc.is_available", return_value=True),
        patch("app.api.cameras.aiohttp.ClientSession", _fake_session_cls(msgs, False, [])),
    ):
        with client.websocket_connect(f"/api/v1/cameras/live/ws?src=cam{cam['id']}_main") as ws:
            assert ws.receive_bytes() == b"seg-data"
            assert '"webrtc/answer"' in ws.receive_text()


def test_live_ws_relays_client_frames(client):
    """Frames the browser sends (WebRTC offer/candidate) are relayed to go2rtc."""
    from unittest.mock import patch

    sent: list = []
    cam = _make_hikvision(client)
    with (
        patch("app.services.go2rtc.is_available", return_value=True),
        patch("app.api.cameras.aiohttp.ClientSession", _fake_session_cls([], True, sent)),
    ):
        with client.websocket_connect(f"/api/v1/cameras/live/ws?src=cam{cam['id']}_sub") as ws:
            ws.send_text('{"type":"webrtc/offer","value":"x"}')
            ws.send_bytes(b"candidate")
    assert ("text", '{"type":"webrtc/offer","value":"x"}') in sent
    assert ("bytes", b"candidate") in sent


def test_live_ws_handles_upstream_connect_error(client):
    """If the upstream go2rtc socket can't be opened, the proxy closes cleanly."""
    from unittest.mock import patch

    cam = _make_hikvision(client)
    with (
        patch("app.services.go2rtc.is_available", return_value=True),
        patch(
            "app.api.cameras.aiohttp.ClientSession",
            _fake_session_cls([], False, [], connect_exc=True),
        ),
    ):
        # Accept succeeds, then the upstream connect raises → server closes the socket.
        with client.websocket_connect(f"/api/v1/cameras/live/ws?src=cam{cam['id']}_main") as ws:
            import contextlib

            from starlette.websockets import WebSocketDisconnect

            with contextlib.suppress(WebSocketDisconnect):
                ws.receive()  # server-side close arrives here


# --------------------------------------------------------------- Aqura camera


def _make_aqura(client, name="Aqura"):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": name,
            "recording_path": "/tmp/test_recordings",
            "camera_type": "aqura",
            "stream_url_1": "rtsp://10.0.0.1:554/Streaming/Channels/101",
            "stream_url_2": "rtsp://10.0.0.1:554/Streaming/Channels/102",
            "stream_url_3": "rtsp://10.0.0.1:554/Streaming/Channels/103",
            "aqura_username": "admin",
            "aqura_password": "secret",
        },
    )
    assert r.status_code == 201
    return r.json()


def test_create_aqura_camera(client):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": "Aqura Cam",
            "recording_path": "/mnt/aqura",
            "camera_type": "aqura",
            "stream_url_1": "rtsp://10.0.0.1:554/1",
            "stream_url_2": "rtsp://10.0.0.1:554/2",
            "stream_url_3": "rtsp://10.0.0.1:554/3",
            "aqura_username": "admin",
            "aqura_password": "secret",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["camera_type"] == "aqura"
    assert body["stream_url_1"] == "rtsp://10.0.0.1:554/1"
    assert body["stream_url_2"] == "rtsp://10.0.0.1:554/2"
    assert body["stream_url_3"] == "rtsp://10.0.0.1:554/3"
    assert body["aqura_username"] == "admin"
    assert body["aqura_has_password"] is True
    assert "aqura_password" not in body


def test_create_aqura_camera_without_password(client):
    r = client.post(
        "/api/v1/cameras/",
        json={
            "name": "Aqura No PW",
            "recording_path": "/mnt/aqura2",
            "camera_type": "aqura",
            "stream_url_1": "rtsp://10.0.0.2:554/1",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["aqura_has_password"] is False


def test_update_aqura_camera_stream_urls(client):
    cam = _make_aqura(client)
    r = client.patch(
        f"/api/v1/cameras/{cam['id']}",
        json={"stream_url_1": "rtsp://10.0.0.2:554/1"},
    )
    assert r.status_code == 200
    assert r.json()["stream_url_1"] == "rtsp://10.0.0.2:554/1"


def test_update_aqura_camera_password_only_when_provided(client):
    from app.models.camera import Camera

    cam = _make_aqura(client)
    assert Camera.get_by_id(cam["id"]).aqura_password == "secret"
    # Update something else without sending a password → password unchanged.
    r = client.patch(f"/api/v1/cameras/{cam['id']}", json={"stream_url_1": "rtsp://10.0.0.2:554/1"})
    assert r.status_code == 200
    assert Camera.get_by_id(cam["id"]).aqura_password == "secret"


def test_aqura_camera_streams_returns_3_channels(client):
    from unittest.mock import patch

    cam = _make_aqura(client)
    names = {"1": f"cam{cam['id']}_1", "2": f"cam{cam['id']}_2", "3": f"cam{cam['id']}_3"}
    with (
        patch("app.services.go2rtc.is_available", return_value=True),
        patch("app.services.go2rtc.ensure_camera_streams", return_value=names),
    ):
        body = client.get(f"/api/v1/cameras/{cam['id']}/streams").json()
    assert body["available"] is True
    qualities = [s["quality"] for s in body["streams"]]
    assert qualities == ["1", "2", "3"]
    assert body["streams"][0]["label"] == "Channel1"


def test_aqura_camera_streams_unavailable_when_no_urls(client):
    from unittest.mock import patch

    r = client.post(
        "/api/v1/cameras/",
        json={"name": "Aqura No URL", "recording_path": "/tmp/nh", "camera_type": "aqura"},
    )
    assert r.status_code == 201
    with patch("app.services.go2rtc.is_available", return_value=True):
        body = client.get(f"/api/v1/cameras/{r.json()['id']}/streams").json()
    assert body["available"] is False
    assert "No stream URLs" in body["reason"]


def test_aqura_camera_device_info_returns_400(client):
    cam = _make_aqura(client)
    r = client.get(f"/api/v1/cameras/{cam['id']}/device-info")
    assert r.status_code == 400


def test_aqura_camera_download_rejected(client):
    cam = _make_aqura(client)
    r = client.post(f"/api/v1/cameras/{cam['id']}/download")
    assert r.status_code == 400


def test_aqura_camera_purge_rejected(client):
    cam = _make_aqura(client)
    r = client.post(f"/api/v1/cameras/{cam['id']}/purge")
    assert r.status_code == 400


def test_streams_rejects_aqura_when_go2rtc_down(client, camera):
    """Aqura camera with configured streams returns unavailable when go2rtc is down."""
    from unittest.mock import patch

    camera.camera_type = "aqura"
    camera.stream_url_1 = "rtsp://192.168.2.144:8554/Channel1"
    camera.save()
    with patch("app.services.go2rtc.is_available", return_value=False):
        body = client.get(f"/api/v1/cameras/{camera.id}/streams").json()
    assert body["available"] is False
    assert "not running" in body["reason"].lower()
