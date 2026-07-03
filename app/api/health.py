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
    from app.models.recording import Recording

    total = Recording.select().count()
    corrupted = Recording.select().where(Recording.status == "error").count()

    # Duplicate file paths (same file indexed twice) — guarded by UNIQUE
    # constraint in practice, but reported here for completeness
    dup_subq = (
        Recording.select(Recording.file_path)
        .group_by(Recording.file_path)
        .having(fn.COUNT(Recording.id) > 1)
    )
    duplicate_paths = dup_subq.count()

    # Orphaned: recordings whose camera_id has no matching camera row
    orphaned = db.execute_sql(
        "SELECT COUNT(*) FROM recordings WHERE camera_id NOT IN (SELECT id FROM cameras)"
    ).fetchone()[0]

    return {
        "total": total,
        "corrupted": corrupted,
        "duplicate_paths": duplicate_paths,
        "orphaned": orphaned,
    }
