from datetime import datetime

from peewee import (
    AutoField,
    BooleanField,
    CharField,
    DateTimeField,
    ForeignKeyField,
    IntegerField,
    TextField,
)

from app.models.base import BaseModel
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
    time_source = CharField(default="mtime")  # mtime | folder_date
    # Automatic filesystem scan interval in minutes. NULL = Never (manual only).
    scan_interval_minutes = IntegerField(null=True)
    created_at = DateTimeField(default=datetime.now)
    updated_at = DateTimeField(default=datetime.now)

    class Meta:
        table_name = "cameras"
