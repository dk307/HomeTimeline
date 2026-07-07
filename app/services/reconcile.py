"""Reconcile activity events left open by an unclean shutdown.

A scan / download / purge run writes its event row with ``finished_at = NULL``
at the start and fills in the outcome when it completes. If the process dies
mid-run — most commonly because the Docker container was restarted — that row is
orphaned: ``finished_at`` stays NULL and ``status`` keeps its ``"ok"`` default,
so Activity shows the run as spinning forever (then merely "stale" after a
timeout). On startup we close out any such row as ``"interrupted"`` so Activity
reflects what actually happened.

This runs once at startup, *before* the scheduler starts, so no genuinely
in-progress run can be misclassified.
"""

import logging

from app.models.base import utcnow
from app.models.download_event import DownloadEvent
from app.models.purge_event import PurgeEvent
from app.models.scan_event import ScanEvent

logger = logging.getLogger(__name__)

INTERRUPTED_STATUS = "interrupted"
INTERRUPTED_DETAIL = "Interrupted — the service restarted before this run finished."

_EVENT_MODELS = (ScanEvent, DownloadEvent, PurgeEvent)


def reconcile_interrupted_events() -> int:
    """Close out every still-open activity event as interrupted.

    Returns the number of rows updated across all event tables.
    """
    now = utcnow()
    total = 0
    for model in _EVENT_MODELS:
        total += (
            model.update(
                status=INTERRUPTED_STATUS,
                finished_at=now,
                detail=INTERRUPTED_DETAIL,
            )
            .where(model.finished_at.is_null(True))
            .execute()
        )
    if total:
        logger.warning(
            "Marked %d activity event(s) as interrupted (unfinished from a previous run)", total
        )
    return total
