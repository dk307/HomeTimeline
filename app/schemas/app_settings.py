from pydantic import BaseModel, Field


class AppSettingsOut(BaseModel):
    scan_interval_minutes: int
    timezone: str

    model_config = {"from_attributes": True}


class AppSettingsUpdate(BaseModel):
    scan_interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    timezone: str | None = None
