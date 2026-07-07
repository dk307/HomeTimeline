"""Startup reconciliation of activity events left open by an unclean shutdown."""

from app.models.base import utcnow
from app.models.download_event import DownloadEvent
from app.models.purge_event import PurgeEvent
from app.models.scan_event import ScanEvent
from app.services.reconcile import (
    INTERRUPTED_DETAIL,
    INTERRUPTED_STATUS,
    reconcile_interrupted_events,
)


def test_marks_open_events_across_all_tables(camera):
    """Every event with a NULL finished_at is closed out as interrupted."""
    open_scan = ScanEvent.create(started_at=utcnow(), cameras_scanned=1)
    open_download = DownloadEvent.create(camera=camera, started_at=utcnow())
    open_purge = PurgeEvent.create(camera=camera, started_at=utcnow())

    assert reconcile_interrupted_events() == 3

    for row in (open_scan, open_download, open_purge):
        row = type(row).get_by_id(row.id)
        assert row.status == INTERRUPTED_STATUS
        assert row.finished_at is not None
        assert row.detail == INTERRUPTED_DETAIL


def test_leaves_finished_events_untouched(camera):
    """Completed runs (ok or error) keep their status and detail."""
    done = ScanEvent.create(
        started_at=utcnow(), finished_at=utcnow(), status="ok", detail="+3 new"
    )
    failed = DownloadEvent.create(
        camera=camera, started_at=utcnow(), finished_at=utcnow(), status="error", detail="boom"
    )

    assert reconcile_interrupted_events() == 0

    assert ScanEvent.get_by_id(done.id).status == "ok"
    assert ScanEvent.get_by_id(done.id).detail == "+3 new"
    assert DownloadEvent.get_by_id(failed.id).status == "error"


def test_is_idempotent(camera):
    """A second pass finds nothing left to reconcile."""
    ScanEvent.create(started_at=utcnow())
    assert reconcile_interrupted_events() == 1
    assert reconcile_interrupted_events() == 0
