from datetime import datetime

from peewee import AutoField, DateTimeField, IntegerField, TextField

from app.models.base import BaseModel


class ScanEvent(BaseModel):
    id = AutoField()
    started_at = DateTimeField(default=datetime.utcnow)
    finished_at = DateTimeField(null=True)
    new_recordings = IntegerField(default=0)
    skipped_recordings = IntegerField(default=0)
    cameras_scanned = IntegerField(default=0)
    status = TextField(default="ok")  # ok | error
    detail = TextField(null=True)

    class Meta:
        table_name = "scan_events"
