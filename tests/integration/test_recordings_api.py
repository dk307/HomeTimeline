"""Integration tests for the recordings API."""

from datetime import datetime


def test_list_recordings(client, recording):
    r = client.get("/api/v1/recordings/")
    assert r.status_code == 200
    data = r.json()
    assert len(data["recordings"]) == 1
    assert data["total"] == 1


def test_list_recordings_by_date(client, recording):
    r = client.get("/api/v1/recordings/?date=2024-01-15")
    assert len(r.json()["recordings"]) == 1
    assert client.get("/api/v1/recordings/?date=2024-01-16").json()["recordings"] == []


def test_list_recordings_invalid_date(client):
    assert client.get("/api/v1/recordings/?date=bad").status_code == 400


def test_list_recordings_date_uses_app_timezone(client, camera):
    """Date filtering uses the app timezone (like the timeline/daily-counts), so a
    clip at 01:23 UTC — the previous evening in LA — is returned for the LA date."""
    from app.models.app_settings import AppSettings
    from app.models.recording import Recording
    from app.services.tz import invalidate_tz_cache

    s = AppSettings.get_instance()
    s.timezone = "America/Los_Angeles"
    s.save()
    invalidate_tz_cache()
    try:
        Recording.create(
            camera=camera,
            file_path="/tmp/test_recordings/la.mp4",
            start_time=datetime(2026, 7, 4, 1, 23, 0),  # naive UTC == Jul 3 18:23 LA
            end_time=datetime(2026, 7, 4, 1, 28, 0),
            status="ready",
        )
        # Belongs to July 3 in LA — present there, absent from July 4.
        by_jul3 = client.get(f"/api/v1/recordings/?camera_id={camera.id}&date=2026-07-03")
        assert len(by_jul3.json()["recordings"]) == 1
        by_jul4 = client.get(f"/api/v1/recordings/?camera_id={camera.id}&date=2026-07-04")
        assert by_jul4.json()["recordings"] == []
    finally:
        invalidate_tz_cache()


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
    assert len(client.get(f"/api/v1/recordings/?camera_id={camera.id}").json()["recordings"]) == 1
    assert client.get("/api/v1/recordings/?camera_id=9999").json()["recordings"] == []


def test_daily_counts_zero_filled(client):
    """Empty DB → one zero-count entry per day in the window."""
    r = client.get("/api/v1/recordings/daily-counts?days=14")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 14
    assert all(set(d) == {"date", "count", "total_secs"} for d in data)
    assert all(d["count"] == 0 for d in data)
    assert all(d["total_secs"] == 0 for d in data)
    # Dates are contiguous and strictly ascending by one day.
    from datetime import date, timedelta

    days = [date.fromisoformat(d["date"]) for d in data]
    assert all(b - a == timedelta(days=1) for a, b in zip(days, days[1:]))


def test_daily_counts_uncapped(client, camera):
    """Counts every recording — not truncated by the list endpoint's 200 cap."""
    from app.models.recording import Recording

    now = datetime.now()
    rows = [
        {
            "camera": camera,
            "file_path": f"/tmp/test_recordings/r{i}.mp4",
            "start_time": now,
            "duration_secs": 1.0,
            "file_size_bytes": 1,
            "status": "ready",
        }
        for i in range(250)
    ]
    Recording.insert_many(rows).execute()

    data = client.get("/api/v1/recordings/daily-counts?days=30").json()
    assert len(data) == 30
    # All 250 fall within the window; total must reflect every one (> the 200 cap).
    assert sum(d["count"] for d in data) == 250


def test_daily_counts_by_camera(client, camera):
    """The camera_id filter restricts counts (and clip length) to one camera."""
    from app.models.camera import Camera
    from app.models.recording import Recording

    other = Camera.create(name="Other Cam", recording_path="/tmp/other")
    now = datetime.now()
    Recording.create(
        camera=camera,
        file_path="/tmp/test_recordings/mine.mp4",
        start_time=now,
        duration_secs=30.0,
        file_size_bytes=1,
        status="ready",
    )
    Recording.create(
        camera=other,
        file_path="/tmp/other/theirs.mp4",
        start_time=now,
        duration_secs=90.0,
        file_size_bytes=1,
        status="ready",
    )

    data = client.get(f"/api/v1/recordings/daily-counts?days=7&camera_id={camera.id}").json()
    # Only the target camera's single 30s clip is counted.
    assert sum(d["count"] for d in data) == 1
    assert sum(d["total_secs"] for d in data) == 30


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


def test_download_range_truncated_file(client, camera, tmp_path, monkeypatch):
    """A file that shrank after its size was measured hits the stream's safety
    break: the read reaches EOF before the requested range length is served."""
    import os

    from app.models.recording import Recording

    video = tmp_path / "short.mp4"
    video.write_bytes(b"abcd")  # only 4 real bytes on disk
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time=datetime(2024, 1, 15, 10, 0),
        file_size_bytes=4,
        status="ready",
    )

    real_stat = os.stat

    def fake_stat(path, *args, **kwargs):
        st = real_stat(path, *args, **kwargs)
        if str(path).endswith("short.mp4"):
            fields = list(st)
            fields[6] = 100  # over-report st_size → range asks for more than exists
            return os.stat_result(fields)
        return st

    monkeypatch.setattr(os, "stat", fake_stat)

    r = client.get(
        f"/api/v1/recordings/{rec.id}/download",
        headers={"Range": "bytes=0-99"},
    )
    # The range claims 100 bytes but only 4 exist; the generator breaks at EOF
    # and returns just the available bytes rather than hanging.
    assert r.status_code == 206
    assert r.content == b"abcd"


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


def test_update_recording_not_found(client):
    r = client.patch("/api/v1/recordings/9999", json={"notes": "x"})
    assert r.status_code == 404


def test_delete_recording_not_found(client):
    r = client.delete("/api/v1/recordings/9999")
    assert r.status_code == 404


def test_download_not_found(client):
    r = client.get("/api/v1/recordings/9999/download")
    assert r.status_code == 404


def test_download_file_missing(client, recording):
    """Recording exists in DB but file is gone from disk → 404."""
    r = client.get(f"/api/v1/recordings/{recording.id}/download")
    assert r.status_code == 404


def test_list_recordings_status_filter(client, camera):
    from datetime import datetime

    from app.models.recording import Recording

    Recording.create(
        camera=camera,
        file_path="/tmp/err.mp4",
        start_time=datetime(2024, 1, 15, 11, 0),
        status="error",
    )
    r = client.get("/api/v1/recordings/?status=error")
    assert r.status_code == 200
    recs = r.json()["recordings"]
    assert len(recs) >= 1
    assert all(rec["status"] == "error" for rec in recs)


def test_list_recordings_days_parameter(client, camera):
    from datetime import datetime

    from app.models.recording import Recording

    Recording.create(
        camera=camera,
        file_path="/tmp/day2.mp4",
        start_time=datetime(2024, 1, 16, 10, 0),
        end_time=datetime(2024, 1, 16, 10, 1),
        status="ready",
    )
    # days=1 starting 2024-01-15 → only records on Jan 15 (none created)
    r1 = client.get("/api/v1/recordings/?date=2024-01-15&days=1")
    assert len(r1.json()["recordings"]) == 0

    # days=1 starting 2024-01-16 → should include the Jan 16 recording
    r2 = client.get("/api/v1/recordings/?date=2024-01-16&days=1")
    assert len(r2.json()["recordings"]) == 1


def test_list_recordings_offset(client, camera):
    from datetime import datetime

    from app.models.recording import Recording

    for i in range(3):
        Recording.create(
            camera=camera,
            file_path=f"/tmp/r{i}.mp4",
            start_time=datetime(2024, 1, 15, 10 + i, 0),
            status="ready",
        )
    all_recs = client.get("/api/v1/recordings/").json()["recordings"]
    offset_recs = client.get("/api/v1/recordings/?offset=1").json()["recordings"]
    assert len(offset_recs) == len(all_recs) - 1


def test_download_full_file(client, camera, tmp_path):
    """Full download (no Range header) returns 200 with correct content."""
    from app.models.recording import Recording

    data = b"full video content"
    video = tmp_path / "full.mp4"
    video.write_bytes(data)
    rec = Recording.create(
        camera=camera,
        file_path=str(video),
        start_time=datetime(2024, 1, 15, 10, 0),
        file_size_bytes=len(data),
        status="ready",
    )
    r = client.get(f"/api/v1/recordings/{rec.id}/download")
    assert r.status_code == 200
    assert r.content == data
