from peewee import AutoField, CharField, IntegerField

from app.models.base import BaseModel
from app.services.tz import _detect_local_tz


class AppSettings(BaseModel):
    """Single-row application-wide settings table (id is always 1)."""

    id = AutoField()
    scan_interval_minutes = IntegerField(default=5)
    timezone = CharField(default=_detect_local_tz)

    class Meta:
        table_name = "app_settings"

    @classmethod
    def get_instance(cls) -> "AppSettings":
        obj, _ = cls.get_or_create(
            id=1,
            defaults={"scan_interval_minutes": 5, "timezone": _detect_local_tz()},
        )
        return obj
