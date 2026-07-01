"""Integration tests for the app settings API."""


def test_get_settings_returns_defaults(client):
    r = client.get("/api/v1/settings")
    assert r.status_code == 200
    body = r.json()
    assert body["scan_interval_minutes"] == 5


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
