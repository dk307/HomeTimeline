import logging
import time
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import (
    activity,
    app_settings,
    cameras,
    health,
    locations,
    logs,
    recordings,
    scanner,
    storage,
    timeline,
)
from app.config import settings
from app.database import close_db, init_db
from app.services import go2rtc, log_buffer
from app.workers.scheduler import start_scheduler, stop_scheduler

# Console logging always; file logging is best-effort so a non-writable log path
# (e.g. an unmounted volume or a test sandbox) degrades gracefully instead of
# crashing at import time.
_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"
_handlers: list[logging.Handler] = [logging.StreamHandler()]
_file_log_error: str | None = None
try:
    Path(settings.log_file).parent.mkdir(parents=True, exist_ok=True)
    # Rotating so the persisted log on the data volume doesn't grow unbounded.
    _file_handler = RotatingFileHandler(
        settings.log_file, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    # Persist timestamps in UTC so the buffer can be re-seeded unambiguously from
    # this file after a restart (see log_buffer.seed_from_file). Pre-setting the
    # formatter also means basicConfig leaves this handler's format alone.
    _utc_formatter = logging.Formatter(_LOG_FORMAT)
    _utc_formatter.converter = time.gmtime
    _file_handler.setFormatter(_utc_formatter)
    _handlers.append(_file_handler)
except OSError as exc:
    _file_log_error = f"File logging disabled ({settings.log_file}): {exc}"

logging.basicConfig(
    level=settings.log_level.upper(),
    format=_LOG_FORMAT,
    handlers=_handlers,
)
if _file_log_error:
    logging.getLogger(__name__).warning(_file_log_error)
# Restore recent history from the persisted log before installing the live handler
# so a restart doesn't present an empty Logs page.
if not _file_log_error:
    log_buffer.seed_from_file(settings.log_file)
log_buffer.install(level=logging.DEBUG)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Camera Event Manager")
    init_db()
    go2rtc.start()
    start_scheduler()
    try:
        yield
    finally:
        # Always run teardown, even if shutdown work raises partway through.
        stop_scheduler()
        go2rtc.stop()
        close_db()
        logger.info("Camera Event Manager shut down")


app = FastAPI(title="Camera Event Manager", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_PREFIX = "/api/v1"
app.include_router(health.router, prefix=API_PREFIX)
app.include_router(locations.router, prefix=API_PREFIX)
app.include_router(cameras.router, prefix=API_PREFIX)
app.include_router(recordings.router, prefix=API_PREFIX)
app.include_router(timeline.router, prefix=API_PREFIX)
app.include_router(scanner.router, prefix=API_PREFIX)
app.include_router(storage.router, prefix=API_PREFIX)
app.include_router(logs.router, prefix=API_PREFIX)
app.include_router(activity.router, prefix=API_PREFIX)
app.include_router(app_settings.router, prefix=API_PREFIX)

# Thumbnails — served before SPA catch-all
thumb_dir = Path(settings.thumbnail_dir)
if thumb_dir.exists():
    app.mount("/thumbnails", StaticFiles(directory=str(thumb_dir)), name="thumbnails")

# SPA frontend — registered last so API routes take priority
frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    assets_dir = frontend_dist / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str) -> FileResponse:
        candidate = frontend_dist / full_path
        if candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(frontend_dist / "index.html"))

    logger.info("Serving frontend from %s", frontend_dist)
else:
    logger.warning("Frontend dist not found at %s - API only mode", frontend_dist)
