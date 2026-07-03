from fastapi import APIRouter
from peewee import fn

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


@router.get("/health/recordings")
def health_recordings():
    """DB-level integrity counts: corrupted, duplicate file paths, orphaned."""
    try:
        from app.models.recording import Recording

        total = Recording.select().count()
        corrupted = Recording.select().where(Recording.status == "error").count()

        dup_subq = (
            Recording.select(Recording.file_path)
            .group_by(Recording.file_path)
            .having(fn.COUNT(Recording.id) > 1)
        )
        duplicate_paths = dup_subq.count()

        orphaned = db.execute_sql(
            "SELECT COUNT(*) FROM recordings"
            " WHERE camera_id NOT IN (SELECT id FROM cameras)"
        ).fetchone()[0]

        return {
            "status": "ok",
            "total": total,
            "corrupted": corrupted,
            "duplicate_paths": duplicate_paths,
            "orphaned": orphaned,
        }
    except Exception as exc:
        return {
            "status": "degraded",
            "error": str(exc),
            "total": None,
            "corrupted": None,
            "duplicate_paths": None,
            "orphaned": None,
        }
