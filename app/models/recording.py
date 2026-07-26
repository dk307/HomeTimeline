import logging
from pathlib import Path

from peewee import (
    AutoField,
    BigIntegerField,
    CharField,
    DateTimeField,
    FloatField,
    ForeignKeyField,
    TextField,
)

from app.models.base import BaseModel, utcnow
from app.models.camera import Camera

logger = logging.getLogger(__name__)


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
    created_at = DateTimeField(default=utcnow)
    updated_at = DateTimeField(default=utcnow)

    class Meta:
        table_name = "recordings"

    def delete_files(self) -> int:
        """Delete video file and thumbnail from disk. Returns freed bytes."""
        freed = 0
        for path_str in (self.file_path, self.thumbnail_path):
            if not path_str:
                continue
            p = Path(path_str)
            try:
                size = p.stat().st_size
            except OSError:
                continue
            try:
                p.unlink()
                freed += size
            except OSError as exc:
                logger.warning("Failed to delete %s: %s", p, exc)
        return freed
