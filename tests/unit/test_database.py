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
