from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.models.camera import Camera
from app.models.location import Location
from app.models.recording import Recording
from app.schemas.camera import CameraCreate, CameraOut, CameraUpdate

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
        time_source=cam.time_source,
        created_at=cam.created_at,
        updated_at=cam.updated_at,
    )


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
    return _to_out(cam)


@router.get("/{cam_id}", response_model=CameraOut)
def get_camera(cam_id: int):
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    return _to_out(cam)


@router.patch("/{cam_id}", response_model=CameraOut)
def update_camera(cam_id: int, body: CameraUpdate):
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    update_data = body.model_dump(exclude_none=True)
    if "location_id" in update_data and update_data["location_id"] is not None:
        if not Location.get_or_none(Location.id == update_data["location_id"]):
            raise HTTPException(404, "Location not found")
    for field, value in update_data.items():
        setattr(cam, field, value)
    cam.updated_at = datetime.now()
    cam.save()
    return _to_out(cam)


@router.delete("/{cam_id}", status_code=204)
def delete_camera(cam_id: int):
    cam = Camera.get_or_none(Camera.id == cam_id)
    if not cam:
        raise HTTPException(404, "Camera not found")
    cam.delete_instance()


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

    if is_scanning():
        raise HTTPException(409, "A scan is already running — try again shortly")

    def _run():

        from app.models.scan_event import ScanEvent
        from app.services.scanner import scan_camera_locked

        deleted = Recording.delete().where(Recording.camera_id == cam_id).execute()
        event = ScanEvent.create(
            started_at=datetime.now(tz=timezone.utc),
            cameras_scanned=1,
        )
        try:
            added, skipped = scan_camera_locked(cam)
            event.new_recordings = added
            event.skipped_recordings = skipped
            event.finished_at = datetime.now(tz=timezone.utc)
            event.status = "ok"
            event.detail = (
                f"Reindex {cam.name}: dropped {deleted}, added {added}, skipped {skipped}"
            )
        except RuntimeError as exc:
            # Lock taken by scheduler between our is_scanning() check and task start
            event.status = "error"
            event.detail = str(exc)
            event.finished_at = datetime.now(tz=timezone.utc)
        except Exception as exc:
            event.status = "error"
            event.detail = str(exc)
            event.finished_at = datetime.now(tz=timezone.utc)
        finally:
            event.save()

    background_tasks.add_task(_run)
    return {"status": "started", "camera": cam.name}
