from datetime import UTC, datetime

from fastapi import APIRouter, Query

from app.models.camera import Camera
from app.models.download_event import DownloadEvent
from app.models.purge_event import PurgeEvent
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

    # Join Camera so e.camera.name is prefetched (no per-row lazy query).
    purge_q = (
        PurgeEvent.select(PurgeEvent, Camera)
        .join(Camera)
        .order_by(PurgeEvent.started_at.desc())
        .limit(limit)
    )
    for e in purge_q:
        items.append(
            (
                e.started_at,
                {
                    "type": "purge",
                    "id": e.id,
                    "started_at": fmt_dt(e.started_at),
                    "finished_at": fmt_dt(e.finished_at),
                    "camera": e.camera.name,
                    "deleted": e.deleted,
                    "freed_bytes": e.freed_bytes,
                    "status": e.status,
                    "detail": e.detail,
                },
            )
        )

    # ScanEvent and DownloadEvent historically stored started_at with differing
    # tz-awareness (aware-UTC vs. naive), so comparing them directly raises
    # "can't compare offset-naive and offset-aware datetimes". Normalise every key
    # to aware-UTC (naive is treated as UTC, the storage convention) before sorting.
    def _sort_key(dt: datetime | None) -> datetime:
        dt = dt or datetime.min
        return dt if dt.tzinfo else dt.replace(tzinfo=UTC)

    items.sort(key=lambda t: _sort_key(t[0]), reverse=True)
    return [payload for _, payload in items[:limit]]
