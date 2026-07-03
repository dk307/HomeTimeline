"""Timeline endpoint — returns recordings for a date range across cameras."""

import zoneinfo
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query

from app.models.camera import Camera
from app.models.recording import Recording
from app.schemas.recording import TimelineSegment
from app.services.tz import get_app_tz, to_app_tz

router = APIRouter(prefix="/timeline", tags=["timeline"])

_UTC_TZ = zoneinfo.ZoneInfo("UTC")


@router.get("", response_model=list[TimelineSegment])
def get_timeline(
    date: str = Query(..., description="YYYY-MM-DD start date"),
    days: int = Query(1, ge=1, le=90, description="Number of days to include"),
    camera_ids: str | None = Query(None, description="Comma-separated camera IDs"),
):
    try:
        day_start_naive = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid date — use YYYY-MM-DD")

    # Interpret the requested date as midnight in the configured app timezone,
    # then convert to UTC-naive for DB comparison (DB stores UTC-naive).
    app_tz = get_app_tz()
    day_start_aware = day_start_naive.replace(tzinfo=app_tz)
    day_end_aware = day_start_aware + timedelta(days=days)
    day_start = day_start_aware.astimezone(_UTC_TZ).replace(tzinfo=None)
    day_end = day_end_aware.astimezone(_UTC_TZ).replace(tzinfo=None)

    q = (
        Recording.select(Recording, Camera)
        .join(Camera)
        .where(
            (Recording.start_time < day_end)
            & (Recording.end_time.is_null(True) | (Recording.end_time >= day_start))
            & (Recording.status == "ready")
        )
    )

    if camera_ids:
        ids = [int(i) for i in camera_ids.split(",") if i.strip().isdigit()]
        if ids:
            q = q.where(Recording.camera_id.in_(ids))

    segments = []
    for r in q.order_by(Recording.camera_id, Recording.start_time):
        segments.append(
            TimelineSegment(
                camera_id=r.camera_id,
                camera_name=r.camera.name,
                recording_id=r.id,
                start_time=to_app_tz(r.start_time),
                end_time=to_app_tz(r.end_time or r.start_time),
                duration_secs=r.duration_secs,
                thumbnail_path=r.thumbnail_path,
                status=r.status,
            )
        )
    return segments
