from datetime import datetime

from peewee import (
    AutoField,
    BigIntegerField,
    CharField,
    DateTimeField,
    FloatField,
    ForeignKeyField,
    TextField,
)

from app.models.base import BaseModel
from app.models.camera import Camera


class Recording(BaseModel):
    id = AutoField()
    camera = ForeignKeyField(Camera, backref="recordings", on_delete="CASCADE")
    file_path = CharField(unique=True)
    file_hash = CharField(null=True, index=True)
    start_time = DateTimeField(index=True)
    end_time = DateTimeField(null=True)
    duration_secs = FloatField(null=True)
    file_size_bytes = BigIntegerField(null=True)
    thumbnail_path = CharField(null=True)
    notes = TextField(null=True)
    status = CharField(default="pending")  # pending | ready | error
    created_at = DateTimeField(default=datetime.now)
    updated_at = DateTimeField(default=datetime.now)

    class Meta:
        table_name = "recordings"
