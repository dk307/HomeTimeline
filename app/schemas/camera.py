from datetime import datetime

from pydantic import BaseModel, Field


class CameraBase(BaseModel):
    name: str
    description: str | None = None
    camera_type: str = "generic"
    location_id: int | None = None
    recording_path: str
    enabled: bool = True
    display_order: int = 0
    time_source: str = "mtime"
    # Automatic scan interval in minutes; None = Never (manual scans only).
    scan_interval_minutes: int | None = Field(default=None, ge=1, le=1440)


class CameraCreate(CameraBase):
    pass


class CameraUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    camera_type: str | None = None
    location_id: int | None = None
    recording_path: str | None = None
    enabled: bool | None = None
    display_order: int | None = None
    time_source: str | None = None
    scan_interval_minutes: int | None = Field(default=None, ge=1, le=1440)


class CameraOut(CameraBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
