"""Timezone utilities — detect server local TZ, convert datetimes for display."""

import zoneinfo
from datetime import datetime

_UTC = zoneinfo.ZoneInfo("UTC")


def _detect_local_tz() -> str:
    """Return the system IANA timezone name, falling back to 'UTC'."""
    from pathlib import Path

    try:
        lt = Path("/etc/localtime")
        if lt.is_symlink():
            target = str(lt.resolve())
            if "zoneinfo/" in target:
                return target.split("zoneinfo/", 1)[1]
    except Exception:
        pass
    try:
        tz_file = Path("/etc/timezone")
        if tz_file.exists():
            name = tz_file.read_text().strip()
            if name:
                return name
    except Exception:
        pass
    return "UTC"


def get_app_tz() -> zoneinfo.ZoneInfo:
    """Return the configured application timezone (lazy-loads AppSettings)."""
    try:
        from app.models.app_settings import AppSettings

        return zoneinfo.ZoneInfo(AppSettings.get_instance().timezone)
    except Exception:
        return zoneinfo.ZoneInfo(_detect_local_tz())


def to_app_tz(dt: datetime | None) -> datetime | None:
    """Convert a naive (UTC-assumed) or aware datetime to the app timezone."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_UTC)
    return dt.astimezone(get_app_tz())


def fmt_dt(dt: datetime | None) -> str | None:
    """Format a datetime in the app timezone as an ISO 8601 string."""
    converted = to_app_tz(dt)
    if converted is None:
        return None
    return converted.isoformat()
