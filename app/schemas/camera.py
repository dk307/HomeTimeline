from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

CameraType = Literal["generic", "hikvision", "aqura"]
ClipStrategy = Literal["daily_folder", "aqura_nas_upload"]


class CameraBase(BaseModel):
    name: str
    description: str | None = None
    camera_type: CameraType = "hikvision"
    location_id: int | None = None
    recording_path: str
    enabled: bool = True
    display_order: int = 0
    clip_strategy: ClipStrategy = "daily_folder"
    # Automatic scan interval in minutes; None = Never (manual scans only).
    scan_interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    # Hikvision connection + download settings.
    host: str | None = None
    username: str | None = None
    # Automatic download interval in minutes; None = Never (manual only).
    download_interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    # Purge clips older than this many days; None = Never (keep everything).
    purge_older_than_days: int | None = Field(default=None, ge=1, le=3650)
    # Automatic purge interval in minutes; None = Never (manual only).
    purge_interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    # Aqura-specific: 3 custom RTSP stream URLs + RTSP credentials.
    stream_url_1: str | None = None
    stream_url_2: str | None = None
    stream_url_3: str | None = None
    aqura_username: str | None = None


class CameraCreate(CameraBase):
    # Input-only: stored plaintext, never returned in responses.
    password: str | None = None
    aqura_password: str | None = None


class CameraUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    camera_type: CameraType | None = None
    location_id: int | None = None
    recording_path: str | None = None
    enabled: bool | None = None
    display_order: int | None = None
    clip_strategy: ClipStrategy | None = None
    scan_interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    host: str | None = None
    username: str | None = None
    password: str | None = None
    download_interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    purge_older_than_days: int | None = Field(default=None, ge=1, le=3650)
    purge_interval_minutes: int | None = Field(default=None, ge=1, le=1440)
    stream_url_1: str | None = None
    stream_url_2: str | None = None
    stream_url_3: str | None = None
    aqura_username: str | None = None
    aqura_password: str | None = None


class CameraOut(CameraBase):
    id: int
    # True when a password is stored, without exposing the value itself.
    has_password: bool = False
    aqura_has_password: bool = False
    last_downloaded_at: datetime | None = None
    last_purged_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
