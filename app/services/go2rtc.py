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

import contextlib
import json
import logging
import shutil
import subprocess
import threading
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


def start() -> None:
    """Launch the go2rtc child process (no-op if disabled or already running)."""
    global _proc
    binary = _binary()
    if binary is None:
        logger.info("go2rtc disabled or binary not found; live streaming unavailable")
        return
    with _lock:
        if _proc is not None and _proc.poll() is None:
            return
        cfg = _write_config()
        try:
            _proc = subprocess.Popen(
                [binary, "-config", str(cfg)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            logger.info("Started go2rtc (pid=%s) with config %s", _proc.pid, cfg)
        except OSError as exc:
            _proc = None
            logger.warning("Failed to start go2rtc: %s", exc)


def stop() -> None:
    """Terminate the go2rtc child process if running."""
    global _proc
    with _lock:
        if _proc is None:
            return
        if _proc.poll() is None:
            _proc.terminate()
            try:
                _proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _proc.kill()
                # Reap the killed child so it doesn't linger as a zombie.
                with contextlib.suppress(subprocess.TimeoutExpired):
                    _proc.wait(timeout=5)
        _proc = None
    logger.info("Stopped go2rtc")


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
        if user or pw:
            auth = f"{user}:{pw}@" if pw else f"{user}@"
            raw = raw.replace("rtsp://", f"rtsp://{auth}", 1)
        return raw
    u = URL(camera.host or "")
    if not u.scheme:
        u = URL(f"http://{camera.host or ''}")
    host = u.host or (camera.host or "")
    user = urllib.parse.quote(camera.username or "", safe="")
    pw = urllib.parse.quote(camera.password or "", safe="")
    auth = f"{user}:{pw}@" if (camera.username or camera.password) else ""
    return f"rtsp://{auth}{host}:554/Streaming/Channels/{_CHANNELS[quality]}"


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
        try:
            _put_stream(name, _stream_sources(camera, quality, name))
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
    except urllib.error.URLError, OSError, ValueError:
        return False
