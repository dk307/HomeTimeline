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


def init_db() -> None:
    from app.models.app_settings import AppSettings
    from app.models.camera import Camera
    from app.models.location import Location
    from app.models.recording import Recording
    from app.models.scan_event import ScanEvent

    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    Path(settings.thumbnail_dir).mkdir(parents=True, exist_ok=True)

    db.connect(reuse_if_open=True)
    db.create_tables([Location, Camera, Recording, ScanEvent, AppSettings], safe=True)

    # Migrate first so all columns exist before any queries
    _migrate(db)

    # Ensure singleton row exists
    AppSettings.get_instance()


def _migrate(database: SqliteDatabase) -> None:
    """Add new columns to existing tables without breaking existing data."""
    cursor = database.execute_sql("PRAGMA table_info(cameras)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    if "time_source" not in existing_cols:
        database.execute_sql(
            "ALTER TABLE cameras ADD COLUMN time_source TEXT NOT NULL DEFAULT 'mtime'"
        )

    cursor = database.execute_sql("PRAGMA table_info(scan_events)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    if "skipped_recordings" not in existing_cols:
        database.execute_sql(
            "ALTER TABLE scan_events ADD COLUMN skipped_recordings INTEGER NOT NULL DEFAULT 0"
        )

    cursor = database.execute_sql("PRAGMA table_info(app_settings)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    if "timezone" not in existing_cols:
        database.execute_sql(
            "ALTER TABLE app_settings ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'"
        )


def close_db() -> None:
    if not db.is_closed():
        db.close()
