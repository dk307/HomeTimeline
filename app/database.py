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

    # Migrate first so all columns exist before any queries
    _migrate(db)

    # Ensure singleton row exists
    AppSettings.get_instance()


def _migrate(database: SqliteDatabase) -> None:
    """Add new columns to existing tables without breaking existing data.

    The whole body runs in a single transaction so a mid-migration failure rolls
    back cleanly; each step stays guarded by a column-existence / needs-work check
    so re-running is a no-op.
    """
    with database.atomic():
        cursor = database.execute_sql("PRAGMA table_info(cameras)")
        existing_cols = {row[1] for row in cursor.fetchall()}
        if "scan_interval_minutes" not in existing_cols:
            # Nullable, no default → existing cameras start at Never (manual-only).
            database.execute_sql("ALTER TABLE cameras ADD COLUMN scan_interval_minutes INTEGER")
        if "clip_strategy" not in existing_cols:
            # Replaces the old two-option time_source. ADD COLUMN with a NOT NULL
            # DEFAULT already backfills existing rows, so no separate UPDATE needed.
            database.execute_sql(
                "ALTER TABLE cameras ADD COLUMN clip_strategy TEXT NOT NULL DEFAULT 'daily_folder'"
            )
        # Hikvision connection + download settings (all nullable).
        for col, ddl in (
            ("host", "ALTER TABLE cameras ADD COLUMN host TEXT"),
            ("username", "ALTER TABLE cameras ADD COLUMN username TEXT"),
            ("password", "ALTER TABLE cameras ADD COLUMN password TEXT"),
            (
                "download_interval_minutes",
                "ALTER TABLE cameras ADD COLUMN download_interval_minutes INTEGER",
            ),
            ("last_downloaded_at", "ALTER TABLE cameras ADD COLUMN last_downloaded_at DATETIME"),
            (
                "purge_older_than_days",
                "ALTER TABLE cameras ADD COLUMN purge_older_than_days INTEGER",
            ),
            (
                "purge_interval_minutes",
                "ALTER TABLE cameras ADD COLUMN purge_interval_minutes INTEGER",
            ),
            ("last_purged_at", "ALTER TABLE cameras ADD COLUMN last_purged_at DATETIME"),
        ):
            if col not in existing_cols:
                database.execute_sql(ddl)
        # camera_type was previously free-text; normalize legacy values to the
        # constrained set ("generic" | "hikvision" | "aqura") — but only when
        # some row actually needs it, so this doesn't issue writes on every boot.
        if "camera_type" in existing_cols:
            needs_fix = database.execute_sql(
                "SELECT 1 FROM cameras WHERE camera_type IS NULL "
                "OR camera_type <> LOWER(camera_type) "
                "OR camera_type NOT IN ('generic', 'hikvision', 'aqura') LIMIT 1"
            ).fetchone()
            if needs_fix:
                database.execute_sql(
                    "UPDATE cameras SET camera_type = LOWER(camera_type) "
                    "WHERE camera_type IS NOT NULL"
                )
                database.execute_sql(
                    "UPDATE cameras SET camera_type = 'generic' "
                    "WHERE camera_type IS NULL OR camera_type NOT IN ('generic', 'hikvision', 'aqura')"
                )

        # Aqura-specific columns (all nullable).
        for col, ddl in (
            ("stream_url_1", "ALTER TABLE cameras ADD COLUMN stream_url_1 TEXT"),
            ("stream_url_2", "ALTER TABLE cameras ADD COLUMN stream_url_2 TEXT"),
            ("stream_url_3", "ALTER TABLE cameras ADD COLUMN stream_url_3 TEXT"),
            ("aqura_username", "ALTER TABLE cameras ADD COLUMN aqura_username TEXT"),
            ("aqura_password", "ALTER TABLE cameras ADD COLUMN aqura_password TEXT"),
        ):
            if col not in existing_cols:
                database.execute_sql(ddl)

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
