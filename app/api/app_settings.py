import zoneinfo

from fastapi import APIRouter, HTTPException

from app.models.app_settings import AppSettings
from app.schemas.app_settings import AppSettingsOut, AppSettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=AppSettingsOut)
def get_settings():
    return AppSettings.get_instance()


@router.patch("", response_model=AppSettingsOut)
def update_settings(body: AppSettingsUpdate):
    s = AppSettings.get_instance()
    if body.scan_interval_minutes is not None:
        s.scan_interval_minutes = body.scan_interval_minutes
        from app.workers.scheduler import reschedule

        reschedule(s.scan_interval_minutes)
    if body.timezone is not None:
        try:
            zoneinfo.ZoneInfo(body.timezone)
        except zoneinfo.ZoneInfoNotFoundError:
            raise HTTPException(status_code=400, detail=f"Unknown timezone: {body.timezone!r}")
        s.timezone = body.timezone
    s.save()
    return s
