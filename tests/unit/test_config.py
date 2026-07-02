"""Unit tests for app/config.py."""


def test_recording_paths_splits_colon_separated():
    from app.config import Settings

    s = Settings(recording_locations="/a:/b:/c")
    assert s.recording_paths == ["/a", "/b", "/c"]


def test_recording_paths_strips_whitespace():
    from app.config import Settings

    s = Settings(recording_locations=" /a : /b ")
    assert s.recording_paths == ["/a", "/b"]


def test_recording_paths_filters_empty():
    from app.config import Settings

    s = Settings(recording_locations="/a::/b")
    assert s.recording_paths == ["/a", "/b"]


def test_db_path_strips_sqlite_prefix():
    from app.config import Settings

    s = Settings(database_url="sqlite:///./data/cam.db")
    assert s.db_path == "./data/cam.db"


def test_db_path_absolute():
    from app.config import Settings

    s = Settings(database_url="sqlite:////tmp/cam.db")
    assert s.db_path == "/tmp/cam.db"
