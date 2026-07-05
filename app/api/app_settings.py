import zoneinfo

from fastapi import APIRouter, HTTPException

from app.models.app_settings import AppSettings
from app.schemas.app_settings import AppSettingsOut, AppSettingsUpdate
from app.services.tz import invalidate_tz_cache

router = APIRouter(prefix="/settings", tags=["settings"])


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
    s.save()
    invalidate_tz_cache()
    return s
