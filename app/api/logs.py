from datetime import UTC, datetime

from fastapi import APIRouter, Query
from fastapi.responses import PlainTextResponse

from app.services.log_buffer import get_entries
from app.services.tz import fmt_dt

router = APIRouter(prefix="/logs", tags=["logs"])

_UTC = UTC


def _format_ts(raw_ts: str) -> str:
    try:
        dt = datetime.fromisoformat(raw_ts)
        return fmt_dt(dt)
    except Exception:
        return raw_ts


_SEARCH_PARAMS = [
    Query(None, description="Filter by level: DEBUG INFO WARNING ERROR"),
    Query(None, description="Filter by message text (case-insensitive)"),
]


@router.get("")
def list_logs(
    level: str | None = Query(None, description="Filter by level: DEBUG INFO WARNING ERROR"),
    search: str | None = Query(None, description="Filter by message text (case-insensitive)"),
    limit: int = Query(200, le=500),
):
    entries = get_entries(level=level, search=search, limit=limit)
    return [{**e, "ts": _format_ts(e["ts"])} for e in entries]


@router.get("/download", response_class=PlainTextResponse)
def download_logs(
    level: str | None = Query(None, description="Filter by level: DEBUG INFO WARNING ERROR"),
    search: str | None = Query(None, description="Filter by message text (case-insensitive)"),
):
    entries = get_entries(level=level, search=search, limit=500)
    lines = ["ts\tlevel\tlogger\tcamera_name\tmsg"]
    for e in entries:
        ts = _format_ts(e["ts"])
        camera = e.get("camera_name") or ""
        msg = e["msg"].replace("\n", "\\n").replace("\t", "\\t")
        lines.append(f"{ts}\t{e['level']}\t{e['logger']}\t{camera}\t{msg}")
    return "\n".join(lines) + "\n"
