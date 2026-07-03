"""Integration tests for the activity (scan events) API."""

from datetime import datetime, timezone


def test_activity_empty(client):
    r = client.get("/api/v1/activity")
    assert r.status_code == 200
    assert r.json() == []


def test_activity_lists_scan_events(client, test_db):
    from app.models.scan_event import ScanEvent

    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
        finished_at=datetime(2024, 1, 15, 10, 1, tzinfo=timezone.utc),
        cameras_scanned=2,
        new_recordings=5,
        skipped_recordings=3,
        status="ok",
        detail="cam1 · +5 new | cam2 · 3 already indexed",
    )
    r = client.get("/api/v1/activity")
    assert r.status_code == 200
    events = r.json()
    assert len(events) == 1
    e = events[0]
    assert e["cameras_scanned"] == 2
    assert e["new_recordings"] == 5
    assert e["skipped_recordings"] == 3
    assert e["status"] == "ok"
    assert e["started_at"] is not None
    assert e["finished_at"] is not None
    # Timestamps must be tz-aware output — sign-agnostic so it holds under any
    # local timezone (Z, +HH:MM, or -HH:MM after the time part).
    started_time = e["started_at"].split("T", 1)[1]
    assert e["started_at"].endswith("Z") or "+" in started_time or "-" in started_time


def test_activity_limit(client, test_db):
    from app.models.scan_event import ScanEvent

    for i in range(5):
        ScanEvent.create(
            started_at=datetime(2024, 1, i + 1, 10, 0, tzinfo=timezone.utc),
            cameras_scanned=1,
            status="ok",
        )
    r = client.get("/api/v1/activity?limit=2")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_activity_null_finished_at(client, test_db):
    """In-progress scan has null finished_at — must not crash serialization."""
    from app.models.scan_event import ScanEvent

    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=timezone.utc),
        cameras_scanned=1,
        status="running",
    )
    r = client.get("/api/v1/activity")
    assert r.status_code == 200
    events = r.json()
    assert events[0]["finished_at"] is None


# test_activity_fmt_* removed: _fmt replaced by tz.fmt_dt (covered in tests/unit/test_tz.py)
