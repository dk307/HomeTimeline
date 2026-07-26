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
        """Delete video file and thumbnail from disk. Returns freed bytes.

        Raises ``OSError`` (other than ``FileNotFoundError``) when a file exists but
        cannot be deleted, so callers can skip DB removal and allow retry.
        FileNotFoundError is treated as already-clean (returns freed bytes for any
        successfully deleted sibling).
        """
        freed = 0
        for path_str in (self.file_path, self.thumbnail_path):
            if not path_str:
                continue
            p = Path(path_str)
            try:
                size = p.stat().st_size
            except FileNotFoundError:
                continue
            try:
                p.unlink()
                freed += size
            except FileNotFoundError:
                pass
            except OSError:
                raise
        return freed
