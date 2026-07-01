from datetime import datetime

from pydantic import BaseModel


class RecordingOut(BaseModel):
    id: int
    camera_id: int
    file_path: str
    start_time: datetime
    end_time: datetime | None
    duration_secs: float | None
    file_size_bytes: int | None
    thumbnail_path: str | None
    notes: str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class RecordingUpdate(BaseModel):
    notes: str | None = None


class TimelineSegment(BaseModel):
    camera_id: int
    camera_name: str
    recording_id: int
    start_time: datetime
    end_time: datetime
    duration_secs: float | None
    thumbnail_path: str | None
    status: str
