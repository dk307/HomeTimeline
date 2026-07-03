import re
import subprocess
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from app.models.recording import Recording
from app.schemas.recording import RecordingOut, RecordingUpdate
from app.services.tz import to_app_tz

router = APIRouter(prefix="/recordings", tags=["recordings"])

MIME_MAP = {
    ".mp4": "video/mp4",
    ".mkv": "video/mp4",  # remuxed to fMP4
    ".avi": "video/mp4",
    ".mov": "video/mp4",
    ".ts": "video/mp4",
    ".m4v": "video/mp4",
}


def _to_out(r: Recording) -> RecordingOut:
    return RecordingOut(
        id=r.id,
        camera_id=r.camera_id,
        file_path=r.file_path,
        start_time=to_app_tz(r.start_time),
        end_time=to_app_tz(r.end_time),
        duration_secs=r.duration_secs,
        file_size_bytes=r.file_size_bytes,
        thumbnail_path=r.thumbnail_path,
        notes=r.notes,
        status=r.status,
        created_at=to_app_tz(r.created_at),
    )


def _fmp4_stream(path: Path):
    """
    Remux via ffmpeg to fragmented MP4 — copy codecs, no re-encoding.
    frag_keyframe+empty_moov makes the moov atom-free stream that works
    in all browsers (Firefox, Chrome, Safari) without needing the full
    file downloaded first. This is the same approach used by Frigate/HA.
    """
    proc = subprocess.Popen(
        [
            "ffmpeg",
            "-i",
            str(path),
            "-c",
            "copy",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "-f",
            "mp4",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        while chunk := proc.stdout.read(65536):
            yield chunk
    finally:
        proc.kill()
        proc.wait()


def _raw_stream(path: Path, request: Request):
    """Byte-range streaming for download (no remux needed)."""
    file_size = path.stat().st_size
    media_type = MIME_MAP.get(path.suffix.lower(), "video/mp4")
    range_header = request.headers.get("Range")

    if range_header:
        m = re.match(r"bytes=(\d*)-(\d*)", range_header)
        if m:
            start = int(m.group(1)) if m.group(1) else 0
            end = int(m.group(2)) if m.group(2) else file_size - 1
            end = min(end, file_size - 1)
            length = end - start + 1

            def _iter():
                with path.open("rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        yield chunk

            return StreamingResponse(
                _iter(),
                status_code=206,
                media_type=media_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Accept-Ranges": "bytes",
                    "Content-Length": str(length),
                },
            )

    def _iter_full():
        with path.open("rb") as f:
            while chunk := f.read(65536):
                yield chunk

    return StreamingResponse(
        _iter_full(),
        media_type=media_type,
        headers={"Accept-Ranges": "bytes", "Content-Length": str(file_size)},
    )


@router.get("", response_model=list[RecordingOut])
def list_recordings(
    camera_id: int | None = None,
    date: str | None = Query(None, description="YYYY-MM-DD"),
    days: int = Query(1, ge=1, le=90, description="Number of days from date"),
    status: str | None = None,
    limit: int = Query(200, le=1000),
    offset: int = 0,
):
    from datetime import timedelta

    q = Recording.select()
    if camera_id:
        q = q.where(Recording.camera_id == camera_id)
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, "Invalid date format — use YYYY-MM-DD")
        q = q.where(
            (Recording.start_time >= day) & (Recording.start_time < day + timedelta(days=days))
        )
    if status:
        q = q.where(Recording.status == status)
    q = q.order_by(Recording.start_time.desc()).offset(offset).limit(limit)
    return [_to_out(r) for r in q]


@router.get("/{rec_id}", response_model=RecordingOut)
def get_recording(rec_id: int):
    r = Recording.get_or_none(Recording.id == rec_id)
    if not r:
        raise HTTPException(404, "Recording not found")
    return _to_out(r)


@router.patch("/{rec_id}", response_model=RecordingOut)
def update_recording(rec_id: int, body: RecordingUpdate):
    r = Recording.get_or_none(Recording.id == rec_id)
    if not r:
        raise HTTPException(404, "Recording not found")
    if body.notes is not None:
        r.notes = body.notes
    r.updated_at = datetime.now()
    r.save()
    return _to_out(r)


@router.get("/{rec_id}/stream")
def stream_recording(rec_id: int):
    """Stream via ffmpeg fragmented MP4 — works in Firefox/Chrome/Safari."""
    r = Recording.get_or_none(Recording.id == rec_id)
    if not r:
        raise HTTPException(404, "Recording not found")
    p = Path(r.file_path)
    if not p.exists():
        raise HTTPException(404, "File not found on disk")
    return StreamingResponse(
        _fmp4_stream(p),
        media_type="video/mp4",
        headers={"Cache-Control": "no-cache"},
    )


@router.get("/{rec_id}/download")
def download_recording(rec_id: int, request: Request):
    """Download original file with byte-range support."""
    r = Recording.get_or_none(Recording.id == rec_id)
    if not r:
        raise HTTPException(404, "Recording not found")
    p = Path(r.file_path)
    if not p.exists():
        raise HTTPException(404, "File not found on disk")
    resp = _raw_stream(p, request)
    resp.headers["Content-Disposition"] = f'attachment; filename="{p.name}"'
    return resp


@router.delete("/{rec_id}", status_code=204)
def delete_recording(rec_id: int):
    r = Recording.get_or_none(Recording.id == rec_id)
    if not r:
        raise HTTPException(404, "Recording not found")
    r.delete_instance()
