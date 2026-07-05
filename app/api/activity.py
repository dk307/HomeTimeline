from datetime import datetime

from fastapi import APIRouter, Query

from app.models.camera import Camera
from app.models.download_event import DownloadEvent
from app.models.scan_event import ScanEvent
from app.services.tz import fmt_dt

router = APIRouter(prefix="/activity", tags=["activity"])


@router.get("")
def list_activity(limit: int = Query(50, le=200)):
    """Unified recent activity: scan runs and Hikvision download runs, newest first."""
    items: list[tuple[datetime, dict]] = []

    for e in ScanEvent.select().order_by(ScanEvent.started_at.desc()).limit(limit):
        items.append(
            (
                e.started_at,
                {
                    "type": "scan",
                    "id": e.id,
                    "started_at": fmt_dt(e.started_at),
                    "finished_at": fmt_dt(e.finished_at),
                    "new_recordings": e.new_recordings,
                    "skipped_recordings": getattr(e, "skipped_recordings", 0) or 0,
                    "cameras_scanned": e.cameras_scanned,
                    "status": e.status,
                    "detail": e.detail,
                },
            )
        )

    # Join Camera so e.camera.name is prefetched (no per-row lazy query).
    download_q = (
        DownloadEvent.select(DownloadEvent, Camera)
        .join(Camera)
        .order_by(DownloadEvent.started_at.desc())
        .limit(limit)
    )
    for e in download_q:
        items.append(
            (
                e.started_at,
                {
                    "type": "download",
                    "id": e.id,
                    "started_at": fmt_dt(e.started_at),
                    "finished_at": fmt_dt(e.finished_at),
                    "camera": e.camera.name,
                    "downloaded": e.downloaded,
                    "indexed": e.indexed,
                    "status": e.status,
                    "detail": e.detail,
                },
            )
        )

    # Both tables store naive datetimes (peewee), so they sort together cleanly.
    items.sort(key=lambda t: t[0] or datetime.min, reverse=True)
    return [payload for _, payload in items[:limit]]
