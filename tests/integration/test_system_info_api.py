"""Integration tests for the system info API."""

from unittest.mock import patch


def test_system_info_returns_200(client):
    r = client.get("/api/v1/system_info")
    assert r.status_code == 200


def test_system_info_has_required_sections(client):
    r = client.get("/api/v1/system_info")
    body = r.json()
    for key in ("components", "build", "system", "ffmpeg", "storage"):
        assert key in body, f"missing section: {key}"


def test_components_section(client):
    r = client.get("/api/v1/system_info")
    comp = r.json()["components"]
    for key in ("python", "fastapi", "uvicorn", "peewee", "go2rtc", "node"):
        assert key in comp, f"missing component: {key}"
    assert comp["python"].startswith("3.")


def test_build_section(client):
    r = client.get("/api/v1/system_info")
    build = r.json()["build"]
    assert "git_sha" in build
    assert "build_time" in build
    assert "arch" in build


def test_system_section(client):
    r = client.get("/api/v1/system_info")
    sys_info = r.json()["system"]
    assert "os" in sys_info
    assert "kernel" in sys_info
    assert "sqlite" in sys_info
    assert "python_impl" in sys_info
    assert isinstance(sys_info["hwaccels"], list)
    assert isinstance(sys_info["hw_available"], dict)
    assert isinstance(sys_info["cpu_features"], list)


def test_ffmpeg_section(client):
    r = client.get("/api/v1/system_info")
    ff = r.json()["ffmpeg"]
    assert "version" in ff
    assert "encoders" in ff
    assert "decoders" in ff
    assert isinstance(ff["encoders"], list)
    assert isinstance(ff["decoders"], list)


def test_storage_section(client):
    r = client.get("/api/v1/system_info")
    storage = r.json()["storage"]
    assert "recordings_path" in storage
    assert "disk_free_gb" in storage
    assert "disk_total_gb" in storage
    assert "db_size_mb" in storage
    assert "thumbnail_count" in storage
    assert "thumbnail_size_mb" in storage
    assert isinstance(storage["disk_free_gb"], (int, float))
    assert storage["disk_free_gb"] >= 0


def test_system_info_caches_subprocess_results(client):
    """Second call should use cached data (no subprocess re-runs)."""
    with patch("app.api.system_info._run", wraps=__import__("app.api.system_info", fromlist=["_run"])._run) as mock_run:
        r1 = client.get("/api/v1/system_info")
        calls_after_first = mock_run.call_count
        r2 = client.get("/api/v1/system_info")
        # Storage fields don't use _run, so no new _run calls expected
        assert mock_run.call_count == calls_after_first
        assert r1.json()["build"] == r2.json()["build"]
