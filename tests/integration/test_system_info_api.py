"""Integration tests for the system info API."""

from unittest.mock import patch

from app.api import system_info


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
    system_info._cached_ffmpeg.cache_clear()
    system_info._cached_system.cache_clear()
    with patch("app.api.system_info._run") as mock_run:
        r1 = client.get("/api/v1/system_info")
        calls_after_first = mock_run.call_count
        r2 = client.get("/api/v1/system_info")
        assert mock_run.call_count == calls_after_first
        assert r1.json()["build"] == r2.json()["build"]


def test_parse_codecs_encoders():
    """Unit test: _parse_codecs extracts codec names from ffmpeg output."""
    sample = (
        "ffmpeg version 6.1.1\n"
        " V..... libx264              libx264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10)\n"
        " V..... libx265              libx265 (H.265 / HEVC)\n"
        " A..... aac                  AAC (Advanced Audio Coding)\n"
    )
    assert system_info._parse_codecs(sample) == ["libx264", "libx265", "aac"]


def test_parse_codecs_empty():
    assert system_info._parse_codecs("") == []


def test_parse_codecs_no_codecs():
    assert system_info._parse_codecs("ffmpeg version 6.1.1\n") == []


def test_pkg_ver_returns_unknown_on_exception():
    with patch("app.api.system_info._pkg_version", side_effect=ModuleNotFoundError("nope")):
        assert system_info._pkg_ver("nonexistent") == "unknown"


def test_cpu_features_returns_empty_on_oserror():
    import builtins

    with patch.object(builtins, "open", side_effect=OSError("no /proc")):
        assert system_info._cpu_features() == []


def test_ffmpeg_config_parses_flags():
    mock_out = "configuration:\n--enable-gpl\n--enable-libx264\n--disable-doc\n"
    with patch("app.api.system_info._run", return_value=mock_out):
        result = system_info._ffmpeg_config()
        assert "gpl" in result
        assert "libx264" in result
        assert "disable-doc" not in result


def test_ffmpeg_version_info_with_build_line():
    mock_out = (
        "ffmpeg version 6.1.1\n"
        "built with gcc 12.2.0\n"
        "configuration: --enable-gpl\n"
    )
    with patch("app.api.system_info._run", return_value=mock_out):
        result = system_info._ffmpeg_version_info()
        assert "gcc" in result["build_date"]


def _mock_settings(**overrides):
    """Create a mock settings object with defaults for _get_storage."""
    from types import SimpleNamespace

    defaults = {"recording_paths": ["/a"], "db_path": "/tmp/test.db", "thumbnail_dir": "/tmp/thumbs"}
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_get_storage_deduplicates_same_device():
    """When two recording paths share a device, disk usage is only counted once."""
    fake_stat = type("S", (), {"st_dev": 42})()
    fake_usage = type("U", (), {"free": 1024**3, "total": 200 * 1024**3})()
    with (
        patch("app.api.system_info.settings", _mock_settings(recording_paths=["/a", "/b"])),
        patch("app.api.system_info.os.stat", return_value=fake_stat),
        patch("app.api.system_info.shutil.disk_usage", return_value=fake_usage),
        patch("app.api.system_info.os.path.isfile", return_value=False),
        patch("app.api.system_info.os.scandir", side_effect=OSError("no thumb")),
    ):
        storage = system_info._get_storage()
        assert storage["disk_free_gb"] == 1.0


def test_get_storage_handles_path_oserror():
    """OSError on a recording path is silently skipped."""
    with (
        patch("app.api.system_info.settings", _mock_settings(recording_paths=["/nonexistent"])),
        patch("app.api.system_info.os.stat", side_effect=OSError),
        patch("app.api.system_info.os.path.isfile", return_value=False),
        patch("app.api.system_info.os.scandir", side_effect=OSError("no thumb")),
    ):
        storage = system_info._get_storage()
        assert storage["disk_free_gb"] == 0.0


def test_get_storage_db_size_oserror():
    """OSError reading db file size is silently handled."""
    with (
        patch("app.api.system_info.settings", _mock_settings()),
        patch("app.api.system_info.os.stat", return_value=type("S", (), {"st_dev": 1})()),
        patch("app.api.system_info.shutil.disk_usage", return_value=type("U", (), {"free": 0, "total": 0})()),
        patch("app.api.system_info.os.path.isfile", return_value=True),
        patch("app.api.system_info.os.path.getsize", side_effect=OSError),
        patch("app.api.system_info.os.scandir", side_effect=OSError("no thumb")),
    ):
        storage = system_info._get_storage()
        assert storage["db_size_mb"] == 0.0


def test_get_storage_thumbnails_scanned():
    """Thumbnails are counted and sized correctly."""
    from unittest.mock import MagicMock

    entry_a = MagicMock()
    entry_a.is_file.return_value = True
    entry_a.stat.return_value = MagicMock(st_size=1024 * 1024)  # 1 MB

    entry_b = MagicMock()
    entry_b.is_file.return_value = True
    entry_b.stat.return_value = MagicMock(st_size=2 * 1024 * 1024)  # 2 MB

    entry_subdir = MagicMock()
    entry_subdir.is_file.return_value = False

    scandir_cm = MagicMock()
    scandir_cm.__enter__ = MagicMock(return_value=[entry_a, entry_b, entry_subdir])
    scandir_cm.__exit__ = MagicMock(return_value=False)

    with (
        patch("app.api.system_info.settings", _mock_settings(thumbnail_dir="/thumbs")),
        patch("app.api.system_info.os.scandir", return_value=scandir_cm),
    ):
        storage = system_info._get_storage()
        assert storage["thumbnail_count"] == 2
        assert storage["thumbnail_size_mb"] == 3.0


def test_get_storage_thumbnail_dir_oserror():
    """OSError reading thumbnail dir is silently handled."""
    with (
        patch("app.api.system_info.settings", _mock_settings(thumbnail_dir="/nonexistent")),
        patch("app.api.system_info.os.stat", return_value=type("S", (), {"st_dev": 1})()),
        patch("app.api.system_info.shutil.disk_usage", return_value=type("U", (), {"free": 0, "total": 0})()),
        patch("app.api.system_info.os.path.isfile", return_value=False),
    ):
        storage = system_info._get_storage()
        assert storage["thumbnail_count"] == 0
