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

    # Ensure singleton row exists
    AppSettings.get_instance()


def close_db() -> None:
    if not db.is_closed():
        db.close()
