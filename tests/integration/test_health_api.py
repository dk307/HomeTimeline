"""Integration tests for the health endpoint."""

from unittest.mock import patch


def test_health_ok(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] is True


def test_health_recordings_empty(client):
    r = client.get("/api/v1/health/recordings")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 0
    assert body["corrupted"] == 0
    assert body["duplicate_paths"] == 0
    assert body["orphaned"] == 0


def test_health_recordings_counts(client, camera):
    from datetime import datetime

    from app.models.recording import Recording

    Recording.create(
        camera=camera,
        file_path="/tmp/a.mp4",
        start_time=datetime(2024, 1, 1, 0, 0),
        end_time=datetime(2024, 1, 1, 1, 0),
        status="ready",
    )
    Recording.create(
        camera=camera,
        file_path="/tmp/b.mp4",
        start_time=datetime(2024, 1, 1, 1, 0),
        end_time=datetime(2024, 1, 1, 2, 0),
        status="error",
    )
    r = client.get("/api/v1/health/recordings")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2
    assert body["corrupted"] == 1
    assert body["duplicate_paths"] == 0
    assert body["orphaned"] == 0


def test_health_recordings_orphaned(client, camera):
    """Orphaned recording (camera_id points to non-existent camera) is counted."""
    from datetime import datetime

    from app.database import db
    from app.models.recording import Recording

    rec = Recording.create(
        camera=camera,
        file_path="/tmp/orphan.mp4",
        start_time=datetime(2024, 1, 1, 0, 0),
        status="ready",
    )
    # Break FK: point recording at a non-existent camera_id
    db.execute_sql("PRAGMA foreign_keys = OFF")
    try:
        db.execute_sql(f"UPDATE recordings SET camera_id = 99999 WHERE id = {rec.id}")
    finally:
        db.execute_sql("PRAGMA foreign_keys = ON")

    r = client.get("/api/v1/health/recordings")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["orphaned"] == 1


def test_health_recordings_degraded(client):
    """health/recordings returns 'degraded' when the DB raises."""
    from app.models.recording import Recording

    with patch.object(Recording, "select", side_effect=Exception("db boom")):
        r = client.get("/api/v1/health/recordings")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["error"] == "db boom"
    assert body["total"] is None


def test_health_degraded_when_db_fails(client):
    """Health returns 'degraded' when the DB execute_sql raises."""
    with patch("app.api.health.db.execute_sql", side_effect=Exception("db down")):
        r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["db"] is False
