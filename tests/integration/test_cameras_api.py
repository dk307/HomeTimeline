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
