"""Download recordings from Hikvision cameras and index them.

Mirrors ``scanner.py``: a per-camera lock registry serialises downloads for the
same camera while allowing different cameras to download concurrently. Downloaded
clips are written into the camera's ``recording_path`` (per-day YYYY-MM-DD folders)
and then indexed by reusing ``scanner.scan_camera``.
"""

import asyncio
import logging
import threading
from contextlib import contextmanager
from pathlib import Path

from app.models.base import utcnow
from app.models.camera import Camera
from app.services import hikvision, scanner
from app.services.tz import to_app_tz

logger = logging.getLogger(__name__)

# Per-camera download locks (see scanner.py for the identical pattern).
# `_STOP_REQUESTED` holds ids whose in-progress download should abort.
_DOWNLOAD_LOCKS: dict[int, threading.Lock] = {}
_DOWNLOADING: set[int] = set()
_STOP_REQUESTED: set[int] = set()
_DOWNLOAD_GUARD = threading.Lock()


def is_downloading(camera_id: int | None = None) -> bool:
    """Whether a download is in progress. With no argument, True if *any* camera is
    downloading; with ``camera_id``, True only for that camera."""
    with _DOWNLOAD_GUARD:
        if camera_id is None:
            return bool(_DOWNLOADING)
        return camera_id in _DOWNLOADING


def request_download_stop(camera_id: int) -> bool:
    """Ask the in-progress download for ``camera_id`` to stop (between clips and
    mid-stream). Returns True if a download was actually running."""
    with _DOWNLOAD_GUARD:
        if camera_id in _DOWNLOADING:
            _STOP_REQUESTED.add(camera_id)
            return True
        return False


def _stop_requested(camera_id: int) -> bool:
    with _DOWNLOAD_GUARD:
        return camera_id in _STOP_REQUESTED


def _camera_download_lock(camera_id: int) -> threading.Lock:
    with _DOWNLOAD_GUARD:
        lock = _DOWNLOAD_LOCKS.get(camera_id)
        if lock is None:
            lock = threading.Lock()
            _DOWNLOAD_LOCKS[camera_id] = lock
        return lock


@contextmanager
def _acquire_download_lock(camera_id: int):
    """Acquire the per-camera download lock (non-blocking). Raises RuntimeError if
    that camera is already downloading."""
    lock = _camera_download_lock(camera_id)
    if not lock.acquire(blocking=False):
        raise RuntimeError(f"A download is already running for camera {camera_id}")
    with _DOWNLOAD_GUARD:
        _DOWNLOADING.add(camera_id)
    try:
        yield
    finally:
        with _DOWNLOAD_GUARD:
            _DOWNLOADING.discard(camera_id)
            _STOP_REQUESTED.discard(camera_id)
        lock.release()


async def _download_all(camera: Camera) -> tuple[int, int, int]:
    """Search the camera's whole catalog and download any clips not already on disk.

    Each clip is **indexed immediately after it is downloaded** (not in a separate
    pass afterwards), so freshly-downloaded videos become searchable right away.
    Returns ``(downloaded, indexed, errored)``. Existing ``.mp4`` files are skipped,
    which is the dedup mechanism (no incremental watermark).
    """
    out_root = Path(camera.recording_path).expanduser()
    out_root.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    indexed = 0
    errored = 0

    async with hikvision.HikvisionClient(camera.host, camera.username, camera.password) as hk:
        recordings = await hk.search_all_recordings(batch_size=40)
        logger.info("Camera %s: %d recordings on device", camera.name, len(recordings))
        recordings.sort(key=lambda r: r["start_time"])  # oldest first

        should_stop = lambda: _stop_requested(camera.id)  # noqa: E731
        for v in recordings:
            if should_stop():
                logger.info("Download stopped by request for %s (%d done)", camera.name, downloaded)
                break
            try:
                # Day folder uses the app's configured timezone (not the container's
                # system tz, which is typically UTC) so clips land in the same
                # YYYY-MM-DD folder regardless of where the app runs — avoiding
                # day-boundary duplicates.
                local_day = to_app_tz(v["start_time"]).strftime("%Y-%m-%d")
                day_dir = out_root / local_day
                safe_name = hikvision.build_clip_name_from_recording(v)
                if not safe_name:
                    logger.warning("Camera %s: clip missing name, skipping", camera.name)
                    errored += 1
                    continue
                dest_mp4 = (day_dir / safe_name).with_suffix(".mp4")
                if dest_mp4.exists():
                    continue

                day_dir.mkdir(parents=True, exist_ok=True)
                await hk.download_clip(v["playback_uri"], dest_mp4, should_stop=should_stop)
                hikvision.set_file_times(dest_mp4, v["start_time"], v["end_time"])
                hikvision.set_mp4_metadata(dest_mp4, v["start_time"], v["track_id"], camera.name, camera.host, safe_name)
                downloaded += 1
                logger.info("Downloaded %s", dest_mp4)
                # Index the clip right away so it's searchable immediately.
                if scanner.index_recording(camera, dest_mp4) == "added":
                    indexed += 1
            except hikvision.DownloadStopped:
                logger.info("Download stopped mid-clip for %s (%d done)", camera.name, downloaded)
                break
            except Exception as exc:
                errored += 1
                logger.warning(
                    "Camera %s: failed to download %s: %s",
                    camera.name,
                    v.get("playback_uri", "<no uri>"),
                    exc,
                )

    return downloaded, indexed, errored


def download_camera(camera: Camera) -> tuple[int, int, int]:
    """Synchronous wrapper — drives the async client on a fresh event loop.

    Safe because this runs in a worker thread (scheduler job or ``run_in_threadpool``
    background task), so there is no already-running event loop to conflict with.
    Returns ``(downloaded, indexed, errored)``.
    """
    return asyncio.run(_download_all(camera))


def download_single_camera(camera_id: int, force: bool = False) -> dict[str, int]:
    """Download + index one Hikvision camera, recording a DownloadEvent.

    Returns ``{camera_name: downloaded}`` or ``{}`` when skipped (already
    downloading, camera missing, not Hikvision, or disabled without ``force``).
    ``force=True`` (manual) runs even when the camera is disabled.
    """
    from app.models.download_event import DownloadEvent

    camera = Camera.get_or_none(Camera.id == camera_id)
    if not camera:
        return {}
    if camera.camera_type != "hikvision":
        logger.info("download_single_camera: camera %s is not Hikvision, skipping", camera_id)
        return {}
    if not camera.enabled and not force:
        return {}

    try:
        lock_ctx = _acquire_download_lock(camera_id)
        lock_ctx.__enter__()
    except RuntimeError:
        logger.info("download_single_camera: camera %s already downloading, skipping", camera_id)
        return {}

    # Everything past lock acquisition is wrapped so the lock is always released —
    # even if DownloadEvent.create()/save() itself raises.
    try:
        event = DownloadEvent.create(
            camera=camera,
            started_at=utcnow(),
        )
        try:
            # download_camera indexes each clip inline as it lands.
            downloaded, indexed, errored = download_camera(camera)
            camera.last_downloaded_at = utcnow()
            camera.save()

            event.downloaded = downloaded
            event.indexed = indexed
            event.finished_at = utcnow()
            event.status = "ok"
            parts = [camera.name, f"{downloaded} downloaded"]
            if errored:
                parts.append(f"{errored} failed")
            if indexed:
                parts.append(f"+{indexed} indexed")
            event.detail = " · ".join(parts)
            logger.info(
                "download_single_camera %s: %d downloaded, %d indexed, %d failed",
                camera.name,
                downloaded,
                indexed,
                errored,
            )
            return {camera.name: downloaded}
        except Exception as exc:
            event.status = "error"
            event.detail = str(exc)
            event.finished_at = utcnow()
            logger.exception("download_single_camera failed for %s: %s", camera.name, exc)
            return {}
        finally:
            event.save()
    finally:
        lock_ctx.__exit__(None, None, None)


def has_downloadable_camera() -> bool:
    """True if at least one enabled Hikvision camera exists (so a bulk download
    would have something to do)."""
    return (
        Camera.select()
        .where((Camera.enabled == True) & (Camera.camera_type == "hikvision"))  # noqa: E712
        .exists()
    )


def download_all() -> dict[str, int]:
    """Download + index every enabled Hikvision camera. Cameras already downloading
    are skipped (their per-camera lock is held). Returns ``{camera_name: downloaded}``."""
    # Materialize before the loop: download_single_camera writes back to the Camera
    # table (last_downloaded_at), so iterating a live cursor risks a table lock.
    cameras = list(
        Camera.select().where(
            (Camera.enabled == True) & (Camera.camera_type == "hikvision")  # noqa: E712
        )
    )
    results: dict[str, int] = {}
    for cam in cameras:
        results.update(download_single_camera(cam.id))
    return results
