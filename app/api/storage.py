from fastapi import APIRouter

from app.services.storage import get_storage_stats

router = APIRouter(prefix="/storage", tags=["storage"])


@router.get("/stats")
def storage_stats():
    return get_storage_stats()
