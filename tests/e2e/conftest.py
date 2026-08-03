"""E2E test configuration for Playwright."""
# --base-url and base_url fixture are provided by pytest-playwright.

import os
import shutil
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import pytest
import requests

# In CI the container mounts /tmp/cem-e2e-recordings → /tmp/e2e-recordings.
# Locally we use a temp dir (same filesystem for host and server).
_CI_HOST_DIR = "/tmp/cem-e2e-recordings"
_CONTAINER_RECORDING_DIR = "/tmp/e2e-recordings"

# Pre-made test MP4 committed to the repo — no ffmpeg needed on the test runner.
FIXTURE_MP4 = Path(__file__).resolve().parent.parent / "fixtures" / "test_clip.mp4"


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


def _server_has_ffmpeg(base_url: str) -> bool:
    """Probe the server's /stream endpoint to check if ffmpeg is available."""
    try:
        # Get any recording id — just need to check if stream returns video
        r = requests.get(f"{base_url}/api/v1/recordings", params={"limit": 1}, timeout=5)
        if not r.ok:
            return False
        data = r.json()
        recordings = data.get("recordings", data) if isinstance(data, dict) else data
        if not recordings:
            return False
        rec_id = recordings[0]["id"]
        r = requests.get(f"{base_url}/api/v1/recordings/{rec_id}/stream", stream=True, timeout=5)
        ct = r.headers.get("content-type", "")
        r.close()
        return r.status_code == 200 and "video" in ct
    except Exception:
        return False


@pytest.fixture(scope="session")
def seeded_data(base_url):
    """Seed the dev/CI server with a camera and recordings for e2e tests.

    Copies the pre-made fixture MP4 (from tests/fixtures/) to a temp directory,
    registers a camera via the API, triggers a scan, and yields the seeded data.
    Cleans up after.
    """
    assert FIXTURE_MP4.exists(), f"Fixture MP4 missing: {FIXTURE_MP4}"

    in_ci = "CI" in os.environ

    if in_ci:
        host_dir = _CI_HOST_DIR
        recording_path = _CONTAINER_RECORDING_DIR
    else:
        host_dir = tempfile.mkdtemp(prefix="e2e-seed-")
        recording_path = host_dir

    os.makedirs(host_dir, exist_ok=True)
    mp4_path = os.path.join(host_dir, "test_clip.mp4")
    shutil.copy2(FIXTURE_MP4, mp4_path)

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

    # Check if the server can transcode video (needs ffmpeg in the container)
    has_video = _server_has_ffmpeg(base_url)

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
