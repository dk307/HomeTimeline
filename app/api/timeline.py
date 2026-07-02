"""Timeline endpoint — returns recordings for a date range across cameras."""

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query

from app.models.camera import Camera
from app.models.recording import Recording
from app.schemas.recording import TimelineSegment

router = APIRouter(prefix="/timeline", tags=["timeline"])


@router.get("", response_model=list[TimelineSegment])
def get_timeline(
    date: str = Query(..., description="YYYY-MM-DD start date"),
    days: int = Query(1, ge=1, le=90, description="Number of days to include"),
    camera_ids: str | None = Query(None, description="Comma-separated camera IDs"),
):
    try:
        day_start = datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(400, "Invalid date — use YYYY-MM-DD")

    day_end = day_start + timedelta(days=days)

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
                start_time=r.start_time,
                end_time=r.end_time or r.start_time,
                duration_secs=r.duration_secs,
                thumbnail_path=r.thumbnail_path,
                status=r.status,
            )
        )
    return segments
