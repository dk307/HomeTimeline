from datetime import datetime, timezone

from fastapi import APIRouter, Query

from app.services.log_buffer import get_entries
from app.services.tz import fmt_dt

router = APIRouter(prefix="/logs", tags=["logs"])

_UTC = timezone.utc


@router.get("")
def list_logs(
    level: str | None = Query(None, description="Filter by level: DEBUG INFO WARNING ERROR"),
    limit: int = Query(200, le=500),
):
    entries = get_entries(level=level, limit=limit)
    result = []
    for e in entries:
        try:
            dt = datetime.fromisoformat(e["ts"])
            ts = fmt_dt(dt)
        except Exception:
            ts = e["ts"]
        result.append({**e, "ts": ts})
    return result
