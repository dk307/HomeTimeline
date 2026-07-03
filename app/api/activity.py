from fastapi import APIRouter, Query

from app.models.scan_event import ScanEvent
from app.services.tz import fmt_dt

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("")
def list_activity(limit: int = Query(50, le=200)):
    events = ScanEvent.select().order_by(ScanEvent.started_at.desc()).limit(limit)
    return [
        {
            "id": e.id,
            "started_at": fmt_dt(e.started_at),
            "finished_at": fmt_dt(e.finished_at),
            "new_recordings": e.new_recordings,
            "skipped_recordings": getattr(e, "skipped_recordings", 0) or 0,
            "cameras_scanned": e.cameras_scanned,
            "status": e.status,
            "detail": e.detail,
        }
        for e in events
    ]
