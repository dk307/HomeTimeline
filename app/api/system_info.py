"""GET /api/v1/system_info — version, build, system, ffmpeg, and storage details.

Expensive values (subprocess calls, importlib lookups) are cached at first
invocation.  Only storage fields are computed fresh per request.
"""

from __future__ import annotations

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

_cache: dict[str, object] = {}


def _run(args: list[str]) -> str:
    """Run a command, return stdout or empty string on failure."""
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=5, check=False
        )
        return result.stdout.strip()
    except Exception:
        return ""


def _pkg_ver(name: str) -> str:
    try:
        return _pkg_version(name)
    except Exception:
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
    return [l.strip() for l in out.splitlines()[1:] if l.strip()] if out else []


def _hw_available() -> dict[str, bool]:
    """Check for actual hardware device nodes on this machine."""
    checks: dict[str, bool] = {}
    # VAAPI — Intel/AMD GPU via DRM render node
    checks["vaapi"] = any(Path(p).exists() for p in ["/dev/dri/renderD128", "/dev/dri/renderD129"])
    # V4L2 M2M — Raspberry Pi, Rockchip, etc.
    checks["v4l2m2m"] = any(Path(p).exists() for p in Path("/dev").glob("video*"))
    # NVENC — NVIDIA GPU
    try:
        result = subprocess.run(["nvidia-smi"], capture_output=True, timeout=3)
        checks["nvenc"] = result.returncode == 0
    except Exception:
        checks["nvenc"] = False
    # QSV — Intel Quick Sync (needs /dev/dri + i965/iHD driver)
    checks["qsv"] = checks["vaapi"]  # practically same device nodes on Linux
    # VideoToolbox — macOS only
    checks["videotoolbox"] = platform.system() == "Darwin"
    # CUDA — NVIDIA GPU
    checks["cuda"] = Path("/usr/local/cuda").exists() or Path("/usr/lib/x86_64-linux-gnu/libcuda.so").exists()
    return checks


def _ffmpeg_codecs(kind: str) -> list[str]:
    """kind is 'encoders' or 'decoders'."""
    out = _run(["ffmpeg", "-hide_banner", f"-{kind}", "2"])
    if not out:
        return []
    result = []
    for line in out.splitlines():
        stripped = line.lstrip()
        # Codec lines start with a type char then dots: "V..... av1", "A..... aac"
        if len(stripped) > 2 and stripped[0] in "VASTD" and "." in stripped[:8]:
            tokens = stripped.split()
            if len(tokens) >= 2:
                result.append(tokens[1])
    return result


def _ffmpeg_hw_codecs(kind: str) -> list[str]:
    """Hardware-accelerated encoders/decoders."""
    out = _run(["ffmpeg", "-hide_banner", f"-{kind}", "2"])
    if not out:
        return []
    hw_keywords = ("vaapi", "nvenc", "v4l2m2m", "qsv", "videotoolbox", "cuda", "drm")
    result = []
    for line in out.splitlines():
        stripped = line.lstrip()
        if len(stripped) > 2 and stripped[0] in "VASTD" and "." in stripped[:8]:
            tokens = stripped.split()
            if len(tokens) >= 2 and any(kw in tokens[1] for kw in hw_keywords):
                result.append(tokens[1])
    return result


def _ffmpeg_config() -> str:
    out = _run(["ffmpeg", "-hide_banner", "-buildconf"])
    if not out:
        return ""
    # Condense: strip the header lines, join enabled flags
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
    first_line = out.splitlines()[0] if out else ""
    # e.g. "ffmpeg version 6.1.1 Copyright ..."
    version = first_line.split()[2] if len(first_line.split()) >= 3 else first_line
    build_date = ""
    for line in out.splitlines():
        if "built with" in line.lower() or "gcc" in line.lower():
            build_date = line.strip()
            break
    return {"version": version, "build_date": build_date}


def _cached_components() -> dict[str, str]:
    if "components" not in _cache:
        _cache["components"] = {
            "app": _pkg_ver("camera-event-manager"),
            "python": platform.python_version(),
            "fastapi": _pkg_ver("fastapi"),
            "uvicorn": _pkg_ver("uvicorn"),
            "peewee": _pkg_ver("peewee"),
            "go2rtc": GO2RTC_VERSION,
            "node": NODE_VERSION,
        }
    return _cache["components"]  # type: ignore[return-value]


def _cached_build() -> dict[str, str]:
    if "build" not in _cache:
        _cache["build"] = {
            "git_sha": GIT_SHA,
            "build_time": BUILD_TIME,
            "arch": platform.machine(),
        }
    return _cache["build"]  # type: ignore[return-value]


def _cached_system() -> dict[str, object]:
    if "system" not in _cache:
        _cache["system"] = {
            "os": platform.platform(),
            "kernel": platform.release(),
            "sqlite": sqlite3.sqlite_version,
            "python_impl": f"{platform.python_implementation()} {platform.architecture()[0]}",
            "hwaccels": _hw_accels(),
            "hw_available": _hw_available(),
            "cpu_features": _cpu_features(),
        }
    return _cache["system"]  # type: ignore[return-value]


def _cached_ffmpeg() -> dict[str, object]:
    if "ffmpeg" not in _cache:
        vinfo = _ffmpeg_version_info()
        _cache["ffmpeg"] = {
            "version": vinfo["version"],
            "build_date": vinfo["build_date"],
            "config": _ffmpeg_config(),
            "encoders": _ffmpeg_codecs("encoders"),
            "decoders": _ffmpeg_codecs("decoders"),
            "hw_encoders": _ffmpeg_hw_codecs("encoders"),
            "hw_decoders": _ffmpeg_hw_codecs("decoders"),
        }
    return _cache["ffmpeg"]  # type: ignore[return-value]


def _get_storage() -> dict[str, object]:
    """Storage fields computed fresh per request."""
    rec_paths = settings.recording_paths
    paths_str = ":".join(rec_paths)

    disk_free = 0.0
    disk_total = 0.0
    for p in rec_paths:
        try:
            usage = shutil.disk_usage(p)
            disk_free += usage.free / (1024 ** 3)
            disk_total += usage.total / (1024 ** 3)
        except OSError:
            pass

    # Database size
    db_size_mb = 0.0
    try:
        db_path = settings.db_path
        if os.path.isfile(db_path):
            db_size_mb = os.path.getsize(db_path) / (1024 ** 2)
    except OSError:
        pass

    # Thumbnails
    thumb_dir = settings.thumbnail_dir
    thumbnail_count = 0
    thumbnail_size_mb = 0.0
    try:
        thumb_path = Path(thumb_dir)
        if thumb_path.is_dir():
            for f in thumb_path.iterdir():
                if f.is_file():
                    thumbnail_count += 1
                    thumbnail_size_mb += f.stat().st_size / (1024 ** 2)
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
