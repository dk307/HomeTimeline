"""Scan recording directories and populate the database."""

import hashlib
import logging
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import ffmpeg

from app.config import settings
from app.models.camera import Camera
from app.models.recording import Recording

logger = logging.getLogger(__name__)

VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".ts", ".m4v"}

# Per-camera scan locks: a camera can only be scanned by one worker at a time,
# but different cameras scan concurrently. `_SCANNING` tracks the ids currently
# being scanned; both structures are guarded by `_SCAN_LOCKS_GUARD`.
_SCAN_LOCKS: dict[int, threading.Lock] = {}
_SCANNING: set[int] = set()
_SCAN_LOCKS_GUARD = threading.Lock()


def is_scanning(camera_id: int | None = None) -> bool:
    """Whether a scan is in progress. With no argument, True if *any* camera is
    scanning; with ``camera_id``, True only for that camera."""
    with _SCAN_LOCKS_GUARD:
        if camera_id is None:
            return bool(_SCANNING)
        return camera_id in _SCANNING


def _camera_lock(camera_id: int) -> threading.Lock:
    with _SCAN_LOCKS_GUARD:
        lock = _SCAN_LOCKS.get(camera_id)
        if lock is None:
            lock = threading.Lock()
            _SCAN_LOCKS[camera_id] = lock
        return lock


@contextmanager
def _acquire_scan_lock(camera_id: int):
    """Acquire the per-camera scan lock (non-blocking). Raises RuntimeError if that
    camera is already being scanned."""
    lock = _camera_lock(camera_id)
    if not lock.acquire(blocking=False):
        raise RuntimeError(f"A scan is already running for camera {camera_id}")
    with _SCAN_LOCKS_GUARD:
        _SCANNING.add(camera_id)
    try:
        yield
    finally:
        with _SCAN_LOCKS_GUARD:
            _SCANNING.discard(camera_id)
        lock.release()


def _file_hash(path: Path, chunk: int = 65536) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while data := f.read(chunk):
            h.update(data)
    return h.hexdigest()


def _probe_duration(path: Path) -> float | None:
    try:
        info = ffmpeg.probe(str(path))
        raw = info.get("format", {}).get("duration")
        return float(raw) if raw else None
    except Exception:
        return None


def _times_from_mtime(path: Path, duration_secs: float | None) -> tuple[datetime, datetime | None]:
    end_time = datetime.fromtimestamp(path.stat().st_mtime)
    if duration_secs:
        start_time = end_time - timedelta(seconds=duration_secs)
    else:
        start_time = end_time
    return start_time, end_time


def _date_from_folder(path: Path) -> date | None:
    """Extract a date from any path component matching YYYY-MM-DD."""
    for part in path.parts:
        try:
            return datetime.strptime(part, "%Y-%m-%d").date()
        except ValueError:
            continue
    return None


def _times_from_folder(path: Path, duration_secs: float | None) -> tuple[datetime, datetime | None]:
    folder_date = _date_from_folder(path)
    start_time = (
        datetime.combine(folder_date, datetime.min.time())
        if folder_date
        else datetime.fromtimestamp(path.stat().st_mtime)
    )
    end_time = start_time + timedelta(seconds=duration_secs) if duration_secs else None
    return start_time, end_time


def cleanup_missing(camera: Camera) -> int:
    removed = 0
    for rec in list(Recording.select().where(Recording.camera_id == camera.id)):
        if not Path(rec.file_path).exists():
            rec.delete_instance()
            removed += 1
            logger.info("Pruned missing file from index: %s", rec.file_path)
    if removed:
        logger.info("Cleanup %s: removed %d stale entries", camera.name, removed)
    return removed


def scan_camera(camera: Camera) -> tuple[int, int]:
    """Scan one camera recursively. Returns (added, skipped) counts."""
    from peewee import IntegrityError

    root = Path(camera.recording_path)
    if not root.exists():
        logger.warning("Recording path %s does not exist for camera %s", root, camera.name)
        return 0, 0

    time_source = getattr(camera, "time_source", "mtime")
    added = 0
    skipped = 0

    for path in sorted(root.rglob("*")):
        if path.suffix.lower() not in VIDEO_EXTENSIONS:
            continue
        str_path = str(path)
        if Recording.select().where(Recording.file_path == str_path).exists():
            skipped += 1
            continue

        try:
            duration_secs = _probe_duration(path)

            if time_source == "mtime":
                start_time, end_time = _times_from_mtime(path, duration_secs)
            else:
                start_time, end_time = _times_from_folder(path, duration_secs)

            fhash = _file_hash(path)
            thumb = _make_thumbnail(path)

            Recording.create(
                camera=camera,
                file_path=str_path,
                file_hash=fhash,
                start_time=start_time,
                end_time=end_time,
                duration_secs=duration_secs,
                file_size_bytes=path.stat().st_size,
                thumbnail_path=thumb,
                status="ready",
            )
            added += 1
            logger.info("Indexed %s start=%s", path.name, start_time.strftime("%Y-%m-%d %H:%M:%S"))
        except IntegrityError:
            skipped += 1
            logger.debug("Skipping already-indexed %s", path.name)
        except Exception as exc:
            logger.warning("Failed to index %s: %s", path, exc)
            try:
                Recording.create(
                    camera=camera,
                    file_path=str_path,
                    start_time=datetime.fromtimestamp(path.stat().st_mtime),
                    file_size_bytes=path.stat().st_size,
                    status="error",
                )
                added += 1
            except Exception:
                pass

    return added, skipped


def _make_thumbnail(video_path: Path) -> str | None:
    try:
        thumb_dir = Path(settings.thumbnail_dir)
        thumb_dir.mkdir(parents=True, exist_ok=True)
        thumb_name = video_path.stem + ".jpg"
        thumb_path = thumb_dir / thumb_name
        if thumb_path.exists():
            return str(thumb_path)
        (
            ffmpeg.input(str(video_path), ss=1)
            .output(str(thumb_path), vframes=1, format="image2", vcodec="mjpeg")
            .overwrite_output()
            .run(quiet=True)
        )
        return str(thumb_path)
    except Exception as exc:
        logger.warning("Thumbnail failed for %s: %s", video_path, exc)
        return None


def scan_all() -> dict[str, int]:
    """Scan all enabled cameras. Each camera is locked independently, so a camera
    already being scanned (e.g. by its scheduled job) is skipped, not blocked."""

    from app.models.scan_event import ScanEvent

    cameras = list(Camera.select().where(Camera.enabled == True))  # noqa: E712
    event = ScanEvent.create(
        started_at=datetime.now(tz=timezone.utc),
        cameras_scanned=0,
    )

    results: dict[str, int] = {}
    total_new = 0
    total_skipped = 0
    scanned = 0  # cameras actually processed (excludes those skipped as busy)
    camera_details: list[str] = []

    try:
        for camera in cameras:
            # Acquire this camera's lock separately so contention (already
            # scanning) is a skip, not an error, and doesn't hold up other cameras.
            try:
                lock_ctx = _acquire_scan_lock(camera.id)
                lock_ctx.__enter__()
            except RuntimeError:
                logger.info("scan_all: camera %s already scanning, skipping", camera.name)
                continue
            scanned += 1
            try:
                pruned = cleanup_missing(camera)
                if pruned:
                    logger.info("Pruned %d missing recordings for %s", pruned, camera.name)
                added, skipped = scan_camera(camera)
            finally:
                lock_ctx.__exit__(None, None, None)

            results[camera.name] = added
            total_new += added
            total_skipped += skipped
            parts = [camera.name]
            if added:
                parts.append(f"+{added} new")
            if skipped:
                parts.append(f"{skipped} already indexed")
            if pruned:
                parts.append(f"{pruned} pruned")
            camera_details.append(" · ".join(parts))

        event.new_recordings = total_new
        event.skipped_recordings = total_skipped
        event.finished_at = datetime.now(tz=timezone.utc)
        event.status = "ok"
        event.detail = " | ".join(camera_details) if camera_details else None
        logger.info(
            "scan_all done: %d new, %d skipped across %d cameras",
            total_new,
            total_skipped,
            scanned,
        )
    except Exception as exc:
        event.status = "error"
        event.detail = str(exc)
        event.finished_at = datetime.now(tz=timezone.utc)
        logger.exception("scan_all failed: %s", exc)
    finally:
        event.cameras_scanned = scanned
        event.save()

    return results


def scan_camera_locked(camera: Camera) -> tuple[int, int]:
    """Like scan_camera() but acquires that camera's lock. Raises RuntimeError if
    the camera is already being scanned."""
    with _acquire_scan_lock(camera.id):
        return scan_camera(camera)


def scan_single_camera(camera_id: int, force: bool = False) -> dict[str, int]:
    """Scan (prune missing + index new files) for one camera, recording a ScanEvent.

    Returns ``{camera_name: added}`` or ``{}`` when skipped (already scanning, or
    camera missing/disabled). ``force=True`` (manual scans) runs even when the
    camera is disabled; scheduled scans use the default and skip disabled cameras.
    """
    from app.models.scan_event import ScanEvent

    camera = Camera.get_or_none(Camera.id == camera_id)
    if not camera:
        return {}
    if not camera.enabled and not force:
        return {}

    try:
        lock_ctx = _acquire_scan_lock(camera_id)
        lock_ctx.__enter__()
    except RuntimeError:
        logger.info("scan_single_camera: camera %s already scanning, skipping", camera_id)
        return {}

    # Everything after acquiring the lock is wrapped so the lock is always
    # released — even if ScanEvent.create()/save() itself raises.
    try:
        event = ScanEvent.create(
            started_at=datetime.now(tz=timezone.utc),
            cameras_scanned=1,
        )
        try:
            pruned = cleanup_missing(camera)
            added, skipped = scan_camera(camera)
            event.new_recordings = added
            event.skipped_recordings = skipped
            event.finished_at = datetime.now(tz=timezone.utc)
            event.status = "ok"
            parts = [camera.name]
            if added:
                parts.append(f"+{added} new")
            if skipped:
                parts.append(f"{skipped} already indexed")
            if pruned:
                parts.append(f"{pruned} pruned")
            event.detail = " · ".join(parts)
            logger.info("scan_single_camera %s: +%d new, %d skipped", camera.name, added, skipped)
            return {camera.name: added}
        except Exception as exc:
            event.status = "error"
            event.detail = str(exc)
            event.finished_at = datetime.now(tz=timezone.utc)
            logger.exception("scan_single_camera failed for %s: %s", camera.name, exc)
            return {}
        finally:
            event.save()
    finally:
        lock_ctx.__exit__(None, None, None)
