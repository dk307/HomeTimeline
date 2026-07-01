from fastapi import APIRouter

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
        s.save()
        from app.workers.scheduler import reschedule

        reschedule(s.scan_interval_minutes)
    return s
