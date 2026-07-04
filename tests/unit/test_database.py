"""Unit tests for app/database.py — init_db, _migrate, close_db."""


def test_init_db_is_idempotent(test_db):
    """init_db() with safe=True on an already-created schema must not raise."""
    from app.database import init_db

    init_db()  # tables already exist via autouse fixture; safe=True makes this a no-op


def test_migrate_is_idempotent(test_db):
    """_migrate() called twice on the same DB must not raise."""
    from app.database import _migrate

    _migrate(test_db)
    _migrate(test_db)


def test_close_db_when_open(test_db):
    """close_db() closes an open connection without error."""
    from app.database import close_db, db

    # test_db fixture leaves the DB open
    close_db()
    assert db.is_closed()
    # Re-open so the fixture teardown doesn't fail
    db.connect(reuse_if_open=True)


def test_close_db_when_already_closed(test_db):
    """close_db() is safe to call when the DB is already closed."""
    from app.database import close_db, db

    db.close()
    close_db()  # should not raise
    db.connect(reuse_if_open=True)


def test_migrate_adds_missing_columns(tmp_path):
    """Covers lines 43, 50, 57: _migrate() issues ALTER TABLE when columns are absent."""
    from peewee import SqliteDatabase

    from app.database import _migrate

    legacy_db = SqliteDatabase(str(tmp_path / "legacy.db"))
    legacy_db.connect()
    # Create minimal tables WITHOUT the columns that _migrate() adds
    legacy_db.execute_sql("CREATE TABLE cameras (id INTEGER PRIMARY KEY, name TEXT)")
    legacy_db.execute_sql("CREATE TABLE scan_events (id INTEGER PRIMARY KEY, started_at TEXT)")
    legacy_db.execute_sql(
        "CREATE TABLE app_settings (id INTEGER PRIMARY KEY, scan_interval_minutes INTEGER)"
    )

    _migrate(legacy_db)

    cam_cols = {r[1] for r in legacy_db.execute_sql("PRAGMA table_info(cameras)").fetchall()}
    assert "time_source" in cam_cols
    assert "scan_interval_minutes" in cam_cols

    se_cols = {r[1] for r in legacy_db.execute_sql("PRAGMA table_info(scan_events)").fetchall()}
    assert "skipped_recordings" in se_cols

    as_cols = {r[1] for r in legacy_db.execute_sql("PRAGMA table_info(app_settings)").fetchall()}
    assert "timezone" in as_cols

    legacy_db.close()
