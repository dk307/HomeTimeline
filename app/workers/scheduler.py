"""APScheduler background jobs — one periodic filesystem scan per camera.

Each camera carries its own ``scan_interval_minutes``. A positive value gets a
dedicated interval job; ``None``/``0`` (Never) means no automatic scan — the
camera is still scannable manually via "Scan Now" or per-camera reindex.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None


def _job_id(camera_id: int) -> str:
    return f"camera_scan_{camera_id}"


def _download_job_id(camera_id: int) -> str:
    return f"camera_download_{camera_id}"


def _purge_job_id(camera_id: int) -> str:
    return f"camera_purge_{camera_id}"


def _camera_name(camera_id: int) -> str:
    from app.models.camera import Camera

    cam = Camera.get_or_none(Camera.id == camera_id)
    return cam.name if cam else str(camera_id)


def _run_camera_scan(camera_id: int) -> None:
    from app.services.scanner import scan_single_camera

    camera_name = _camera_name(camera_id)
    try:
        results = scan_single_camera(camera_id)
        total = sum(results.values())
        logger.info(
            "Scheduled scan for camera %s complete. New recordings: %d",
            camera_id,
            total,
            extra={"camera_name": camera_name},
        )
    except Exception as exc:
        logger.error(
            "Scheduled scan for camera %s failed: %s",
            camera_id,
            exc,
            exc_info=True,
            extra={"camera_name": camera_name},
        )


def _run_camera_download(camera_id: int) -> None:
    from app.services.downloader import download_single_camera

    camera_name = _camera_name(camera_id)
    try:
        results = download_single_camera(camera_id)
        total = sum(results.values())
        logger.info(
            "Scheduled download for camera %s complete. Clips downloaded: %d",
            camera_id,
            total,
            extra={"camera_name": camera_name},
        )
    except Exception as exc:
        logger.error(
            "Scheduled download for camera %s failed: %s",
            camera_id,
            exc,
            exc_info=True,
            extra={"camera_name": camera_name},
        )


def _run_camera_purge(camera_id: int) -> None:
    from app.services.purger import purge_single_camera

    camera_name = _camera_name(camera_id)
    try:
        results = purge_single_camera(camera_id)
        total = sum(results.values())
        logger.info(
            "Scheduled purge for camera %s complete. Clips deleted: %d",
            camera_id,
            total,
            extra={"camera_name": camera_name},
        )
    except Exception as exc:
        logger.error(
            "Scheduled purge for camera %s failed: %s",
            camera_id,
            exc,
            exc_info=True,
            extra={"camera_name": camera_name},
        )


def _reschedule_job(jid: str, func, camera_id: int, minutes: int | None, label: str) -> None:
    """Add/replace a per-camera interval job, or remove it when ``minutes`` is falsy.

    Shared by the scan/download/purge helpers below. ``label`` names the job kind
    in the log line. Safe no-op if the scheduler hasn't been started (e.g. tests).
    """
    if not (_scheduler and _scheduler.running):
        return
    camera_name = _camera_name(camera_id)
    if minutes:
        _scheduler.add_job(
            func,
            trigger=IntervalTrigger(minutes=minutes),
            id=jid,
            args=[camera_id],
            replace_existing=True,
        )
        logger.info(
            "Camera %s %s scheduled every %d min",
            camera_id,
            label,
            minutes,
            extra={"camera_name": camera_name},
        )
    elif _scheduler.get_job(jid):
        _scheduler.remove_job(jid)
        logger.info(
            "Camera %s automatic %s disabled", camera_id, label, extra={"camera_name": camera_name}
        )


def reschedule_camera(camera_id: int, minutes: int | None) -> None:
    """Add/replace this camera's scan job, or remove it when ``minutes`` is falsy."""
    _reschedule_job(_job_id(camera_id), _run_camera_scan, camera_id, minutes, "scan")


def reschedule_camera_download(camera_id: int, minutes: int | None) -> None:
    """Add/replace this camera's download job, or remove it when ``minutes`` is falsy."""
    _reschedule_job(
        _download_job_id(camera_id), _run_camera_download, camera_id, minutes, "download"
    )


def reschedule_camera_purge(camera_id: int, minutes: int | None) -> None:
    """Add/replace this camera's purge job, or remove it when ``minutes`` is falsy."""
    _reschedule_job(_purge_job_id(camera_id), _run_camera_purge, camera_id, minutes, "purge")


def start_scheduler() -> None:
    global _scheduler
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.start()

    count = 0
    try:
        from app.models.camera import Camera

        cameras = list(Camera.select().where(Camera.enabled == True))  # noqa: E712
    except Exception as exc:
        logger.error("Failed to load cameras for scheduling: %s", exc, exc_info=True)
        cameras = []

    # Schedule each camera independently so one failure doesn't skip the rest.
    for cam in cameras:
        if not cam.scan_interval_minutes:
            continue
        try:
            reschedule_camera(cam.id, cam.scan_interval_minutes)
            count += 1
        except Exception as exc:
            logger.error(
                "Failed to schedule scan for camera %s: %s",
                cam.id,
                exc,
                exc_info=True,
                extra={"camera_name": cam.name},
            )

    # Download jobs — Hikvision cameras with a positive download interval only.
    download_count = 0
    for cam in cameras:
        if cam.camera_type != "hikvision" or not cam.download_interval_minutes:
            continue
        try:
            reschedule_camera_download(cam.id, cam.download_interval_minutes)
            download_count += 1
        except Exception as exc:
            logger.error(
                "Failed to schedule download for camera %s: %s",
                cam.id,
                exc,
                exc_info=True,
                extra={"camera_name": cam.name},
            )

    # Purge jobs — Hikvision cameras with a positive purge interval only.
    purge_count = 0
    for cam in cameras:
        if cam.camera_type != "hikvision" or not cam.purge_interval_minutes:
            continue
        try:
            reschedule_camera_purge(cam.id, cam.purge_interval_minutes)
            purge_count += 1
        except Exception as exc:
            logger.error(
                "Failed to schedule purge for camera %s: %s",
                cam.id,
                exc,
                exc_info=True,
                extra={"camera_name": cam.name},
            )

    logger.info(
        "Scheduler started — %d scan job(s), %d download job(s), %d purge job(s)",
        count,
        download_count,
        purge_count,
    )


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
