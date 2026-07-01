"""APScheduler background job — periodic scanner."""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import settings

logger = logging.getLogger(__name__)
_scheduler: BackgroundScheduler | None = None


def _run_scan() -> None:
    from app.services.scanner import scan_all

    try:
        results = scan_all()
        total = sum(results.values())
        logger.info("Scheduled scan complete. New recordings: %d (%s)", total, results)
    except Exception as exc:
        logger.error("Scheduled scan failed: %s", exc, exc_info=True)


def start_scheduler() -> None:
    global _scheduler
    _scheduler = BackgroundScheduler(daemon=True)
    _scheduler.add_job(
        _run_scan,
        trigger=IntervalTrigger(minutes=settings.scan_interval_minutes),
        id="periodic_scan",
        replace_existing=True,
    )
    _scheduler.start()
    logger.info("Scheduler started — scan every %d min", settings.scan_interval_minutes)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
