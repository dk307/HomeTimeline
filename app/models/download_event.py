from datetime import datetime

from peewee import (
    AutoField,
    DateTimeField,
    ForeignKeyField,
    IntegerField,
    TextField,
)

from app.models.base import BaseModel
from app.models.camera import Camera


class DownloadEvent(BaseModel):
    """History of a single per-camera download run (Hikvision cameras)."""

    id = AutoField()
    camera = ForeignKeyField(Camera, backref="download_events", on_delete="CASCADE")
    started_at = DateTimeField(default=datetime.utcnow)
    finished_at = DateTimeField(null=True)
    downloaded = IntegerField(default=0)  # clips fetched from the camera
    indexed = IntegerField(default=0)  # new recordings indexed afterwards
    status = TextField(default="ok")  # ok | error
    detail = TextField(null=True)

    class Meta:
        table_name = "download_events"
