"""Integration tests for the logs API."""

import pytest


@pytest.fixture(autouse=True)
def _clear_log_buffer():
    """Isolate each test: clear _BUFFER before and after."""
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.clear()
    yield
    with _LOCK:
        _BUFFER.clear()


def test_logs_returns_list(client):
    r = client.get("/api/v1/logs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_logs_level_filter(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.append(
            {"ts": "2024-01-15T10:00:00+00:00", "level": "WARNING", "logger": "test", "msg": "warn"}
        )
        _BUFFER.append(
            {"ts": "2024-01-15T10:00:01+00:00", "level": "DEBUG", "logger": "test", "msg": "dbg"}
        )

    r = client.get("/api/v1/logs?level=WARNING")
    assert r.status_code == 200
    entries = r.json()
    assert all(e["level"] == "WARNING" for e in entries)


def test_logs_limit(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        for i in range(20):
            _BUFFER.append(
                {"ts": "2024-01-15T10:00:00+00:00", "level": "INFO", "logger": "t", "msg": f"m{i}"}
            )

    r = client.get("/api/v1/logs?limit=5")
    assert r.status_code == 200
    assert len(r.json()) <= 5


def test_logs_entry_shape(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:00+00:00",
                "level": "INFO",
                "logger": "app.scanner",
                "msg": "scan done",
            }
        )

    r = client.get("/api/v1/logs")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    e = entries[0]
    assert "ts" in e
    assert e["level"] == "INFO"
    assert e["logger"] == "app.scanner"
    assert e["msg"] == "scan done"


def test_logs_bad_timestamp_falls_back(client):
    """Covers lines 24-25: non-ISO ts is returned as-is without crashing."""
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.append(
            {"ts": "not-a-datetime", "level": "ERROR", "logger": "test", "msg": "bad ts"}
        )

    r = client.get("/api/v1/logs")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    # Raw string returned as-is when parsing fails
    assert entries[0]["ts"] == "not-a-datetime"
