from peewee import (
    AutoField,
    BooleanField,
    CharField,
    DateTimeField,
    ForeignKeyField,
    IntegerField,
    TextField,
)

from app.models.base import BaseModel, utcnow
from app.models.location import Location


class Camera(BaseModel):
    id = AutoField()
    name = CharField()
    description = TextField(null=True)
    camera_type = CharField(default="generic")
    location = ForeignKeyField(Location, backref="cameras", null=True, on_delete="SET NULL")
    recording_path = CharField()
    enabled = BooleanField(default=True)
    display_order = IntegerField(default=0)
    # How downloaded/scanned clips are laid out and timestamped. Currently the
    # only strategy is "daily_folder": per-day YYYY-MM-DD folders, clip time taken
    # from the end of the file (mtime). More strategies may be added later.
    clip_strategy = CharField(default="daily_folder")
    # Automatic filesystem scan interval in minutes. NULL = Never (manual only).
    scan_interval_minutes = IntegerField(null=True)
    # Hikvision connection (only used when camera_type == "hikvision").
    host = CharField(null=True)
    username = CharField(null=True)
    password = CharField(null=True)  # plaintext; never returned by the API
    # Automatic download interval in minutes. NULL = Never (manual only).
    download_interval_minutes = IntegerField(null=True)
    last_downloaded_at = DateTimeField(null=True)
    created_at = DateTimeField(default=utcnow)
    updated_at = DateTimeField(default=utcnow)

    class Meta:
        table_name = "cameras"
