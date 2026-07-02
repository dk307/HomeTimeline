"""Integration tests for the health endpoint."""

from unittest.mock import patch


def test_health_ok(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] is True


def test_health_degraded_when_db_fails(client):
    """Health returns 'degraded' when the DB execute_sql raises."""
    with patch("app.api.health.db.execute_sql", side_effect=Exception("db down")):
        r = client.get("/api/v1/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["db"] is False
