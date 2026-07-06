from peewee import (
    AutoField,
    BigIntegerField,
    DateTimeField,
    ForeignKeyField,
    IntegerField,
    TextField,
)

from app.models.base import BaseModel, utcnow
from app.models.camera import Camera


class PurgeEvent(BaseModel):
    """History of a single per-camera purge run (deletes old clips)."""

    id = AutoField()
    camera = ForeignKeyField(Camera, backref="purge_events", on_delete="CASCADE")
    started_at = DateTimeField(default=utcnow)
    finished_at = DateTimeField(null=True)
    deleted = IntegerField(default=0)  # clips removed (file + index + thumbnail)
    freed_bytes = BigIntegerField(default=0)  # disk space reclaimed
    status = TextField(default="ok")  # ok | error
    detail = TextField(null=True)

    class Meta:
        table_name = "purge_events"
