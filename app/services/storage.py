"""Storage stats service."""


from app.models.camera import Camera
from app.models.recording import Recording


def _fmt_dt(dt) -> str | None:
    if dt is None:
        return None
    s = dt.isoformat()
    if not s.endswith("Z") and "+" not in s:
        s += "Z"
    return s


def get_storage_stats() -> dict:

    from app.models.scan_event import ScanEvent

    db_total: int = Recording.select().count()
    db_size = (
        Recording.select(Recording.file_size_bytes).where(Recording.status == "ready").tuples()
    )
    indexed_bytes = sum(r[0] or 0 for r in db_size)

    # Last completed scan_all (cameras_scanned > 1 or the only scan)
    last_scan = (
        ScanEvent.select()
        .where(ScanEvent.finished_at.is_null(False))
        .order_by(ScanEvent.finished_at.desc())
        .first()
    )
    last_scan_finished = _fmt_dt(last_scan.finished_at) if last_scan else None

    # Per-camera breakdown — use most recent Recording.created_at as last-indexed proxy
    camera_stats = []
    for cam in Camera.select().order_by(Camera.display_order, Camera.name):
        cam_recs = Recording.select().where(Recording.camera_id == cam.id)
        count = cam_recs.count()
        size = sum(r.file_size_bytes or 0 for r in cam_recs.where(Recording.status == "ready"))
        # Latest video = end_time (or start_time) of the most recent recording
        last_rec = cam_recs.order_by(Recording.end_time.desc()).first()
        latest_video_at = _fmt_dt((last_rec.end_time or last_rec.start_time) if last_rec else None)
        camera_stats.append(
            {
                "id": cam.id,
                "name": cam.name,
                "enabled": cam.enabled,
                "recordings": count,
                "indexed_size_bytes": size,
                "latest_video_at": latest_video_at,
            }
        )

    return {
        "indexed_recordings": db_total,
        "indexed_size_bytes": indexed_bytes,
        "last_scan_finished": last_scan_finished,
        "cameras": camera_stats,
    }
