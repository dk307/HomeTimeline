"""Integration tests for the app settings API."""

import zoneinfo


def test_get_settings_returns_defaults(client):
    r = client.get("/api/v1/settings")
    assert r.status_code == 200
    body = r.json()
    assert "timezone" in body
    # Scanning is now per-camera; the global setting is gone.
    assert "scan_interval_minutes" not in body
    # Must be a valid IANA timezone
    zoneinfo.ZoneInfo(body["timezone"])


def test_patch_ignores_unknown_fields(client):
    # scan_interval_minutes is no longer an app setting — silently ignored.
    r = client.patch(
        "/api/v1/settings", json={"unknown_field": "value", "scan_interval_minutes": 5}
    )
    assert r.status_code == 200
    assert "scan_interval_minutes" not in r.json()


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


def test_invalid_timezone_value_error_returns_400(client):
    """ValueError from zoneinfo (e.g. malformed key) also returns HTTP 400."""
    from unittest.mock import patch

    with patch("app.api.app_settings.zoneinfo.ZoneInfo", side_effect=ValueError("bad key")):
        r = client.patch("/api/v1/settings", json={"timezone": "bad/tz"})
    assert r.status_code == 400
    assert "timezone" in r.json()["detail"].lower()
