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


def test_logs_search_filter(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:00+00:00",
                "level": "INFO",
                "logger": "test",
                "msg": "disk full",
            }
        )
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:01+00:00",
                "level": "INFO",
                "logger": "test",
                "msg": "scan done",
            }
        )

    r = client.get("/api/v1/logs?search=disk")
    assert r.status_code == 200
    entries = r.json()
    assert len(entries) == 1
    assert entries[0]["msg"] == "disk full"


def test_logs_search_case_insensitive(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:00+00:00",
                "level": "INFO",
                "logger": "test",
                "msg": "Hello World",
            }
        )

    r = client.get("/api/v1/logs?search=hello")
    assert r.status_code == 200
    assert len(r.json()) == 1

    r = client.get("/api/v1/logs?search=WORLD")
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_logs_download_endpoint_returns_tsv(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:00+00:00",
                "level": "INFO",
                "logger": "test",
                "camera_name": "Garage",
                "msg": "scan done",
            }
        )
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:01+00:00",
                "level": "ERROR",
                "logger": "test",
                "camera_name": None,
                "msg": "oops",
            }
        )

    r = client.get("/api/v1/logs/download")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    text = r.text
    lines = text.strip().split("\n")
    assert len(lines) == 3  # header + 2 data rows
    assert lines[0] == "ts\tlevel\tlogger\tcamera_name\tmsg"
    assert "INFO" in lines[1]
    assert "Garage" in lines[1]
    assert "scan done" in lines[1]
    assert "ERROR" in lines[2]
    assert "oops" in lines[2]


def test_logs_download_respects_filters(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    with _LOCK:
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:00+00:00",
                "level": "INFO",
                "logger": "test",
                "camera_name": None,
                "msg": "info msg",
            }
        )
        _BUFFER.append(
            {
                "ts": "2024-01-15T10:00:01+00:00",
                "level": "ERROR",
                "logger": "test",
                "camera_name": None,
                "msg": "error msg",
            }
        )

    r = client.get("/api/v1/logs/download?level=ERROR")
    assert r.status_code == 200
    lines = r.text.strip().split("\n")
    assert len(lines) == 2  # header + 1 data row
    assert "error msg" in lines[1]
    assert "info msg" not in lines[1]
