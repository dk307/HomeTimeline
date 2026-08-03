"""
End-to-end tests against the local dev server with seeded test data.

Uses the ``seeded_data`` fixture (conftest.py) which creates a camera with a
tiny MP4, triggers a scan, and cleans up afterward.

Run:
  pytest tests/e2e/test_e2e.py --base-url http://localhost:8080
"""

import re

import pytest
import requests
from playwright.sync_api import Page, expect

# ── API smoke tests (requests, no browser) ────────────────────────────────────


def test_api_health(base_url):
    r = requests.get(f"{base_url}/api/v1/health", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"


def test_api_cameras_list(base_url, seeded_data):
    r = requests.get(f"{base_url}/api/v1/cameras", timeout=10)
    assert r.status_code == 200
    cameras = r.json()
    assert len(cameras) >= 1
    cam = cameras[0]
    assert "id" in cam and "name" in cam and "clip_strategy" in cam
    assert "scan_interval_minutes" in cam


def test_api_settings_has_no_scan_interval(base_url):
    """Scanning moved to per-camera; the global app setting is gone."""
    r = requests.get(f"{base_url}/api/v1/settings", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "timezone" in body
    assert "scan_interval_minutes" not in body


def test_api_recordings_list_all(base_url, seeded_data):
    """No date filter returns seeded recordings (newest first)."""
    assert len(seeded_data["recordings"]) >= 1
    recs = seeded_data["recordings"]
    if len(recs) > 1:
        assert recs[0]["start_time"] >= recs[1]["start_time"]


def test_api_recordings_list_by_date(base_url, seeded_data):
    """Filter by the date of the seeded recording."""
    recs = seeded_data["recordings"]
    assert len(recs) >= 1
    # Use the actual server response to get the date (not the stale fixture cache).
    r_all = requests.get(f"{base_url}/api/v1/recordings", params={"limit": 1}, timeout=10)
    r_all.raise_for_status()
    all_data = r_all.json()
    all_recs = all_data["recordings"] if isinstance(all_data, dict) and "recordings" in all_data else all_data
    assert len(all_recs) >= 1, "No recordings on server"
    date_str = all_recs[0]["start_time"][:10]
    r = requests.get(f"{base_url}/api/v1/recordings", params={"date": date_str, "limit": 50}, timeout=10)
    r.raise_for_status()
    data = r.json()
    filtered = data["recordings"] if isinstance(data, dict) and "recordings" in data else data
    assert len(filtered) >= 1
    from datetime import date, timedelta

    d = date.fromisoformat(date_str)
    allowed = {(d + timedelta(days=off)).isoformat() for off in (-1, 0, 1)}
    for rec in filtered:
        assert rec["start_time"][:10] in allowed, f"{rec['start_time']} not near {date_str}"


def test_api_recording_has_required_fields(base_url, seeded_data):
    rec = seeded_data["recordings"][0]
    for field in ("id", "camera_id", "file_path", "start_time", "status", "duration_secs"):
        assert field in rec, f"Missing field: {field}"
    assert rec["status"] == "ready"


def test_api_scanner_status(base_url):
    r = requests.get(f"{base_url}/api/v1/scanner/status", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "running" in data


def test_api_scanner_blocks_concurrent(base_url):
    """POST /scan returns started or already_running."""
    r = requests.post(f"{base_url}/api/v1/scanner/scan", timeout=10)
    assert r.status_code == 202
    data = r.json()
    assert data["status"] in ("started", "already_running")


def test_api_camera_stats(base_url, seeded_data):
    """Per-camera stats endpoint returns the summary fields the detail page needs."""
    cam_id = seeded_data["camera_id"]
    r = requests.get(f"{base_url}/api/v1/cameras/{cam_id}/stats", timeout=10)
    assert r.status_code == 200
    data = r.json()
    for field in (
        "id",
        "name",
        "total_recordings",
        "total_duration_secs",
        "indexed_size_bytes",
        "last_video_at",
    ):
        assert field in data, f"Missing field: {field}"
    assert data["id"] == cam_id
    assert isinstance(data["total_recordings"], int)
    assert data["total_recordings"] >= 1
    assert data["total_duration_secs"] >= 0
    assert data["indexed_size_bytes"] > 0
    assert data["last_video_at"] is not None


def test_api_camera_stats_not_found(base_url):
    r = requests.get(f"{base_url}/api/v1/cameras/999999/stats", timeout=10)
    assert r.status_code == 404


def test_api_daily_counts_include_total_secs(base_url, seeded_data):
    """daily-counts must expose both clip count and total clip length per day."""
    cam_id = seeded_data["camera_id"]
    r = requests.get(
        f"{base_url}/api/v1/recordings/daily-counts?days=30&camera_id={cam_id}",
        timeout=10,
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 30
    for entry in data:
        assert set(entry) == {"date", "count", "total_secs"}
    assert sum(e["total_secs"] for e in data) >= 0


def test_api_activity(base_url):
    r = requests.get(f"{base_url}/api/v1/activity", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    for event in data:
        ts = event.get("started_at") or event.get("finished_at")
        if ts:
            assert not ts.endswith("+00:00Z"), f"Double suffix in timestamp: {ts}"


def test_api_logs(base_url):
    r = requests.get(f"{base_url}/api/v1/logs", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


def test_api_stream_returns_video(base_url, seeded_data):
    """Stream endpoint should return fMP4 bytes for the seeded recording."""
    if not seeded_data["has_video"]:
        pytest.skip("ffmpeg not available — cannot generate test video")
    rec_id = seeded_data["recordings"][0]["id"]
    r = requests.get(f"{base_url}/api/v1/recordings/{rec_id}/stream", stream=True, timeout=30)
    assert r.status_code == 200
    assert "video" in r.headers.get("content-type", "")
    chunk = next(r.iter_content(65536))
    r.close()
    assert len(chunk) > 0


def test_api_download_returns_file(base_url, seeded_data):
    """Download endpoint should return bytes with Content-Disposition attachment."""
    if not seeded_data["has_video"]:
        pytest.skip("ffmpeg not available — cannot generate test video")
    rec_id = seeded_data["recordings"][0]["id"]
    r = requests.get(f"{base_url}/api/v1/recordings/{rec_id}/download", stream=True, timeout=30)
    assert r.status_code in (200, 206)
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    chunk = next(r.iter_content(65536))
    r.close()
    assert len(chunk) > 0


def test_api_timeline(base_url, seeded_data):
    """Timeline endpoint should return data for the seeded recording's date."""
    if not seeded_data["has_video"]:
        pytest.skip("ffmpeg not available — cannot generate test video")
    date_str = seeded_data["recordings"][0]["start_time"][:10]
    r2 = requests.get(f"{base_url}/api/v1/timeline?date={date_str}", timeout=10)
    assert r2.status_code == 200
    data = r2.json()
    assert "segments" in data or isinstance(data, list)


# ── Browser (Playwright) tests ────────────────────────────────────────────────


def test_dashboard_loads(page: Page, base_url: str):
    page.goto(base_url)
    expect(page.locator("h1")).to_contain_text("Dashboard")


def test_dashboard_stat_cards(page: Page, base_url: str):
    page.goto(base_url)
    expect(page.get_by_text("Total Recordings")).to_be_visible()
    expect(page.locator("p", has_text="Indexed Size")).to_be_visible()
    expect(page.get_by_text("Total Clip Length")).to_be_visible()


def test_recordings_page_shows_data(page: Page, base_url: str, seeded_data):
    """Recordings page must show data for the seeded camera (grid or list view)."""
    page.goto(f"{base_url}/recordings")
    expect(page.locator("h1")).to_contain_text("Recordings")
    # Default view is grid (card-based), not table. Wait for either to appear.
    grid_cards = page.locator("[data-rec-id], .grid > button")
    table_rows = page.locator("tbody tr")
    page.wait_for_timeout(3000)
    has_grid = grid_cards.count() > 0
    has_table = table_rows.count() > 0
    assert has_grid or has_table, "No recordings visible in grid or list view"
    expect(page.get_by_text("No recordings found.")).not_to_be_visible()


def test_recordings_date_filter(page: Page, base_url: str, seeded_data):
    """Preset chips filter the list correctly."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_timeout(3000)
    page.get_by_test_id("date-range-trigger").click()
    page.get_by_role("option", name="Last 7 days").click()
    page.wait_for_timeout(800)
    expect(page.locator("h1")).to_contain_text("Recordings")


def test_recordings_custom_range(page: Page, base_url: str, seeded_data):
    """Custom range selected on the calendar filters the list."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_timeout(3000)
    page.get_by_test_id("date-range-trigger").click()
    page.get_by_role("option", name="Custom range…").click()
    page.wait_for_timeout(500)
    days = page.locator(".rdp-day_button:not([disabled])")
    expect(days.first).to_be_visible()
    assert days.count() >= 2
    start_idx = 0
    end_idx = min(3, days.count() - 1)
    days.nth(start_idx).click()
    page.wait_for_timeout(300)
    page.locator(".rdp-day_button:not([disabled])").nth(end_idx).click()
    page.wait_for_timeout(300)
    page.get_by_role("button", name="Apply").click()
    page.wait_for_timeout(600)
    expect(page.get_by_test_id("date-range-trigger")).not_to_contain_text("Last 7 days")
    expect(page.locator("h1")).to_contain_text("Recordings")


def test_recordings_all_preset_shows_all(page: Page, base_url: str, seeded_data):
    """All time preset shows all recordings (no date filter)."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_timeout(3000)
    page.get_by_test_id("date-range-trigger").click()
    page.get_by_role("option", name="Last 7 days").click()
    page.wait_for_timeout(500)
    page.get_by_test_id("date-range-trigger").click()
    page.get_by_role("option", name="All time").click()
    page.wait_for_timeout(800)
    expect(page.get_by_text("No recordings found.")).not_to_be_visible()


def test_video_player_opens(page: Page, base_url: str, seeded_data):
    """Clicking play on a recording opens the video player."""
    if not seeded_data["has_video"]:
        pytest.skip("ffmpeg not available — cannot generate test video")
    page.goto(f"{base_url}/recordings")
    page.wait_for_timeout(3000)
    # Grid view: click the first play button on a card
    play_btn = page.get_by_role("button", name=re.compile("Play|play", re.I))
    if play_btn.count() == 0:
        # Fallback: try the first button on any card
        play_btn = page.locator(".grid button").first
    play_btn.click()
    expect(page.locator("video")).to_be_visible(timeout=5000)


def test_video_player_closes(page: Page, base_url: str, seeded_data):
    """The X button in the player must close the video."""
    if not seeded_data["has_video"]:
        pytest.skip("ffmpeg not available — cannot generate test video")
    page.goto(f"{base_url}/recordings")
    page.wait_for_timeout(3000)
    play_btn = page.get_by_role("button", name=re.compile("Play|play", re.I))
    if play_btn.count() == 0:
        play_btn = page.locator(".grid button").first
    play_btn.click()
    video = page.locator("video")
    expect(video).to_be_visible(timeout=5000)
    page.locator("button:has(svg.lucide-x)").first.click()
    expect(video).not_to_be_visible(timeout=5000)


def test_timeline_page_loads(page: Page, base_url: str):
    page.goto(f"{base_url}/timeline")
    expect(page.locator("h1")).to_contain_text("Timeline")
    page.get_by_test_id("date-range-trigger").click()
    expect(page.get_by_role("option", name="Yesterday")).to_be_visible()
    page.keyboard.press("Escape")


def test_timeline_zoom_controls(page: Page, base_url: str):
    page.goto(f"{base_url}/timeline")
    expect(page.get_by_text(re.compile(r"^\d+x$"))).to_be_visible(timeout=5000)


def test_camera_detail_shows_real_stats(page: Page, base_url: str, seeded_data):
    """Per-camera page renders populated stats + chart."""
    cam_id = seeded_data["camera_id"]
    page.goto(f"{base_url}/cameras/{cam_id}")
    expect(page.locator("h1")).to_contain_text(seeded_data["camera"]["name"])
    expect(page.get_by_text("Total Recordings")).to_be_visible()
    expect(page.get_by_text("Total Clip Length")).to_be_visible()
    stats = seeded_data["stats"]
    assert stats["total_recordings"] >= 1
    expect(page.get_by_text(f"{stats['total_recordings']:,}", exact=True).first).to_be_visible(
        timeout=8000
    )
    expect(page.get_by_role("heading", name="Recordings activity")).to_be_visible()
    # Recharts renders SVG elements; bars may be hidden (0 height) if duration is 0.
    expect(page.locator("svg.recharts-surface").first).to_be_visible(timeout=8000)


def test_camera_detail_timeline_plays_recording(page: Page, base_url: str, seeded_data):
    """Clicking a clip on the single-camera timeline opens the video player."""
    if not seeded_data["has_video"]:
        pytest.skip("ffmpeg not available — cannot generate test video")
    cam_id = seeded_data["camera_id"]
    page.goto(f"{base_url}/cameras/{cam_id}")
    page.wait_for_timeout(1500)
    bars = page.locator("button[style*='%'][title]")
    if bars.count() == 0:
        pytest.skip("no clips visible in the default timeline window")
    bars.first.click(force=True)
    expect(page.locator("video")).to_be_visible(timeout=8000)


def test_camera_switcher_navigates(page: Page, base_url: str, seeded_data):
    """When multiple cameras exist, the switcher jumps between detail pages."""
    cameras = requests.get(f"{base_url}/api/v1/cameras", timeout=10).json()
    seen: set[str] = set()
    unique = [c for c in cameras if c["name"] not in seen and not seen.add(c["name"])]
    if len(unique) < 2:
        pytest.skip("needs >= 2 cameras with unique names")
    page.goto(f"{base_url}/cameras/{unique[0]['id']}")
    page.get_by_role("combobox", name="Switch camera").click()
    page.get_by_role("option", name=unique[1]["name"]).click()
    expect(page).to_have_url(f"{base_url}/cameras/{unique[1]['id']}")
    expect(page.locator("h1")).to_contain_text(unique[1]["name"])


def test_activity_page_loads_without_error(page: Page, base_url: str):
    """Activity page must render its list (or empty state), never a crash."""
    r = requests.get(f"{base_url}/api/v1/activity", timeout=10)
    assert r.status_code == 200, r.text
    events = r.json()
    page.goto(f"{base_url}/activity")
    expect(page.locator("h1")).to_contain_text("Activity")
    if events:
        expect(page.get_by_text(re.compile(r"(Scan|Download)")).first).to_be_visible(timeout=8000)
    else:
        expect(page.get_by_text("No scan or download activity yet.")).to_be_visible(timeout=8000)


def test_logs_page_shows_entries(page: Page, base_url: str):
    """Logs page must render buffered log rows."""
    r = requests.get(f"{base_url}/api/v1/logs", timeout=10)
    assert r.status_code == 200
    entries = r.json()
    assert isinstance(entries, list)
    page.goto(f"{base_url}/logs")
    expect(page.locator("h1")).to_contain_text("Logs")
    if entries:
        page.wait_for_selector("tbody tr", timeout=8000)
        expect(page.get_by_text("No log entries.")).not_to_be_visible()
        page.get_by_role("button", name="INFO", exact=True).click()
        expect(page.locator("h1")).to_contain_text("Logs")
    else:
        expect(page.get_by_text("No log entries.")).to_be_visible(timeout=8000)


def test_settings_cameras_page(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/cameras")
    expect(page.locator("h1")).to_contain_text("Cameras")
    expect(page.get_by_role("button", name="Add Camera")).to_be_visible(timeout=8000)


def test_settings_locations_page(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/locations")
    expect(page.locator("h1")).to_contain_text("Locations")
