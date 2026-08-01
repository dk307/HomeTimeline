"""GET /api/v1/system_info — version, build, system, ffmpeg, and storage details.

Expensive values (subprocess calls, importlib lookups) are cached at first
invocation via functools.cache.  Only storage fields are computed fresh per
request.
"""

from __future__ import annotations

import functools
import logging
import os
import platform
import shutil
import sqlite3
import subprocess
from importlib.metadata import version as _pkg_version
from pathlib import Path

from fastapi import APIRouter

from app.build_info import BUILD_TIME, GIT_SHA, GO2RTC_VERSION, NODE_VERSION
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["system"])


def _run(args: list[str]) -> str:
    """Run a command, return stdout or empty string on failure."""
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=5, check=False)
        return result.stdout.strip()
    except Exception as exc:
        logger.debug("_run failed for %s: %s", args, exc)
        return ""


def _pkg_ver(name: str) -> str:
    try:
        return _pkg_version(name)
    except Exception as exc:
        logger.debug("_pkg_ver failed for %s: %s", name, exc)
        return "unknown"


def _cpu_features() -> list[str]:
    """Parse /proc/cpuinfo for CPU feature flags."""
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("Features") or line.startswith("flags"):
                    return line.split(":", 1)[1].strip().split()
    except OSError:
        pass
    return []


def _hw_accels() -> list[str]:
    out = _run(["ffmpeg", "-hide_banner", "-hwaccels"])
    return [line.strip() for line in out.splitlines()[1:] if line.strip()] if out else []


def _hw_available() -> dict[str, bool]:
    """Check for actual hardware device nodes on this machine."""
    checks: dict[str, bool] = {}
    checks["vaapi"] = any(Path(p).exists() for p in ["/dev/dri/renderD128", "/dev/dri/renderD129"])
    checks["v4l2m2m"] = any(Path("/dev").glob("video*"))
    checks["nvenc"] = bool(_run(["nvidia-smi"]))
    checks["qsv"] = checks["vaapi"]
    checks["videotoolbox"] = platform.system() == "Darwin"
    checks["cuda"] = (
        Path("/usr/local/cuda").exists() or Path("/usr/lib/x86_64-linux-gnu/libcuda.so").exists()
    )
    return checks


_HW_KEYWORDS = ("vaapi", "nvenc", "v4l2m2m", "qsv", "videotoolbox", "cuda", "drm")


def _parse_codecs(output: str) -> list[str]:
    """Parse codec names from ffmpeg -encoders/-decoders output."""
    result: list[str] = []
    for line in output.splitlines():
        stripped = line.lstrip()
        if len(stripped) > 2 and stripped[0] in "VASTD" and "." in stripped[:8]:
            tokens = stripped.split()
            if len(tokens) >= 2:
                result.append(tokens[1])
    return result


def _ffmpeg_config() -> str:
    out = _run(["ffmpeg", "-hide_banner", "-buildconf"])
    if not out:
        return ""
    flags = []
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("--enable-"):
            flags.append(line.replace("--enable-", ""))
    return " ".join(sorted(flags))


def _ffmpeg_version_info() -> dict[str, str]:
    out = _run(["ffmpeg", "-hide_banner", "-version"])
    if not out:
        return {"version": "not installed", "build_date": ""}
    first_line = out.splitlines()[0]
    version = first_line.split()[2] if len(first_line.split()) >= 3 else first_line
    build_date = ""
    for line in out.splitlines():
        if "built with" in line.lower() or "gcc" in line.lower():
            build_date = line.strip()
            break
    return {"version": version, "build_date": build_date}


@functools.cache
def _cached_components() -> dict[str, str]:
    return {
        "app": _pkg_ver("camera-event-manager"),
        "python": platform.python_version(),
        "fastapi": _pkg_ver("fastapi"),
        "uvicorn": _pkg_ver("uvicorn"),
        "peewee": _pkg_ver("peewee"),
        "go2rtc": GO2RTC_VERSION,
        "node": NODE_VERSION,
    }


@functools.cache
def _cached_build() -> dict[str, str]:
    return {
        "git_sha": GIT_SHA,
        "build_time": BUILD_TIME,
        "arch": platform.machine(),
    }


@functools.cache
def _cached_system() -> dict[str, object]:
    return {
        "os": platform.platform(),
        "kernel": platform.release(),
        "sqlite": sqlite3.sqlite_version,
        "python_impl": f"{platform.python_implementation()} {platform.architecture()[0]}",
        "hwaccels": _hw_accels(),
        "hw_available": _hw_available(),
        "cpu_features": _cpu_features(),
    }


@functools.cache
def _cached_ffmpeg() -> dict[str, object]:
    vinfo = _ffmpeg_version_info()
    encoders_out = _run(["ffmpeg", "-hide_banner", "-encoders", "2"])
    decoders_out = _run(["ffmpeg", "-hide_banner", "-decoders", "2"])
    all_encoders = _parse_codecs(encoders_out)
    all_decoders = _parse_codecs(decoders_out)
    return {
        "version": vinfo["version"],
        "build_date": vinfo["build_date"],
        "config": _ffmpeg_config(),
        "encoders": all_encoders,
        "decoders": all_decoders,
        "hw_encoders": [e for e in all_encoders if any(kw in e for kw in _HW_KEYWORDS)],
        "hw_decoders": [d for d in all_decoders if any(kw in d for kw in _HW_KEYWORDS)],
    }


def _get_storage() -> dict[str, object]:
    """Storage fields computed fresh per request."""
    rec_paths = settings.recording_paths
    paths_str = ":".join(rec_paths)

    disk_free = 0.0
    disk_total = 0.0
    seen_devices: set[int] = set()
    for p in rec_paths:
        try:
            device_id = os.stat(p).st_dev
            if device_id in seen_devices:
                continue
            seen_devices.add(device_id)
            usage = shutil.disk_usage(p)
            disk_free += usage.free / (1024**3)
            disk_total += usage.total / (1024**3)
        except OSError:
            pass

    # Database size
    db_size_mb = 0.0
    try:
        db_path = settings.db_path
        if os.path.isfile(db_path):
            db_size_mb = os.path.getsize(db_path) / (1024**2)
    except OSError:
        pass

    # Thumbnails
    thumb_dir = settings.thumbnail_dir
    thumbnail_count = 0
    thumbnail_size_mb = 0.0
    try:
        with os.scandir(thumb_dir) as entries:
            for entry in entries:
                if entry.is_file():
                    thumbnail_count += 1
                    thumbnail_size_mb += entry.stat().st_size / (1024**2)
    except OSError:
        pass

    return {
        "recordings_path": paths_str,
        "disk_free_gb": round(disk_free, 1),
        "disk_total_gb": round(disk_total, 1),
        "db_size_mb": round(db_size_mb, 1),
        "thumbnail_count": thumbnail_count,
        "thumbnail_size_mb": round(thumbnail_size_mb, 1),
    }


@router.get("/system_info")
def system_info() -> dict[str, object]:
    return {
        "components": _cached_components(),
        "build": _cached_build(),
        "system": _cached_system(),
        "ffmpeg": _cached_ffmpeg(),
        "storage": _get_storage(),
    }
