"""Manage an embedded go2rtc process for live WebRTC/MSE camera streaming.

go2rtc is a tiny static Go binary bundled into the image. We run it as a child
process (like Frigate does) rather than a separate container, so the single-
container deploy is unchanged. It listens only on localhost for its API/MSE;
the browser reaches it through a WebSocket proxy on our own port (see
``app/api/cameras.py``), and over a published TCP port for WebRTC.

Streams are registered dynamically via go2rtc's REST API using the RTSP URL
built from each Hikvision camera's stored host/credentials — so credentials
never leave the server and no static go2rtc.yaml needs the passwords.
"""

import json
import logging
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from yarl import URL

from app.config import settings

logger = logging.getLogger(__name__)

# Hikvision ISAPI channel ids: 101 = main (high-res) stream, 102 = sub (low-res).
_CHANNELS = {"main": "101", "sub": "102"}
_AQURA_QUALITIES = ["1", "2", "3"]

_proc: subprocess.Popen | None = None
_lock = threading.Lock()
_stderr_thread: threading.Thread | None = None
_active_streams: int = 0
_idle_timer: threading.Timer | None = None
# Set once the current go2rtc process's REST API is confirmed responsive. Used as
# a barrier so concurrent callers (e.g. multiple /streams requests on the Live
# wall) wait for a cold start to finish instead of racing it and getting
# "Connection refused" while the API port isn't bound yet.
_api_ready = threading.Event()

_IDLE_TIMEOUT_S: int = 60
_START_TIMEOUT_S: float = 8.0


def _binary() -> str | None:
    """Absolute path to the go2rtc binary, or None if unavailable/disabled."""
    if not settings.go2rtc_enabled:
        return None
    return shutil.which(settings.go2rtc_binary) or (
        settings.go2rtc_binary if Path(settings.go2rtc_binary).is_file() else None
    )


def is_available() -> bool:
    """True if go2rtc is enabled and its process is running."""
    with _lock:
        return _proc is not None and _proc.poll() is None


def _mark_ready(proc: subprocess.Popen) -> None:
    """Record that *proc*'s REST API is responsive (only if it's still current)."""
    with _lock:
        if _proc is proc:
            _api_ready.set()


def _clear_if_current(proc: subprocess.Popen) -> None:
    """Drop the process handle and readiness if *proc* is still the current one."""
    global _proc
    with _lock:
        if _proc is proc:
            _proc = None
        _api_ready.clear()


def _config_path() -> Path:
    return Path(settings.go2rtc_config_dir) / "go2rtc.yaml"


def _write_config() -> Path:
    """Write a minimal go2rtc config (streams are added later via the API)."""
    api_host = URL(settings.go2rtc_api).host or "127.0.0.1"
    api_port = URL(settings.go2rtc_api).port or 1984
    lines = [
        "api:",
        f'  listen: "{api_host}:{api_port}"',
        "rtsp:",
        # Bound to localhost: go2rtc's ffmpeg transcoder (used for the H.264
        # fallback of H.265 main streams) relays through this internal RTSP
        # server, so it must stay enabled — just not exposed off-box.
        '  listen: "127.0.0.1:8554"',
        "webrtc:",
        f'  listen: ":{settings.go2rtc_webrtc_port}"',
    ]
    candidate = settings.go2rtc_webrtc_candidate.strip()
    if candidate:
        # Advertise the reachable host:port so the browser can connect for WebRTC
        # (inside a container go2rtc can't auto-detect the host's LAN address).
        lines += ["  candidates:", f'    - "{candidate}"']
    lines += ["log:", f'  level: "{settings.go2rtc_log_level}"', ""]

    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _drain_stderr(proc: subprocess.Popen) -> None:
    """Read go2rtc's combined output line-by-line and pipe it to the logger."""
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.decode(errors="replace").rstrip()
        # Filter routine informational lines; surface everything else.
        if line.startswith("time=") and "INF" in line:
            logger.info("go2rtc: %s", line)
        else:
            logger.warning("go2rtc: %s", line)
    proc.stdout.close()


def _wait_for_api(proc: subprocess.Popen, timeout: float = _START_TIMEOUT_S) -> bool:
    """Poll go2rtc's REST API until it responds, the process dies, or *timeout*.

    Sets the module readiness event when the API is up so that any concurrent
    caller waiting on the same process unblocks, and clears the process handle
    if it dies.  Returns True only when the API is actually ready.
    """
    api_url = f"{settings.go2rtc_api.rstrip('/')}/api/streams"
    deadline = time.monotonic() + timeout
    attempt = 0
    while True:
        if proc.poll() is not None:
            _clear_if_current(proc)
            logger.warning("go2rtc exited (code=%s) before API was ready", proc.returncode)
            return False
        attempt += 1
        try:
            urllib.request.urlopen(api_url, timeout=1)  # noqa: S310
            _mark_ready(proc)
            logger.info("go2rtc API ready (after %d attempt(s))", attempt)
            return True
        except urllib.error.URLError, OSError:
            if time.monotonic() >= deadline:
                break
            time.sleep(0.1)
    logger.warning("go2rtc API not ready after %.1fs — streams may fail to register", timeout)
    return False


def start(timeout: float = _START_TIMEOUT_S) -> bool:
    """Ensure go2rtc is running **and its API is ready**; returns True when ready.

    Unlike the previous implementation, every caller waits (bounded by *timeout*)
    for API readiness — not just the thread that happened to spawn the process.
    This closes the startup race where a concurrent request (e.g. the second
    ``/streams`` call on the Live wall) tried to register streams or proxy the WS
    before go2rtc's API port was bound, failing with ``Connection refused``.
    """
    global _proc, _stderr_thread
    binary = _binary()
    if binary is None:
        logger.info("go2rtc disabled or binary not found; live streaming unavailable")
        return False

    deadline = time.monotonic() + timeout
    # 1. If a process is up and ready, we're done. If it's up but still starting
    #    (or mid-stop), wait for it rather than racing it with a new spawn.
    while True:
        with _lock:
            proc = _proc
            if proc is not None and proc.poll() is None and _api_ready.is_set():
                return True
            need_start = proc is None or proc.poll() is not None
        if not need_start:
            if _api_ready.wait(0.05):
                return True
            if time.monotonic() >= deadline:
                # Nothing else is going to bring it up; re-check it didn't just die
                # so we can restart below rather than give up.
                with _lock:
                    if _proc is None or _proc.poll() is not None:
                        break
                return False
            continue
        break

    # 2. Spawn a fresh process — unless a concurrent caller has already taken
    # ownership by the time we acquire the lock. Both callers can pass the check
    # above before either reaches this point; re-checking under the lock here
    # makes them share one process instead of each spawning a duplicate (which
    # would just fail to bind the API port).
    spawned = None
    with _lock:
        _cancel_idle_timer()
        if _proc is not None and _proc.poll() is None:
            # Another thread is cold-starting this process; wait for it to become
            # ready below rather than spawning a second one.
            pass
        else:
            _api_ready.clear()
            cfg = _write_config()
            try:
                _proc = subprocess.Popen(
                    [binary, "-config", str(cfg)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                )
                spawned = _proc
                _stderr_thread = threading.Thread(target=_drain_stderr, args=(_proc,), daemon=True)
                _stderr_thread.start()
                logger.info("Started go2rtc (pid=%s) with config %s", _proc.pid, cfg)
            except OSError as exc:
                _proc = None
                logger.warning("Failed to start go2rtc: %s", exc)
                return False

    if spawned is not None:
        ok = _wait_for_api(spawned, timeout=timeout)
        if ok:
            _mark_ready(spawned)
        else:
            # The API never came up (or the process died while starting). Terminate a
            # still-alive process so it releases its ports, then drop the handle so a
            # later start() can retry instead of waiting on a wedged process.
            if spawned.poll() is None:
                _terminate_and_reap(spawned)
            _clear_if_current(spawned)
    else:
        # Reusing a process spawned by a concurrent caller: bound-wait for it to
        # become ready (_mark_ready sets the event once the API responds). If it
        # never does within the timeout we report unavailable, like any other
        # failed boot, rather than spawning a duplicate.
        ok = _api_ready.wait(timeout)
    return ok


def _terminate_and_reap(proc: subprocess.Popen[bytes]) -> None:
    """Gracefully stop a subprocess: SIGTERM → wait → SIGKILL → wait.

    Must be called *outside* the module lock so the blocking waits do not
    starve other threads.
    """
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.warning(
                "go2rtc zombie process could not be reaped (pid=%s)",
                proc.pid,
            )


def stop() -> None:
    """Terminate the go2rtc child process if running."""
    global _proc, _active_streams
    with _lock:
        _cancel_idle_timer()
        _active_streams = 0
        if _proc is None:
            return
        proc = _proc
    # Clear readiness and reap the process BEFORE releasing the handle, so a
    # concurrent start() never launches a new go2rtc onto ports the old one still
    # holds (which would make the new process die on bind failure).
    _api_ready.clear()
    if proc.poll() is None:
        _terminate_and_reap(proc)
    with _lock:
        if _proc is proc:
            _proc = None
    logger.info("Stopped go2rtc")


def _cancel_idle_timer() -> None:
    """Cancel any pending idle-stop timer (must be called with _lock held)."""
    global _idle_timer
    if _idle_timer is not None:
        _idle_timer.cancel()
        _idle_timer = None


def _idle_stop() -> None:
    """Called when the idle timeout expires — stop go2rtc if still idle."""
    global _proc
    with _lock:
        if _active_streams == 0 and _proc is not None and _proc.poll() is None:
            _cancel_idle_timer()
            proc = _proc
        else:
            return
    # Same reap-before-clear ordering as stop(): keep _proc until the old process
    # is fully gone so a concurrent start() doesn't spawn onto its ports.
    _api_ready.clear()
    logger.info("go2rtc idle for %ds — stopping", _IDLE_TIMEOUT_S)
    _terminate_and_reap(proc)
    with _lock:
        if _proc is proc:
            _proc = None


def stream_started(stream_name: str | None = None) -> bool:
    """Register that a live-view stream is now active — ensures go2rtc is running.

    ``start()`` is invoked for every stream request (not only cold starts) so each
    caller waits for API readiness.  Returns True if go2rtc is running and its API
    is ready; on startup failure the ``_active_streams`` increment is rolled back
    (mirroring :func:`stream_ended`) and False is returned.
    """
    global _active_streams
    with _lock:
        _cancel_idle_timer()
        _active_streams += 1
    logger.info("stream_started: stream=%s active_streams=%d", stream_name, _active_streams)
    if not start():
        logger.error("go2rtc failed to start in time; live view unavailable")
        stream_ended(stream_name)
        return False
    return True


def stream_ended(stream_name: str | None = None) -> None:
    """Register that a live-view stream has ended — schedules idle-stop if last."""
    global _active_streams, _idle_timer
    with _lock:
        _active_streams = max(0, _active_streams - 1)
        if _active_streams == 0 and _proc is not None and _proc.poll() is None:
            _cancel_idle_timer()
            _idle_timer = threading.Timer(_IDLE_TIMEOUT_S, _idle_stop)
            _idle_timer.daemon = True
            _idle_timer.start()
    logger.info("stream_ended: stream=%s active_streams=%d", stream_name, _active_streams)


def stream_name(camera_id: int, quality: str) -> str:
    return f"cam{camera_id}_{quality}"


def rtsp_url(camera, quality: str) -> str:
    """Build the RTSP URL (with embedded credentials) for a stream.

    For Hikvision cameras, derives the URL from the host and channel number.
    For Aqura cameras, returns the stored stream URL with credentials injected.
    """
    if getattr(camera, "camera_type", None) == "aqura":
        raw = getattr(camera, f"stream_url_{quality}", "") or ""
        if not raw:
            return ""
        user = urllib.parse.quote(camera.aqura_username or "", safe="")
        pw = urllib.parse.quote(camera.aqura_password or "", safe="")
        if (user or pw) and not urllib.parse.urlparse(raw).username:
            auth = f"{user}:{pw}@" if pw else f"{user}@"
            parsed = urllib.parse.urlparse(raw)
            raw = urllib.parse.urlunparse(parsed._replace(netloc=f"{auth}{parsed.netloc}"))
        return raw
    u = URL(camera.host or "")
    if not u.scheme:
        u = URL(f"http://{camera.host or ''}")
    host = u.host or (camera.host or "")
    user = urllib.parse.quote(camera.username or "", safe="")
    pw = urllib.parse.quote(camera.password or "", safe="")
    if not user and pw:
        logger.warning(
            "Camera %d (%s): password set but username is empty — RTSP auth will fail",
            camera.id,
            getattr(camera, "name", camera.id),
        )
    auth = f"{user}:{pw}@" if (camera.username or camera.password) else ""
    return f"rtsp://{auth}{host}/Streaming/Channels/{_CHANNELS[quality]}"


def _put_stream(name: str, srcs: list[str]) -> None:
    """Register (or update) a stream with go2rtc via its REST API.

    Multiple ``src`` values register alternative producers for the same stream;
    go2rtc serves whichever the consumer can use (e.g. a native RTSP track, or an
    ffmpeg-transcoded one when the browser can't decode the source codec).
    """
    params = [("name", name)] + [("src", s) for s in srcs]
    url = f"{settings.go2rtc_api.rstrip('/')}/api/streams?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, method="PUT")
    with urllib.request.urlopen(req, timeout=5):  # noqa: S310 (localhost, fixed scheme)
        pass


def _stream_sources(camera, quality: str, name: str) -> list[str]:
    """Producer list for a stream: the native RTSP track plus, for Hikvision
    main and all Aqura streams, an ffmpeg H.264 transcode fallback.

    Hikvision main streams are commonly H.265/HEVC, which browsers cannot play
    over WebRTC. go2rtc falls back to the ffmpeg-transcoded H.264 track only when
    a consumer can't use the native codec — so H.264 cameras pay no transcode
    cost, and the sub stream (already H.264) never needs it.
    Aqura streams are unknown codec, so all 3 get the transcode fallback.
    """
    url = rtsp_url(camera, quality)
    srcs = [url] if url else []
    if not srcs:
        return srcs
    ct = getattr(camera, "camera_type", None)
    if ct == "hikvision" and quality == "main":
        srcs.append(f"ffmpeg:{name}#video=h264")
    elif ct == "aqura":
        srcs.append(f"ffmpeg:{name}#video=h264")
    return srcs


def ensure_camera_streams(camera) -> dict[str, str] | None:
    """Register the camera's streams with go2rtc; return their names.

    For Hikvision cameras, registers main+sub streams derived from the host.
    For Aqura cameras, registers the 3 user-configured RTSP URLs.
    Returns None if go2rtc isn't available or the camera has no stream configured.
    """
    if not is_available():
        return None
    is_aqura = getattr(camera, "camera_type", None) == "aqura"
    if is_aqura:
        if not any(getattr(camera, f"stream_url_{q}", None) for q in _AQURA_QUALITIES):
            return None
        qualities = _AQURA_QUALITIES
    else:
        if not (camera.host or "").strip():
            return None
        qualities = list(_CHANNELS)
    names: dict[str, str] = {}
    for quality in qualities:
        name = stream_name(camera.id, quality)
        srcs = _stream_sources(camera, quality, name)
        if not srcs:
            continue
        try:
            _put_stream(name, srcs)
            names[quality] = name
        except (urllib.error.URLError, OSError) as exc:
            logger.warning("go2rtc stream register failed (%s): %s", name, exc)
    return names or None


def api_probe(name: str) -> bool:
    """Best-effort check that a stream produces media (used by the API layer)."""
    url = f"{settings.go2rtc_api.rstrip('/')}/api/streams?src={urllib.parse.quote(name)}"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310
            json.loads(resp.read() or b"{}")
        return True
    except (urllib.error.URLError, OSError, ValueError) as exc:
        logger.debug("api_probe failed for %s: %s", name, exc)
        return False


def fetch_logs(since_ms: int = 0) -> list[dict]:
    """Fetch go2rtc's in-memory log entries via its REST API.

    Returns a list of dicts with at least ``level`` and ``message`` keys.
    ``since_ms`` filters to entries after the given epoch-millisecond timestamp
    (0 = return all).  go2rtc's ``/api/log`` endpoint returns newline-delimited
    JSON (NDJSON), one object per line — not a JSON array.
    """
    url = f"{settings.go2rtc_api.rstrip('/')}/api/log"
    try:
        with urllib.request.urlopen(url, timeout=5) as resp:  # noqa: S310
            raw = resp.read().decode(errors="replace")
        data = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        if since_ms:
            data = [e for e in data if e.get("time", 0) > since_ms]
        return data
    except (urllib.error.URLError, OSError) as exc:
        logger.debug("Failed to fetch go2rtc logs: %s", exc)
        return []


def stream_warnings(stream_name: str, logs: list[dict] | None = None) -> list[dict]:
    """Return go2rtc warn/error log entries that mention a specific stream.

    If *logs* is provided (a pre-fetched snapshot from :func:`fetch_logs`), filter
    that directly instead of making a redundant API call.
    """
    if logs is None:
        logs = fetch_logs()
    return [
        e for e in logs if e.get("level") in ("warn", "error") and e.get("stream") == stream_name
    ]
