from fastapi import APIRouter, Query

from app.models.scan_event import ScanEvent

router = APIRouter(prefix="/activity", tags=["activity"])


def _fmt(dt) -> str | None:
    if dt is None:
        return None
    s = dt.isoformat()
    # Remove trailing Z if already has +00:00 offset
    if s.endswith("+00:00Z"):
        s = s[:-1]
    return s


@router.get("")
def list_activity(limit: int = Query(50, le=200)):
    events = ScanEvent.select().order_by(ScanEvent.started_at.desc()).limit(limit)
    return [
        {
            "id": e.id,
            "started_at": _fmt(e.started_at),
            "finished_at": _fmt(e.finished_at),
            "new_recordings": e.new_recordings,
            "skipped_recordings": getattr(e, "skipped_recordings", 0) or 0,
            "cameras_scanned": e.cameras_scanned,
            "status": e.status,
            "detail": e.detail,
        }
        for e in events
    ]
