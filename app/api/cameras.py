import logging
import re
from datetime import UTC, datetime

import aiohttp
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, WebSocket, WebSocketDisconnect
from peewee import fn

from app.config import settings

logger = logging.getLogger(__name__)
from app.models.base import utcnow
from app.models.camera import Camera
from app.models.location import Location
from app.models.recording import Recording
from app.schemas.camera import CameraCreate, CameraOut, CameraUpdate
from app.services.tz import fmt_dt, to_app_tz

router = APIRouter(prefix="/cameras", tags=["cameras"])


def _to_out(cam: Camera) -> CameraOut:
    return CameraOut(
        id=cam.id,
        name=cam.name,
        description=cam.description,
        camera_type=cam.camera_type,
        location_id=cam.location_id,
        recording_path=cam.recording_path,
        enabled=cam.enabled,
        display_order=cam.display_order,
        clip_strategy=cam.clip_strategy,
        scan_interval_minutes=cam.scan_interval_minutes,
        host=cam.host,
        username=cam.username,
        download_interval_minutes=cam.download_interval_minutes,
        purge_older_than_days=cam.purge_older_than_days,
        purge_interval_minutes=cam.purge_interval_minutes,
        stream_url_1=cam.stream_url_1,
        stream_url_2=cam.stream_url_2,
        stream_url_3=cam.stream_url_3,
        aqura_username=cam.aqura_username,
        has_password=cam.password is not None,
        aqura_has_password=cam.aqura_password is not None,
        # Convert to the app timezone for consistency with stats/download-status.
        last_downloaded_at=to_app_tz(cam.last_downloaded_at),
        last_purged_at=to_app_tz(cam.last_purged_at),
        created_at=to_app_tz(cam.created_at),
        updated_at=to_app_tz(cam.updated_at),
    )


def _sync_camera_schedule(cam: Camera) -> None:
    """Register/refresh this camera's automatic scan + download jobs. Disabled
    cameras and those set to Never (null interval) get no job; downloads only apply
    to Hikvision cameras."""
    from app.workers.scheduler import (
        reschedule_camera,
        reschedule_camera_download,
        reschedule_camera_purge,
    )

    reschedule_camera(cam.id, cam.scan_interval_minutes if cam.enabled else None)
    is_hikvision = cam.enabled and cam.camera_type == "hikvision"
    download_minutes = cam.download_interval_minutes if is_hikvision else None
    reschedule_camera_download(cam.id, download_minutes)
    purge_minutes = cam.purge_interval_minutes if is_hikvision else None
    reschedule_camera_purge(cam.id, purge_minutes)


@router.get("", response_model=list[CameraOut])
def list_cameras(enabled: bool | None = None):
    q = Camera.select()
    if enabled is not None:
        q = q.where(Camera.enabled == enabled)
    return [_to_out(c) for c in q.order_by(Camera.display_order, Camera.name)]


@router.post("", response_model=CameraOut, status_code=201)
def create_camera(body: CameraCreate):
    if body.location_id:
        if not Location.get_or_none(Location.id == body.location_id):
            raise HTTPException(404, "Location not found")
    cam = Camera.create(**body.model_dump())
    _sync_camera_schedule(cam)
    return _to_out(cam)


# Bulk (all-camera) Hikvision operations. Declared before the "/{cam_id}" routes
# so the literal "download-all" / "purge-all" paths are matched, not parsed as an id.
@router.post("/download-all", status_code=202)
def download_all_endpoint(background_tasks: BackgroundTasks):
    """Download new clips for every enabled Hikvision camera (background)."""
    from app.services.downloader import download_all, has_downloadable_camera

    if not has_downloadable_camera():
        raise HTTPException(400, "No enabled Hikvision cameras to download from")
    background_tasks.add_task(download_all)
    return {"status": "started"}


@router.get("/download-all/status")
def download_all_status():
    """Global download state for the Dashboard: whether any camera is downloading
    and whether the bulk action is available (an enabled Hikvision camera exists)."""
    from app.services.downloader import has_downloadable_camera, is_downloading

    return {"running": is_downloading(), "available": has_downloadable_camera()}


@router.post("/purge-all", status_code=202)
def purge_all_endpoint(background_tasks: BackgroundTasks):
    """Purge old clips for every enabled Hikvision camera with a retention window."""
    from app.services.purger import has_purgeable_camera, purge_all

    if not has_purgeable_camera():
        raise HTTPException(400, "No Hikvision cameras with a purge retention configured")
    background_tasks.add_task(purge_all)
    return {"status": "started"}


@router.get("/purge-all/status")
def purge_all_status():
    """Global purge state for the Dashboard: whether any camera is purging and
    whether the bulk action is available (a retention window is configured)."""
    from app.services.purger import has_purgeable_camera, is_purging

    return {"running": is_purging(), "available": has_purgeable_camera()}


@router.get("/{cam_id}", response_model=CameraOut)
def get_camera(cam_id: int):
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    return _to_out(cam)


@router.get("/{cam_id}/stats")
def get_camera_stats(cam_id: int):
    """Summary stats for a single camera: totals, clip length, size, last video."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")

    total = Recording.select().where(Recording.camera_id == cam_id).count()
    agg = (
        Recording.select(
            fn.SUM(Recording.file_size_bytes).alias("size"),
            fn.SUM(Recording.duration_secs).alias("duration"),
        )
        .where((Recording.camera_id == cam_id) & (Recording.status == "ready"))
        .dicts()
        .get()
    )
    last_rec = (
        Recording.select()
        .where(Recording.camera_id == cam_id)
        # Order by the effective timestamp so active clips (null end_time) are not
        # sorted last and missed — mirrors the last_video_at expression below.
        .order_by(
            fn.COALESCE(Recording.end_time, Recording.start_time).desc(),
            Recording.start_time.desc(),
        )
        .first()
    )
    last_video_at = fmt_dt((last_rec.end_time or last_rec.start_time) if last_rec else None)

    return {
        "id": cam.id,
        "name": cam.name,
        "enabled": cam.enabled,
        "total_recordings": total,
        "total_duration_secs": agg["duration"] or 0,
        "indexed_size_bytes": agg["size"] or 0,
        "last_video_at": last_video_at,
        "last_downloaded_at": fmt_dt(cam.last_downloaded_at),
    }


@router.patch("/{cam_id}", response_model=CameraOut)
def update_camera(cam_id: int, body: CameraUpdate):
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    update_data = body.model_dump(exclude_none=True)
    # None is meaningful (Never) for the interval fields, so they can't ride the
    # exclude_none path — applied explicitly below when the client sent them.
    update_data.pop("scan_interval_minutes", None)
    update_data.pop("download_interval_minutes", None)
    update_data.pop("purge_older_than_days", None)
    update_data.pop("purge_interval_minutes", None)
    update_data.pop("stream_url_1", None)
    update_data.pop("stream_url_2", None)
    update_data.pop("stream_url_3", None)
    update_data.pop("aqura_username", None)
    # password: only overwrite when a non-empty value is supplied (blank = keep).
    password = update_data.pop("password", None)
    aqura_password = update_data.pop("aqura_password", None)
    if "location_id" in update_data and update_data["location_id"] is not None:
        if not Location.get_or_none(Location.id == update_data["location_id"]):
            raise HTTPException(404, "Location not found")
    for field, value in update_data.items():
        setattr(cam, field, value)
    if "scan_interval_minutes" in body.model_fields_set:
        cam.scan_interval_minutes = body.scan_interval_minutes
    if "download_interval_minutes" in body.model_fields_set:
        cam.download_interval_minutes = body.download_interval_minutes
    if "purge_older_than_days" in body.model_fields_set:
        cam.purge_older_than_days = body.purge_older_than_days
    if "purge_interval_minutes" in body.model_fields_set:
        cam.purge_interval_minutes = body.purge_interval_minutes
    if "stream_url_1" in body.model_fields_set:
        cam.stream_url_1 = body.stream_url_1
    if "stream_url_2" in body.model_fields_set:
        cam.stream_url_2 = body.stream_url_2
    if "stream_url_3" in body.model_fields_set:
        cam.stream_url_3 = body.stream_url_3
    if "aqura_username" in body.model_fields_set:
        cam.aqura_username = body.aqura_username
    if password:
        cam.password = password
    if aqura_password:
        cam.aqura_password = aqura_password
    cam.updated_at = utcnow()
    cam.save()
    _sync_camera_schedule(cam)
    return _to_out(cam)


@router.delete("/{cam_id}", status_code=204)
def delete_camera(cam_id: int):
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    cam.delete_instance()
    from app.workers.scheduler import (
        reschedule_camera,
        reschedule_camera_download,
        reschedule_camera_purge,
    )

    reschedule_camera(cam_id, None)
    reschedule_camera_download(cam_id, None)
    reschedule_camera_purge(cam_id, None)


@router.post("/{cam_id}/scan", status_code=202)
def scan_camera_endpoint(cam_id: int, background_tasks: BackgroundTasks):
    """Scan this camera's recording path for new files (non-destructive).

    Runs even if the camera's schedule is Never or it is disabled — a manual scan
    always overrides the schedule.
    """
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")

    from app.services.scanner import is_scanning

    if is_scanning(cam_id):
        raise HTTPException(409, "A scan is already running for this camera — try again shortly")

    from app.services.scanner import scan_single_camera

    background_tasks.add_task(scan_single_camera, cam_id, True)
    return {"status": "started", "camera": cam.name}


@router.get("/{cam_id}/scan-status")
def scan_status(cam_id: int):
    """Whether a scan is currently running for this camera."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    from app.services.scanner import is_scanning

    return {"running": is_scanning(cam_id)}


@router.post("/{cam_id}/scan/stop")
def stop_scan(cam_id: int):
    """Request the in-progress scan for this camera to stop (cooperative)."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    from app.services.scanner import request_scan_stop

    return {"status": "stopping" if request_scan_stop(cam_id) else "not_running"}


@router.post("/{cam_id}/download", status_code=202)
def download_camera_endpoint(cam_id: int, background_tasks: BackgroundTasks):
    """Download this Hikvision camera's clips (and index them) in the background.

    Runs even if the camera's schedule is Never or it is disabled — a manual
    download always overrides the schedule.
    """
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    if cam.camera_type != "hikvision":
        raise HTTPException(400, "Downloading is only supported for Hikvision cameras")

    from app.services.downloader import is_downloading

    if is_downloading(cam_id):
        raise HTTPException(
            409, "A download is already running for this camera — try again shortly"
        )

    from app.services.downloader import download_single_camera

    background_tasks.add_task(download_single_camera, cam_id, True)
    return {"status": "started", "camera": cam.name}


@router.get("/{cam_id}/download-status")
def download_status(cam_id: int):
    """Whether a download is currently running for this camera, plus its last run."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    from app.services.downloader import is_downloading

    return {
        "running": is_downloading(cam_id),
        "last_downloaded_at": fmt_dt(cam.last_downloaded_at),
    }


@router.post("/{cam_id}/download/stop")
def stop_download(cam_id: int):
    """Request the in-progress download for this camera to stop (cooperative)."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    from app.services.downloader import request_download_stop

    return {"status": "stopping" if request_download_stop(cam_id) else "not_running"}


@router.post("/{cam_id}/purge", status_code=202)
def purge_camera_endpoint(cam_id: int, background_tasks: BackgroundTasks):
    """Delete this Hikvision camera's old clips (file + index + thumbnail) in the
    background, based on its ``purge_older_than_days`` retention window.

    Runs even if the camera's schedule is Never or it is disabled — a manual purge
    always overrides the schedule. A camera with retention set to Never deletes
    nothing.
    """
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    if cam.camera_type != "hikvision":
        raise HTTPException(400, "Purging is only supported for Hikvision cameras")
    if not cam.purge_older_than_days:
        raise HTTPException(400, "Set a retention age (purge older than N days) before purging")

    from app.services.purger import is_purging

    if is_purging(cam_id):
        raise HTTPException(409, "A purge is already running for this camera — try again shortly")

    from app.services.purger import purge_single_camera

    background_tasks.add_task(purge_single_camera, cam_id, True)
    return {"status": "started", "camera": cam.name}


@router.get("/{cam_id}/purge-status")
def purge_status(cam_id: int):
    """Whether a purge is currently running for this camera, plus its last run."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    from app.services.purger import is_purging

    return {
        "running": is_purging(cam_id),
        "last_purged_at": fmt_dt(cam.last_purged_at),
    }


@router.post("/{cam_id}/purge/stop")
def stop_purge(cam_id: int):
    """Request the in-progress purge for this camera to stop (cooperative)."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    from app.services.purger import request_purge_stop

    return {"status": "stopping" if request_purge_stop(cam_id) else "not_running"}


@router.get("/{cam_id}/download-events")
def list_download_events(cam_id: int, limit: int = Query(50, ge=1, le=200)):
    """Recent download-run history for this camera (most recent first)."""
    from app.models.download_event import DownloadEvent

    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    events = (
        DownloadEvent.select()
        .where(DownloadEvent.camera == cam_id)
        .order_by(DownloadEvent.started_at.desc())
        .limit(limit)
    )
    return [
        {
            "id": e.id,
            "started_at": fmt_dt(e.started_at),
            "finished_at": fmt_dt(e.finished_at),
            "downloaded": e.downloaded,
            "indexed": e.indexed,
            "status": e.status,
            "detail": e.detail,
        }
        for e in events
    ]


@router.get("/{cam_id}/device-info")
async def device_info(cam_id: int):
    """Live-query a Hikvision camera for device details + stream URLs.

    Returns ``{available: false, error}`` (not a 500) when the camera can't be
    reached, so the UI can render a graceful "unavailable" state.
    """
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    if cam.camera_type != "hikvision":
        raise HTTPException(400, "Device info is only available for Hikvision cameras")
    if not cam.host:
        return {"available": False, "error": "No host configured for this camera"}

    from app.services.hikvision import HikvisionClient, device_stream_urls

    try:
        async with HikvisionClient(
            cam.host, cam.username or "", cam.password or "", timeout=15
        ) as hk:
            info = await hk.get_device_info()
        return {"available": True, "info": info, **device_stream_urls(cam.host)}
    except Exception as exc:
        return {"available": False, "error": str(exc), **device_stream_urls(cam.host)}


# Valid go2rtc stream names we register: "cam<id>_main" / "cam<id>_sub" /
# "cam<id>_1" / "cam<id>_2" / "cam<id>_3".
_STREAM_NAME_RE = re.compile(r"^cam\d+_(main|sub|1|2|3)$")


@router.get("/{cam_id}/streams")
def camera_streams(cam_id: int):
    """List live-view streams for a Hikvision or Aqura camera (registering them
    with go2rtc).

    Returns ``{available: false, ...}`` (not an error) when live streaming isn't
    possible — unsupported camera type, no host/URLs, or go2rtc not running — so
    the UI can show a graceful message instead of a broken player.
    """
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    if cam.camera_type == "hikvision" and not (cam.host or "").strip():
        logger.info("Live view skipped for camera %d (%s): no host configured", cam_id, cam.name)
        return {"available": False, "reason": "No host configured for this camera"}
    if cam.camera_type == "aqura" and not any(
        getattr(cam, f"stream_url_{q}", None) for q in ("1", "2", "3")
    ):
        logger.info(
            "Live view skipped for camera %d (%s): no stream URLs configured", cam_id, cam.name
        )
        return {"available": False, "reason": "No stream URLs configured for this camera"}

    from app.services import go2rtc

    if not go2rtc.is_available():
        return {"available": False, "reason": "Live streaming service is not running"}

    names = go2rtc.ensure_camera_streams(cam)
    if not names:
        return {"available": False, "reason": "Could not register camera streams"}

    if cam.camera_type == "aqura":
        labels = {"1": "Channel1", "2": "Channel2", "3": "Channel3"}
        streams = [
            {"quality": q, "name": names[q], "label": labels[q]}
            for q in ("1", "2", "3")
            if q in names
        ]
    else:
        labels = {"main": "Main (HD)", "sub": "Sub (SD)"}
        streams = [
            {"quality": q, "name": names[q], "label": labels[q]}
            for q in ("main", "sub")
            if q in names
        ]

    # Surface any go2rtc warnings (e.g. auth failures) for these streams.
    warnings: list[str] = []
    for s in streams:
        for warn in go2rtc.stream_warnings(s["name"]):
            msg = warn.get("error") or warn.get("message", "")
            logger.warning("go2rtc warning for %s: %s", s["name"], msg)
            if msg and msg not in warnings:
                warnings.append(msg)

    # Proactive check: Hikvision cameras need a username for RTSP auth.
    if (
        cam.camera_type == "hikvision"
        and not (cam.username or "").strip()
        and (cam.password or "").strip()
    ):
        msg = "Username is empty — RTSP authentication will fail. Set a username for this camera."
        logger.warning("Camera %d (%s): %s", cam_id, cam.name, msg)
        if msg not in warnings:
            warnings.append(msg)

    result: dict = {"available": True, "streams": streams}
    if warnings:
        result["warnings"] = warnings
    return result


@router.websocket("/live/ws")
async def live_ws(ws: WebSocket, src: str):
    """Proxy the go2rtc streaming WebSocket so the browser only talks to our origin.

    Relays both text (WebRTC/MSE signaling) and binary (MSE media) frames in both
    directions. ``src`` is restricted to stream names we manage.
    """
    if not _STREAM_NAME_RE.match(src):
        await ws.close(code=1008)
        return

    from app.services import go2rtc

    if not go2rtc.is_available():
        await ws.close(code=1013)  # try again later
        return

    await ws.accept()
    upstream_url = f"{settings.go2rtc_api.rstrip('/')}/api/ws?src={src}"
    session = aiohttp.ClientSession()
    try:
        async with session.ws_connect(upstream_url) as upstream:

            async def client_to_upstream():
                try:
                    while True:
                        msg = await ws.receive()
                        if msg["type"] == "websocket.disconnect":
                            break
                        if (t := msg.get("text")) is not None:
                            await upstream.send_str(t)
                        elif (b := msg.get("bytes")) is not None:
                            await upstream.send_bytes(b)
                except WebSocketDisconnect:
                    pass

            async def upstream_to_client():
                async for msg in upstream:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        await ws.send_text(msg.data)
                    elif msg.type == aiohttp.WSMsgType.BINARY:
                        await ws.send_bytes(msg.data)
                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.ERROR):
                        break

            import asyncio

            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_upstream()),
                    asyncio.create_task(upstream_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            # Await both groups so cancellation finishes and no task exception is
            # left unretrieved (return_exceptions swallows the expected CancelledError).
            await asyncio.gather(*done, *pending, return_exceptions=True)
    except (aiohttp.ClientError, OSError) as exc:
        logger.warning("WebSocket proxy error for %s: %s", src, exc)
    finally:
        await session.close()
        try:
            await ws.close()
        except RuntimeError:
            pass


@router.delete("/{cam_id}/recordings", status_code=200)
def drop_camera_index(cam_id: int):
    """Delete all indexed recordings for a camera (keeps camera config)."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    count = Recording.delete().where(Recording.camera_id == cam_id).execute()
    return {"deleted": count}


@router.post("/{cam_id}/reindex", status_code=202)
def reindex_camera(cam_id: int, background_tasks: BackgroundTasks):
    """Drop all recordings for a camera and re-scan in the background."""
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    from app.services.scanner import is_scanning

    if is_scanning(cam_id):
        raise HTTPException(409, "A scan is already running for this camera — try again shortly")

    def _run():

        from app.models.scan_event import ScanEvent
        from app.services.scanner import scan_camera_locked

        deleted = Recording.delete().where(Recording.camera_id == cam_id).execute()
        event = ScanEvent.create(
            started_at=datetime.now(tz=UTC),
            cameras_scanned=1,
        )
        try:
            added, skipped = scan_camera_locked(cam)
            event.new_recordings = added
            event.skipped_recordings = skipped
            event.finished_at = datetime.now(tz=UTC)
            event.status = "ok"
            event.detail = (
                f"Reindex {cam.name}: dropped {deleted}, added {added}, skipped {skipped}"
            )
        except RuntimeError as exc:
            # Lock taken by scheduler between our is_scanning() check and task start
            logger.warning("Reindex lock contention for %s: %s", cam.name, exc)
            event.status = "error"
            event.detail = str(exc)
            event.finished_at = datetime.now(tz=UTC)
        except Exception as exc:
            logger.exception("Reindex failed for %s: %s", cam.name, exc)
            event.status = "error"
            event.detail = str(exc)
            event.finished_at = datetime.now(tz=UTC)
        finally:
            event.save()

    background_tasks.add_task(_run)
    return {"status": "started", "camera": cam.name}
