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


def _run_camera_scan(camera_id: int) -> None:
    from app.services.scanner import scan_single_camera

    try:
        results = scan_single_camera(camera_id)
        total = sum(results.values())
        logger.info("Scheduled scan for camera %s complete. New recordings: %d", camera_id, total)
    except Exception as exc:
        logger.error("Scheduled scan for camera %s failed: %s", camera_id, exc, exc_info=True)


def reschedule_camera(camera_id: int, minutes: int | None) -> None:
    """Add/replace this camera's scan job, or remove it when ``minutes`` is falsy.

    Safe no-op if the scheduler hasn't been started (e.g. during tests).
    """
    if not (_scheduler and _scheduler.running):
        return
    jid = _job_id(camera_id)
    if minutes:
        _scheduler.add_job(
            _run_camera_scan,
            trigger=IntervalTrigger(minutes=minutes),
            id=jid,
            args=[camera_id],
            replace_existing=True,
        )
        logger.info("Camera %s scan scheduled every %d min", camera_id, minutes)
    elif _scheduler.get_job(jid):
        _scheduler.remove_job(jid)
        logger.info("Camera %s automatic scan disabled", camera_id)


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
            logger.error("Failed to schedule scan for camera %s: %s", cam.id, exc, exc_info=True)

    logger.info("Scheduler started — %d camera scan job(s)", count)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
