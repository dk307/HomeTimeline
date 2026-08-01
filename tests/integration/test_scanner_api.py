"""Integration tests for the scanner trigger/status API."""

from unittest.mock import patch


def test_scan_status_not_running(client):
    r = client.get("/api/v1/scanner/status")
    assert r.status_code == 200
    body = r.json()
    assert body["running"] is False
    assert "last_run" in body
    assert "last_result" in body


def test_trigger_scan_starts(client):
    with patch("app.services.scanner.scan_all", return_value={"cam": 1}):
        with patch("app.services.scanner.is_scanning", return_value=False):
            r = client.post("/api/v1/scanner/scan")
    assert r.status_code == 202
    assert r.json()["status"] == "started"


def test_trigger_scan_already_running(client):
    with patch("app.services.scanner.is_scanning", return_value=True):
        r = client.post("/api/v1/scanner/scan")
    assert r.status_code == 202
    assert r.json()["status"] == "already_running"


def test_stop_scan_all_not_running(client):
    from app.services import scanner

    with scanner._SCAN_LOCKS_GUARD:
        scanner._SCANNING.clear()
    r = client.post("/api/v1/scanner/scan/stop")
    assert r.status_code == 200
    assert r.json() == {"status": "not_running"}


def test_stop_scan_all_when_running(client):
    from app.services import scanner

    scanner._SCAN_ALL_ACTIVE = True
    try:
        with scanner._acquire_scan_lock(999):
            r = client.post("/api/v1/scanner/scan/stop")
        assert r.status_code == 200
        assert r.json() == {"status": "stopping"}
    finally:
        scanner._SCAN_ALL_ACTIVE = False
