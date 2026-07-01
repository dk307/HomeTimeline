from fastapi import APIRouter

from app.database import db

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    try:
        db.execute_sql("SELECT 1")
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "db": db_ok}
