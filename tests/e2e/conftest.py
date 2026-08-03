"""E2E test configuration for Playwright."""
# --base-url and base_url fixture are provided by pytest-playwright.

import os
import shutil
import subprocess
import tempfile
import time
from urllib.parse import urlparse

import pytest
import requests

# In CI the container mounts /tmp/cem-e2e-recordings → /tmp/e2e-recordings.
# Locally we use a temp dir (same filesystem for host and server).
_CI_HOST_DIR = "/tmp/cem-e2e-recordings"
_CONTAINER_RECORDING_DIR = "/tmp/e2e-recordings"


@pytest.fixture(autouse=True)
def test_db():
    """Shadow the root conftest test_db so E2E tests don't require peewee."""
    pass


@pytest.fixture(autouse=True, scope="session")
def _enforce_local_base_url(base_url):
    """Reject --base-url if it points to a non-local server."""
    host = urlparse(base_url).hostname or ""
    if host not in ("localhost", "127.0.0.1", "0.0.0.0"):
        pytest.exit(
            f"REFUSING --base-url {base_url}: e2e tests only run against local dev server. "
            f"Use: pytest tests/e2e --base-url http://localhost:8080"
        )


def _generate_test_mp4(path: str) -> bool:
    """Generate a tiny valid MP4 using ffmpeg. Returns True on success."""
    try:
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1:r=1",
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                "-pix_fmt", "yuv420p",
                "-an",
                path,
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        return True
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        return False


@pytest.fixture(scope="session")
def seeded_data(base_url):
    """Seed the dev/CI server with a camera and recordings for e2e tests.

    Creates a directory with a tiny test MP4, registers a camera via the API,
    triggers a scan to index it, and yields the seeded data.  Cleans up after.

    In CI the recording directory is a Docker volume mount shared with the
    container; locally it's a temp dir on the same filesystem.
    """
    in_ci = "CI" in os.environ

    if in_ci:
        host_dir = _CI_HOST_DIR
        recording_path = _CONTAINER_RECORDING_DIR
    else:
        host_dir = tempfile.mkdtemp(prefix="e2e-seed-")
        recording_path = host_dir

    os.makedirs(host_dir, exist_ok=True)
    mp4_path = os.path.join(host_dir, "test_clip.mp4")
    has_video = _generate_test_mp4(mp4_path)

    # If ffmpeg isn't available, create a dummy file so the scanner can index it.
    # The recording will have null duration but still appears in the API.
    if not has_video and not os.path.exists(mp4_path):
        with open(mp4_path, "wb") as f:
            f.write(b"\x00" * 1024)

    # Create camera via API
    r = requests.post(
        f"{base_url}/api/v1/cameras",
        json={
            "name": "E2E Seed Cam",
            "recording_path": recording_path,
            "camera_type": "hikvision",
            "host": "192.0.2.10",
            "username": "admin",
            "password": "secret",
        },
        timeout=10,
    )
    r.raise_for_status()
    camera = r.json()
    camera_id = camera["id"]

    # Trigger per-camera scan and wait for completion
    requests.post(f"{base_url}/api/v1/cameras/{camera_id}/scan", timeout=10)
    for _ in range(30):
        time.sleep(1)
        r = requests.get(f"{base_url}/api/v1/scanner/status", timeout=10)
        if r.ok and not r.json().get("running"):
            break

    # Fetch seeded recordings
    r = requests.get(f"{base_url}/api/v1/recordings", params={"limit": 50}, timeout=10)
    recordings = r.json()
    if isinstance(recordings, dict) and "recordings" in recordings:
        recordings = recordings["recordings"]

    # Fetch camera stats
    r = requests.get(f"{base_url}/api/v1/cameras/{camera_id}/stats", timeout=10)
    stats = r.json() if r.ok else {}

    data = {
        "camera": camera,
        "camera_id": camera_id,
        "recordings": recordings,
        "stats": stats,
        "has_video": has_video,
    }

    yield data

    # Cleanup
    try:
        requests.delete(f"{base_url}/api/v1/cameras/{camera_id}", timeout=10)
    except Exception:
        pass
    if not in_ci:
        shutil.rmtree(host_dir, ignore_errors=True)
    else:
        # In CI, remove files but keep the mount point
        for f in os.listdir(host_dir):
            try:
                os.remove(os.path.join(host_dir, f))
            except OSError:
                pass
