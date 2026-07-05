"""Purge old recordings for a camera: delete the video file, its thumbnail, and
the index row for any clip older than the camera's retention window.

Mirrors ``downloader.py``: a per-camera lock registry serialises purges for the
same camera while allowing different cameras to run concurrently. A camera with
``purge_older_than_days`` unset (NULL = Never) keeps everything — a purge run is
then a no-op.
"""

import logging
import threading
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path

from app.models.base import utcnow
from app.models.camera import Camera
from app.models.recording import Recording

logger = logging.getLogger(__name__)

# Per-camera purge locks (see downloader.py for the identical pattern).
# `_STOP_REQUESTED` holds ids whose in-progress purge should abort.
_PURGE_LOCKS: dict[int, threading.Lock] = {}
_PURGING: set[int] = set()
_STOP_REQUESTED: set[int] = set()
_PURGE_GUARD = threading.Lock()


def is_purging(camera_id: int | None = None) -> bool:
    """Whether a purge is in progress. With no argument, True if *any* camera is
    purging; with ``camera_id``, True only for that camera."""
    with _PURGE_GUARD:
        if camera_id is None:
            return bool(_PURGING)
        return camera_id in _PURGING


def request_purge_stop(camera_id: int) -> bool:
    """Ask the in-progress purge for ``camera_id`` to stop (between clips). Returns
    True if a purge was actually running."""
    with _PURGE_GUARD:
        if camera_id in _PURGING:
            _STOP_REQUESTED.add(camera_id)
            return True
        return False


def _stop_requested(camera_id: int) -> bool:
    with _PURGE_GUARD:
        return camera_id in _STOP_REQUESTED


def _camera_purge_lock(camera_id: int) -> threading.Lock:
    with _PURGE_GUARD:
        lock = _PURGE_LOCKS.get(camera_id)
        if lock is None:
            lock = threading.Lock()
            _PURGE_LOCKS[camera_id] = lock
        return lock


@contextmanager
def _acquire_purge_lock(camera_id: int):
    """Acquire the per-camera purge lock (non-blocking). Raises RuntimeError if that
    camera is already purging."""
    lock = _camera_purge_lock(camera_id)
    if not lock.acquire(blocking=False):
        raise RuntimeError(f"A purge is already running for camera {camera_id}")
    with _PURGE_GUARD:
        _PURGING.add(camera_id)
    try:
        yield
    finally:
        with _PURGE_GUARD:
            _PURGING.discard(camera_id)
            _STOP_REQUESTED.discard(camera_id)
        lock.release()


def _delete_file(path_str: str | None) -> int:
    """Delete a file by path if present. Returns its size in bytes (0 if missing or
    on error) so callers can tally reclaimed space."""
    if not path_str:
        return 0
    p = Path(path_str)
    try:
        size = p.stat().st_size
    except OSError:
        return 0
    try:
        p.unlink()
        return size
    except OSError as exc:
        logger.warning("Failed to delete %s: %s", p, exc)
        return 0


def purge_camera(camera: Camera) -> tuple[int, int]:
    """Delete recordings older than the camera's retention window.

    For each recording whose ``start_time`` is older than ``purge_older_than_days``,
    the video file, its thumbnail, and the index row are removed. Returns
    ``(deleted, freed_bytes)``. A camera with no retention set (Never) deletes
    nothing.
    """
    days = camera.purge_older_than_days
    if not days:  # None or 0 → Never (keep everything)
        return 0, 0

    # Storage stores naive-UTC datetimes (see base.utcnow); compare against a naive
    # cutoff so the boundary is timezone-consistent regardless of the server tz.
    cutoff = utcnow() - timedelta(days=days)

    deleted = 0
    freed = 0
    old = (
        Recording.select()
        .where((Recording.camera == camera.id) & (Recording.start_time < cutoff))
        .order_by(Recording.start_time)
    )
    for rec in old:
        if _stop_requested(camera.id):
            logger.info("Purge stopped by request for %s (%d deleted)", camera.name, deleted)
            break
        freed += _delete_file(rec.file_path)
        _delete_file(rec.thumbnail_path)
        rec.delete_instance()
        deleted += 1

    logger.info(
        "Camera %s: purged %d clip(s) older than %d day(s), freed %d bytes",
        camera.name,
        deleted,
        days,
        freed,
    )
    return deleted, freed


def purge_single_camera(camera_id: int, force: bool = False) -> dict[str, int]:
    """Purge one camera's old clips, recording a PurgeEvent.

    Returns ``{camera_name: deleted}`` or ``{}`` when skipped (already purging,
    camera missing, or disabled without ``force``). ``force=True`` (manual) runs
    even when the camera is disabled. Cameras with retention set to Never simply
    delete nothing.
    """
    from app.models.purge_event import PurgeEvent

    camera = Camera.get_or_none(Camera.id == camera_id)
    if not camera:
        return {}
    if not camera.enabled and not force:
        return {}

    try:
        lock_ctx = _acquire_purge_lock(camera_id)
        lock_ctx.__enter__()
    except RuntimeError:
        logger.info("purge_single_camera: camera %s already purging, skipping", camera_id)
        return {}

    # Everything past lock acquisition is wrapped so the lock is always released —
    # even if PurgeEvent.create()/save() itself raises.
    try:
        event = PurgeEvent.create(camera=camera, started_at=utcnow())
        try:
            deleted, freed = purge_camera(camera)
            camera.last_purged_at = utcnow()
            camera.save()

            event.deleted = deleted
            event.freed_bytes = freed
            event.finished_at = utcnow()
            event.status = "ok"
            event.detail = f"{camera.name} · {deleted} deleted · {_fmt_bytes(freed)} freed"
            logger.info(
                "purge_single_camera %s: %d deleted, %d bytes freed", camera.name, deleted, freed
            )
            return {camera.name: deleted}
        except Exception as exc:
            event.status = "error"
            event.detail = str(exc)
            event.finished_at = utcnow()
            logger.exception("purge_single_camera failed for %s: %s", camera.name, exc)
            return {}
        finally:
            event.save()
    finally:
        lock_ctx.__exit__(None, None, None)


def _fmt_bytes(n: int) -> str:
    """Compact human-readable byte size for the activity detail line."""
    size = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size < 1024 or unit == "TB":
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"
