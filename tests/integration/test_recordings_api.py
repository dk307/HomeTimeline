"""Integration tests for the recordings API."""

from datetime import datetime


def test_list_recordings(client, recording):
    r = client.get("/api/v1/recordings/")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_list_recordings_by_date(client, recording):
    r = client.get("/api/v1/recordings/?date=2024-01-15")
    assert len(r.json()) == 1
    assert client.get("/api/v1/recordings/?date=2024-01-16").json() == []


def test_list_recordings_invalid_date(client):
    assert client.get("/api/v1/recordings/?date=bad").status_code == 400


def test_get_recording(client, recording):
    r = client.get(f"/api/v1/recordings/{recording.id}")
    assert r.status_code == 200
    assert r.json()["duration_secs"] == 60.0


def test_get_recording_not_found(client):
    assert client.get("/api/v1/recordings/9999").status_code == 404


def test_update_recording_notes(client, recording):
    r = client.patch(f"/api/v1/recordings/{recording.id}", json={"notes": "Suspicious"})
    assert r.status_code == 200
    assert r.json()["notes"] == "Suspicious"


def test_delete_recording(client, recording):
    assert client.delete(f"/api/v1/recordings/{recording.id}").status_code == 204


def test_list_recordings_by_camera(client, recording, camera):
    assert len(client.get(f"/api/v1/recordings/?camera_id={camera.id}").json()) == 1
    assert client.get("/api/v1/recordings/?camera_id=9999").json() == []


def test_stream_recording_not_found(client):
    assert client.get("/api/v1/recordings/9999/stream").status_code == 404


def test_stream_recording_file_missing(client, recording):
    """File doesn't exist on disk in test env → 404."""
    r = client.get(f"/api/v1/recordings/{recording.id}/stream")
    assert r.status_code == 404


def test_stream_recording_serves_file(client, camera, tmp_path):
    """When file exists, stream endpoint returns 200 with video/mp4 content-type."""
    from unittest.mock import patch

    from app.models.recording import Recording

    video = tmp_path / "clip.mp4"
    video.write_bytes(b"fake video data")
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time=datetime(2024, 1, 15, 10, 0),
        file_size_bytes=15,
        status="ready",
    )
    # Mock ffmpeg subprocess so test doesn't need real ffmpeg
    with patch("app.api.recordings.subprocess.Popen") as mock_popen:
        import io

        mock_popen.return_value.stdout = io.BytesIO(b"fmp4data")
        mock_popen.return_value.kill = lambda: None
        mock_popen.return_value.wait = lambda: None
        r = client.get(f"/api/v1/recordings/{rec.id}/stream")
    assert r.status_code == 200
    assert "video" in r.headers["content-type"]


def test_download_range_request(client, camera, tmp_path):
    """Download endpoint supports Range requests."""
    from app.models.recording import Recording

    data = b"0123456789ABCDEF"
    video = tmp_path / "clip.mp4"
    video.write_bytes(data)
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time=datetime(2024, 1, 15, 10, 0),
        file_size_bytes=len(data),
        status="ready",
    )
    r = client.get(
        f"/api/v1/recordings/{rec.id}/download",
        headers={"Range": "bytes=0-7"},
    )
    assert r.status_code == 206
    assert r.content == data[:8]
    assert "content-range" in r.headers


def test_download_recording(client, camera, tmp_path):
    """Download endpoint sets Content-Disposition: attachment."""
    from app.models.recording import Recording

    video = tmp_path / "clip.mp4"
    video.write_bytes(b"video bytes")
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time=datetime(2024, 1, 15, 10, 0),
        file_size_bytes=11,
        status="ready",
    )
    r = client.get(f"/api/v1/recordings/{rec.id}/download")
    assert r.status_code == 200
    assert "attachment" in r.headers.get("content-disposition", "")
