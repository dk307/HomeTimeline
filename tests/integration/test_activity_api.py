"""Integration tests for the activity (scan events) API."""

from datetime import UTC, datetime

from tests.asserts import assert_offset_aware_iso


def test_activity_empty(client):
    r = client.get("/api/v1/activity")
    assert r.status_code == 200
    assert r.json() == []


def test_activity_lists_scan_events(client, test_db):
    from app.models.scan_event import ScanEvent

    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=UTC),
        finished_at=datetime(2024, 1, 15, 10, 1, tzinfo=UTC),
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
    assert e["type"] == "scan"
    assert e["cameras_scanned"] == 2
    assert e["new_recordings"] == 5
    assert e["skipped_recordings"] == 3
    assert e["status"] == "ok"
    assert e["started_at"] is not None
    assert e["finished_at"] is not None
    # Timestamps must be tz-aware output — sign-agnostic so it holds under any
    # local timezone (Z, +HH:MM, or -HH:MM after the time part).
    assert_offset_aware_iso(e["started_at"])


def test_activity_limit(client, test_db):
    from app.models.scan_event import ScanEvent

    for i in range(5):
        ScanEvent.create(
            started_at=datetime(2024, 1, i + 1, 10, 0, tzinfo=UTC),
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
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=UTC),
        cameras_scanned=1,
        status="running",
    )
    r = client.get("/api/v1/activity")
    assert r.status_code == 200
    events = r.json()
    assert events[0]["finished_at"] is None


def test_activity_includes_download_events(client, camera):
    from app.models.download_event import DownloadEvent

    DownloadEvent.create(
        camera=camera,
        started_at=datetime(2024, 1, 16, 9, 0, tzinfo=UTC),
        finished_at=datetime(2024, 1, 16, 9, 5, tzinfo=UTC),
        downloaded=4,
        indexed=3,
        status="ok",
        detail="Test Cam · 4 downloaded",
    )
    events = client.get("/api/v1/activity").json()
    assert len(events) == 1
    e = events[0]
    assert e["type"] == "download"
    assert e["camera"] == camera.name
    assert e["downloaded"] == 4
    assert e["indexed"] == 3
    assert_offset_aware_iso(e["started_at"])


def test_activity_merges_scan_and_download_newest_first(client, camera):
    from app.models.download_event import DownloadEvent
    from app.models.scan_event import ScanEvent

    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=UTC),
        cameras_scanned=1,
        status="ok",
    )
    DownloadEvent.create(
        camera=camera,
        started_at=datetime(2024, 1, 16, 10, 0, tzinfo=UTC),
        status="ok",
    )
    events = client.get("/api/v1/activity").json()
    assert len(events) == 2
    # Newest first: the Jan-16 download precedes the Jan-15 scan.
    assert events[0]["type"] == "download"
    assert events[1]["type"] == "scan"


def test_activity_mixed_tz_awareness_does_not_crash(client, camera):
    """Regression: scan events historically stored tz-aware started_at while
    download events stored naive. Sorting the merged list must not raise
    'can't compare offset-naive and offset-aware datetimes'."""
    from app.models.download_event import DownloadEvent
    from app.models.scan_event import ScanEvent

    # Aware-UTC scan event…
    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=UTC),
        cameras_scanned=1,
        status="ok",
    )
    # …and a naive download event (no tzinfo), mirroring the real DB state.
    DownloadEvent.create(
        camera=camera,
        started_at=datetime(2024, 1, 16, 10, 0),  # naive
        status="ok",
    )
    r = client.get("/api/v1/activity")
    assert r.status_code == 200
    events = r.json()
    assert len(events) == 2
    # Newest first: the Jan-16 download precedes the Jan-15 scan.
    assert events[0]["type"] == "download"
    assert events[1]["type"] == "scan"


def test_activity_includes_purge_events(client, camera):
    from app.models.purge_event import PurgeEvent

    PurgeEvent.create(
        camera=camera,
        started_at=datetime(2024, 1, 17, 9, 0, tzinfo=UTC),
        finished_at=datetime(2024, 1, 17, 9, 1, tzinfo=UTC),
        deleted=5,
        freed_bytes=1024 * 1024,
        status="ok",
        detail="Test Cam · 5 deleted · 1.0 MB freed",
    )
    events = client.get("/api/v1/activity").json()
    assert len(events) == 1
    e = events[0]
    assert e["type"] == "purge"
    assert e["camera"] == camera.name
    assert e["deleted"] == 5
    assert e["freed_bytes"] == 1024 * 1024
    assert_offset_aware_iso(e["started_at"])


def test_activity_merges_all_three_types_newest_first(client, camera):
    from app.models.download_event import DownloadEvent
    from app.models.purge_event import PurgeEvent
    from app.models.scan_event import ScanEvent

    ScanEvent.create(
        started_at=datetime(2024, 1, 15, 10, 0, tzinfo=UTC), cameras_scanned=1, status="ok"
    )
    DownloadEvent.create(
        camera=camera, started_at=datetime(2024, 1, 16, 10, 0, tzinfo=UTC), status="ok"
    )
    PurgeEvent.create(
        camera=camera, started_at=datetime(2024, 1, 17, 10, 0, tzinfo=UTC), status="ok"
    )
    events = client.get("/api/v1/activity").json()
    assert [e["type"] for e in events] == ["purge", "download", "scan"]


# test_activity_fmt_* removed: _fmt replaced by tz.fmt_dt (covered in tests/unit/test_tz.py)
