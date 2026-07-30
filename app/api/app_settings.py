import logging
import zoneinfo

from fastapi import APIRouter, HTTPException

from app.models.app_settings import AppSettings
from app.schemas.app_settings import AppSettingsOut, AppSettingsUpdate
from app.services.tz import invalidate_tz_cache

router = APIRouter(prefix="/settings", tags=["settings"])

_VALID_LOG_LEVELS = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}


@router.get("", response_model=AppSettingsOut)
def get_settings():
    return AppSettings.get_instance()


@router.patch("", response_model=AppSettingsOut)
def update_settings(body: AppSettingsUpdate):
    s = AppSettings.get_instance()
    if body.timezone is not None:
        try:
            zoneinfo.ZoneInfo(body.timezone)
        except zoneinfo.ZoneInfoNotFoundError, ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown timezone: {body.timezone!r}")
        s.timezone = body.timezone
    if body.debug_logs is not None:
        s.debug_logs = body.debug_logs
    s.save()
    invalidate_tz_cache()

    # Apply debug log level at runtime
    level = logging.DEBUG if s.debug_logs else logging.INFO
    logging.getLogger().setLevel(level)

    return s
