from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

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
    # Milliseconds into the clip to grab the thumbnail frame (default 1000 = 1 s).
    thumbnail_delay_ms: int | None = Field(default=None, ge=0)


class CameraCreate(CameraBase):
    # Input-only: stored plaintext, never returned in responses.
    password: str | None = None
    aqura_password: str | None = None

    @model_validator(mode="after")
    def _require_host_for_hikvision(self):
        if self.camera_type == "hikvision" and not (self.host or "").strip():
            raise ValueError("host is required for Hikvision cameras")
        if self.camera_type == "aqura" and not (self.stream_url_1 or "").strip():
            raise ValueError("stream_url_1 is required for Aqura cameras")
        return self


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
    thumbnail_delay_ms: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _require_host_for_hikvision(self):
        camera_type = self.camera_type
        host = self.host
        stream_url_1 = self.stream_url_1
        # When switching type to hikvision, host must be provided; when host is
        # explicitly sent, it must not be empty.
        if camera_type == "hikvision" or "camera_type" in self.model_fields_set:
            if camera_type == "hikvision" and (host is None or not host.strip()):
                raise ValueError("host is required for Hikvision cameras")
        if host is not None and not host.strip():
            raise ValueError("host cannot be empty")
        # When switching type to aqura, stream_url_1 must be provided.
        if camera_type == "aqura" or "camera_type" in self.model_fields_set:
            if camera_type == "aqura" and (stream_url_1 is None or not stream_url_1.strip()):
                raise ValueError("stream_url_1 is required for Aqura cameras")
        if stream_url_1 is not None and not stream_url_1.strip():
            raise ValueError("stream_url_1 cannot be empty")
        return self


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
