"""Storage stats service."""

from peewee import fn

from app.models.camera import Camera
from app.models.recording import Recording
from app.services.tz import fmt_dt


def get_storage_stats() -> dict:
    from app.models.scan_event import ScanEvent

    db_total: int = Recording.select().count()
    agg = (
        Recording.select(
            fn.SUM(Recording.file_size_bytes).alias("size"),
            fn.SUM(Recording.duration_secs).alias("duration"),
        )
        .where(Recording.status == "ready")
        .dicts()
        .get()
    )
    indexed_bytes = agg["size"] or 0
    indexed_duration_secs = agg["duration"] or 0

    last_scan = (
        ScanEvent.select()
        .where(ScanEvent.finished_at.is_null(False))
        .order_by(ScanEvent.finished_at.desc())
        .first()
    )
    last_scan_finished = fmt_dt(last_scan.finished_at) if last_scan else None

    camera_stats = []
    for cam in Camera.select().order_by(Camera.display_order, Camera.name):
        cam_recs = Recording.select().where(Recording.camera_id == cam.id)
        count = cam_recs.count()
        cam_agg = (
            cam_recs.select(
                fn.SUM(Recording.file_size_bytes).alias("size"),
                fn.SUM(Recording.duration_secs).alias("duration"),
            )
            .where(Recording.status == "ready")
            .dicts()
            .get()
        )
        last_rec = cam_recs.order_by(Recording.end_time.desc()).first()
        latest_video_at = fmt_dt((last_rec.end_time or last_rec.start_time) if last_rec else None)
        camera_stats.append(
            {
                "id": cam.id,
                "name": cam.name,
                "enabled": cam.enabled,
                "recordings": count,
                "duration_secs": cam_agg["duration"] or 0,
                "indexed_size_bytes": cam_agg["size"] or 0,
                "latest_video_at": latest_video_at,
            }
        )

    return {
        "indexed_recordings": db_total,
        "indexed_size_bytes": indexed_bytes,
        "indexed_duration_secs": indexed_duration_secs,
        "last_scan_finished": last_scan_finished,
        "cameras": camera_stats,
    }
