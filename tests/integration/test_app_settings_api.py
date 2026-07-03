"""Integration tests for the app settings API."""

import zoneinfo


def test_get_settings_returns_defaults(client):
    r = client.get("/api/v1/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["scan_interval_minutes"] == 5
    assert "timezone" in body
    # Must be a valid IANA timezone
    zoneinfo.ZoneInfo(body["timezone"])


def test_update_scan_interval(client):
    r = client.patch("/api/v1/settings", json={"scan_interval_minutes": 15})
    assert r.status_code == 200
    assert r.json()["scan_interval_minutes"] == 15


def test_update_is_persisted(client):
    client.patch("/api/v1/settings", json={"scan_interval_minutes": 30})
    r = client.get("/api/v1/settings")
    assert r.json()["scan_interval_minutes"] == 30


def test_patch_ignores_unknown_fields(client):
    r = client.patch("/api/v1/settings", json={"unknown_field": "value"})
    assert r.status_code == 200


def test_scan_interval_must_be_at_least_1(client):
    r = client.patch("/api/v1/settings", json={"scan_interval_minutes": 0})
    assert r.status_code == 422


def test_scan_interval_max_1440(client):
    r = client.patch("/api/v1/settings", json={"scan_interval_minutes": 1441})
    assert r.status_code == 422


def test_update_timezone(client):
    r = client.patch("/api/v1/settings", json={"timezone": "America/New_York"})
    assert r.status_code == 200
    assert r.json()["timezone"] == "America/New_York"


def test_update_timezone_persisted(client):
    client.patch("/api/v1/settings", json={"timezone": "Europe/London"})
    r = client.get("/api/v1/settings")
    assert r.json()["timezone"] == "Europe/London"


def test_invalid_timezone_returns_400(client):
    r = client.patch("/api/v1/settings", json={"timezone": "Not/AReal/Zone"})
    assert r.status_code == 400
    assert "timezone" in r.json()["detail"].lower()


def test_timezone_applied_to_activity(client):
    """Activity timestamps should include a UTC offset matching the configured TZ."""
    from datetime import datetime

    from app.models.scan_event import ScanEvent

    ScanEvent.create(
        started_at=datetime(2024, 6, 15, 14, 0, 0),
        finished_at=datetime(2024, 6, 15, 14, 1, 0),
        status="ok",
    )
    client.patch("/api/v1/settings", json={"timezone": "America/New_York"})
    r = client.get("/api/v1/activity")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) > 0
    # America/New_York in June is EDT = UTC-4
    assert "-04:00" in entries[0]["started_at"]
