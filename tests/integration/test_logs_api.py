"""Integration tests for the logs API."""


def test_logs_returns_list(client):
    r = client.get("/api/v1/logs")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_logs_level_filter(client):
    from app.services.log_buffer import _BUFFER, _LOCK

    # Seed a warning into the buffer directly
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
            {"ts": "2024-01-15T10:00:00+00:00", "level": "ERROR", "logger": "app", "msg": "oops"}
        )

    r = client.get("/api/v1/logs")
    assert r.status_code == 200
    entries = r.json()
    assert entries
    e = entries[-1]
    assert {"ts", "level", "logger", "msg"} <= set(e.keys())
