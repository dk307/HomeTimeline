"""Manual scan trigger + status endpoint."""

import threading

from fastapi import APIRouter

router = APIRouter(prefix="/scanner", tags=["scanner"])

_last_run: dict = {"last_run": None, "last_result": None}
_meta_lock = threading.Lock()


@router.post("/scan", status_code=202)
def trigger_scan():
    from app.services.scanner import is_scanning, scan_all

    if is_scanning():
        return {"status": "already_running"}

    def _run():
        result = scan_all()

        from app.models.base import utcnow

        with _meta_lock:
            # Store the raw UTC-naive instant; it's formatted in the current app
            # timezone at read time so a later timezone change is reflected.
            _last_run["last_run"] = utcnow()
            _last_run["last_result"] = result

    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}


@router.get("/status")
def scan_status():
    from app.services.scanner import is_scanning
    from app.services.tz import fmt_dt

    with _meta_lock:
        return {
            "running": is_scanning(),
            "last_run": fmt_dt(_last_run["last_run"]),
            "last_result": _last_run["last_result"],
        }
