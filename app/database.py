from pathlib import Path

from peewee import SqliteDatabase

from app.config import settings

db = SqliteDatabase(
    settings.db_path,
    pragmas={
        "journal_mode": "wal",
        "cache_size": -64 * 1000,
        "synchronous": "NORMAL",
        "foreign_keys": 1,
    },
)


def _migrate() -> None:
    """Idempotent column-level migrations for existing databases.

    Uses PRAGMA table_info to detect missing columns and issues
    ALTER TABLE … ADD COLUMN for each.  Safe to run on every startup.
    """
    migrations = [
        ("cameras", "thumbnail_delay_ms", "INTEGER DEFAULT 1000"),
    ]
    for table, column, typedef in migrations:
        cols = {row[1] for row in db.execute_sql(f"PRAGMA table_info({table})").fetchall()}
        if column not in cols:
            db.execute_sql(f"ALTER TABLE {table} ADD COLUMN {column} {typedef}")


def init_db() -> None:
    from app.models.app_settings import AppSettings
    from app.models.camera import Camera
    from app.models.download_event import DownloadEvent
    from app.models.location import Location
    from app.models.purge_event import PurgeEvent
    from app.models.recording import Recording
    from app.models.scan_event import ScanEvent

    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    Path(settings.thumbnail_dir).mkdir(parents=True, exist_ok=True)

    db.connect(reuse_if_open=True)
    db.create_tables(
        [Location, Camera, Recording, ScanEvent, DownloadEvent, PurgeEvent, AppSettings],
        safe=True,
    )
    _migrate()

    # Ensure singleton row exists
    AppSettings.get_instance()


def close_db() -> None:
    if not db.is_closed():
        db.close()
