from fastapi import APIRouter, Query

from app.services.log_buffer import get_entries

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("")
def list_logs(
    level: str | None = Query(None, description="Filter by level: DEBUG INFO WARNING ERROR"),
    limit: int = Query(200, le=500),
):
    return get_entries(level=level, limit=limit)
