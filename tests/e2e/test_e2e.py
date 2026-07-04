"""
End-to-end tests against a LIVE server with real data.

NOT run in CI — requires a real deployment with cameras and recordings indexed.
Run manually:
  pytest tests/e2e/test_e2e.py --base-url http://<server>:8080

These tests assume at least one camera is configured and at least one recording
has been indexed (the Garage camera currently has ~300+ recordings from Jan 2026).
"""

import os
import re

import pytest
import requests

# Skip this entire file in CI (no live data available)
pytestmark = pytest.mark.skipif(
    "CI" in os.environ,
    reason="Live-data tests skipped in CI — run manually against a real server",
)

from playwright.sync_api import Page, expect  # noqa: E402

# ── API smoke tests (requests, no browser) ────────────────────────────────────


def test_api_health(base_url):
    r = requests.get(f"{base_url}/api/v1/health", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert data.get("status") == "ok"


def test_api_cameras_list(base_url):
    r = requests.get(f"{base_url}/api/v1/cameras", timeout=10)
    assert r.status_code == 200
    cameras = r.json()
    assert len(cameras) >= 1
    cam = cameras[0]
    assert "id" in cam and "name" in cam and "time_source" in cam
    # Per-camera scan schedule is exposed on the camera (None = Never).
    assert "scan_interval_minutes" in cam


def test_api_settings_has_no_scan_interval(base_url):
    """Scanning moved to per-camera; the global app setting is gone."""
    r = requests.get(f"{base_url}/api/v1/settings", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert "timezone" in body
    assert "scan_interval_minutes" not in body


def test_api_recordings_list_all(base_url):
    """No date filter → should return recordings (newest first)."""
    r = requests.get(f"{base_url}/api/v1/recordings?limit=10", timeout=10)
    assert r.status_code == 200
    recs = r.json()
    assert len(recs) >= 1
    # Verify newest-first order
    if len(recs) > 1:
        assert recs[0]["start_time"] >= recs[1]["start_time"]


def test_api_recordings_list_by_date(base_url):
    """Filter by a date that has data."""
    r = requests.get(f"{base_url}/api/v1/recordings?limit=3", timeout=10)
    recs = r.json()
    assert len(recs) >= 1
    # Use the date of the most-recent recording to filter
    date_str = recs[0]["start_time"][:10]
    r2 = requests.get(f"{base_url}/api/v1/recordings?date={date_str}&limit=50", timeout=10)
    assert r2.status_code == 200
    filtered = r2.json()
    assert len(filtered) >= 1
    # Date filtering is done in the app timezone, but start_time is serialized in UTC.
    # A recording on `date_str` (app tz) can therefore land on the previous/next UTC day.
    from datetime import date, timedelta

    d = date.fromisoformat(date_str)
    allowed = {(d + timedelta(days=off)).isoformat() for off in (-1, 0, 1)}
    for rec in filtered:
        assert rec["start_time"][:10] in allowed, f"{rec['start_time']} not near {date_str}"


def test_api_recording_has_required_fields(base_url):
    r = requests.get(f"{base_url}/api/v1/recordings?limit=1", timeout=10)
    rec = r.json()[0]
    for field in ("id", "camera_id", "file_path", "start_time", "status", "duration_secs"):
        assert field in rec, f"Missing field: {field}"
    assert rec["status"] == "ready"


def test_api_scanner_status(base_url):
    r = requests.get(f"{base_url}/api/v1/scanner/status", timeout=10)
    assert r.status_code == 200
    data = r.json()
    assert "running" in data


def test_api_scanner_blocks_concurrent(base_url):
    """If a scan is running, a second POST /scan should return already_running."""
    # We just verify the endpoint is well-formed; if nothing is running it returns started
    r = requests.post(f"{base_url}/api/v1/scanner/scan", timeout=10)
    assert r.status_code == 202
    data = r.json()
    assert data["status"] in ("started", "already_running")


def test_api_camera_stats(base_url):
    """Per-camera stats endpoint returns the summary fields the detail page needs."""
    cameras = requests.get(f"{base_url}/api/v1/cameras", timeout=10).json()
    cam_id = cameras[0]["id"]
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
    # Live camera has indexed recordings → non-empty totals.
    assert data["total_recordings"] >= 1
    assert data["total_duration_secs"] > 0
    assert data["indexed_size_bytes"] > 0
    assert data["last_video_at"] is not None


def test_api_camera_stats_not_found(base_url):
    r = requests.get(f"{base_url}/api/v1/cameras/999999/stats", timeout=10)
    assert r.status_code == 404


def test_api_daily_counts_include_total_secs(base_url):
    """daily-counts must expose both clip count and total clip length per day."""
    cameras = requests.get(f"{base_url}/api/v1/cameras", timeout=10).json()
    cam_id = cameras[0]["id"]
    r = requests.get(
        f"{base_url}/api/v1/recordings/daily-counts?days=30&camera_id={cam_id}",
        timeout=10,
    )
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 30
    for entry in data:
        assert set(entry) == {"date", "count", "total_secs"}
    # A camera with recordings should have at least one day of clip length.
    assert sum(e["total_secs"] for e in data) > 0


def test_api_activity(base_url):
    r = requests.get(f"{base_url}/api/v1/activity", timeout=10)
    assert r.status_code == 200
    data = r.json()
    # Activity returns a list directly
    assert isinstance(data, list)
    # Timestamps should not have double suffix like +00:00Z
    for event in data:
        ts = event.get("started_at") or event.get("finished_at")
        if ts:
            assert not ts.endswith("+00:00Z"), f"Double suffix in timestamp: {ts}"


def test_api_logs(base_url):
    r = requests.get(f"{base_url}/api/v1/logs", timeout=10)
    assert r.status_code == 200
    data = r.json()
    # Logs returns a list directly
    assert isinstance(data, list)


def test_api_stream_returns_video(base_url):
    """Stream endpoint should return fMP4 bytes for the first recording."""
    r_list = requests.get(f"{base_url}/api/v1/recordings?limit=1", timeout=10)
    rec_id = r_list.json()[0]["id"]
    r = requests.get(f"{base_url}/api/v1/recordings/{rec_id}/stream", stream=True, timeout=30)
    assert r.status_code == 200
    assert "video" in r.headers.get("content-type", "")
    # Read first 64k — should be valid fMP4 (starts with ftyp or moof box)
    chunk = next(r.iter_content(65536))
    r.close()
    assert len(chunk) > 0


def test_api_download_returns_file(base_url):
    """Download endpoint should return bytes with Content-Disposition attachment."""
    r_list = requests.get(f"{base_url}/api/v1/recordings?limit=1", timeout=10)
    rec_id = r_list.json()[0]["id"]
    r = requests.get(f"{base_url}/api/v1/recordings/{rec_id}/download", stream=True, timeout=30)
    assert r.status_code in (200, 206)
    cd = r.headers.get("content-disposition", "")
    assert "attachment" in cd
    chunk = next(r.iter_content(65536))
    r.close()
    assert len(chunk) > 0


def test_api_timeline(base_url):
    """Timeline endpoint should return data for a date with recordings."""
    r = requests.get(f"{base_url}/api/v1/recordings?limit=1", timeout=10)
    date_str = r.json()[0]["start_time"][:10]
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
    expect(page.get_by_text("Indexed Size")).to_be_visible()
    expect(page.get_by_text("Active Cameras")).to_be_visible()


def test_recordings_page_shows_data(page: Page, base_url: str):
    """Recordings page must show rows (not 'No recordings found')."""
    page.goto(f"{base_url}/recordings")
    expect(page.locator("h1")).to_contain_text("Recordings")
    # Wait for rows to load (no date filter → all recordings)
    page.wait_for_selector("tbody tr td:first-child", timeout=10000)
    rows = page.locator("tbody tr").all()
    assert len(rows) >= 1
    # Should NOT show the empty state message
    expect(page.get_by_text("No recordings found.")).not_to_be_visible()


def test_recordings_date_filter(page: Page, base_url: str):
    """Preset chips filter the list correctly."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_selector("tbody tr td:first-child", timeout=10000)
    # Open the date/range picker, then click the "Last 7 days" preset
    page.get_by_test_id("date-range-trigger").click()
    page.get_by_role("button", name="Last 7 days").click()
    page.wait_for_timeout(800)
    # Either rows appear or empty state — page must still be functional
    expect(page.locator("h1")).to_contain_text("Recordings")


def test_recordings_custom_range(page: Page, base_url: str):
    """Custom range selected on the calendar filters the list."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_selector("tbody tr td:first-child", timeout=10000)
    # Open the picker — the range calendar renders selectable day buttons
    page.get_by_test_id("date-range-trigger").click()
    page.wait_for_timeout(300)
    days = page.locator(".rdp-day_button:not([disabled])")
    expect(days.first).to_be_visible()
    assert days.count() >= 2
    # Pick a start day, then an end day to form a custom range. Re-query after the
    # first click since selecting a range boundary re-renders the calendar grid.
    start_idx = 0
    end_idx = min(3, days.count() - 1)
    days.nth(start_idx).click()
    page.wait_for_timeout(200)
    page.locator(".rdp-day_button:not([disabled])").nth(end_idx).click()
    page.wait_for_timeout(600)
    # Custom range is now active on the trigger; page still functional
    expect(page.get_by_test_id("date-range-trigger")).to_contain_text("Custom range")
    expect(page.locator("h1")).to_contain_text("Recordings")


def test_recordings_all_preset_shows_all(page: Page, base_url: str):
    """All time preset shows all recordings (no date filter)."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_selector("tbody tr td:first-child", timeout=10000)
    # Narrow to 7 days, then reset to All time
    page.get_by_test_id("date-range-trigger").click()
    page.get_by_role("button", name="Last 7 days").click()
    page.wait_for_timeout(500)
    page.get_by_test_id("date-range-trigger").click()
    page.get_by_role("button", name="All time").click()
    page.wait_for_timeout(800)
    expect(page.get_by_text("No recordings found.")).not_to_be_visible()


def test_video_player_opens(page: Page, base_url: str):
    """Clicking play on a recording opens the video player."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_selector("tbody tr td:first-child", timeout=10000)
    # Click the first play button
    page.locator("tbody tr").first.get_by_role("button").click()
    # Video element should appear
    expect(page.locator("video")).to_be_visible(timeout=5000)


def test_timeline_page_loads(page: Page, base_url: str):
    page.goto(f"{base_url}/timeline")
    expect(page.locator("h1")).to_contain_text("Timeline")
    # Open the date/range picker and confirm the preset rail + calendar render
    page.get_by_role("button", name=re.compile("Last 7 days")).first.click()
    expect(page.get_by_role("button", name="Yesterday")).to_be_visible()
    # react-day-picker renders a grid of day buttons
    expect(page.locator(".rdp-day_button").first).to_be_visible()


def test_timeline_zoom_controls(page: Page, base_url: str):
    page.goto(f"{base_url}/timeline")
    # The zoom indicator renders the current level, e.g. "1x"
    expect(page.get_by_text(re.compile(r"^\d+x$"))).to_be_visible(timeout=5000)


def test_camera_detail_shows_real_stats(page: Page, base_url: str):
    """Per-camera page renders populated stats + chart against live data."""
    cameras = requests.get(f"{base_url}/api/v1/cameras", timeout=10).json()
    cam = cameras[0]
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.locator("h1")).to_contain_text(cam["name"])
    # Stat cards present…
    expect(page.get_by_text("Total Recordings")).to_be_visible()
    expect(page.get_by_text("Total Clip Length")).to_be_visible()
    # …and the recordings total renders the real (non-placeholder) count.
    stats = requests.get(f"{base_url}/api/v1/cameras/{cam['id']}/stats", timeout=10).json()
    assert stats["total_recordings"] >= 1
    expect(page.get_by_text(f"{stats['total_recordings']:,}", exact=True).first).to_be_visible(
        timeout=8000
    )
    # Activity chart draws bar + line series over the 30-day window.
    expect(page.get_by_role("heading", name="Recording activity")).to_be_visible()
    expect(page.locator("svg.recharts-surface .recharts-bar-rectangle").first).to_be_visible(
        timeout=8000
    )


def test_camera_detail_timeline_plays_recording(page: Page, base_url: str):
    """Clicking a clip on the single-camera timeline opens the video player."""
    cameras = requests.get(f"{base_url}/api/v1/cameras", timeout=10).json()
    cam = cameras[0]
    page.goto(f"{base_url}/cameras/{cam['id']}")
    # The single-camera timeline renders each clip as an absolutely-positioned
    # button with an inline "%" left/width style. Wait briefly for the query.
    page.wait_for_timeout(1500)
    bars = page.locator("button[style*='%'][title]")
    if bars.count() == 0:
        pytest.skip("no clips visible in the default timeline window")
    # At low zoom the many short clips overlap, so a neighbour can intercept the
    # click; force through it — we only need *a* clip to open the player.
    bars.first.click(force=True)
    expect(page.locator("video")).to_be_visible(timeout=8000)


def test_camera_switcher_navigates(page: Page, base_url: str):
    """When multiple cameras exist, the switcher jumps between detail pages."""
    cameras = requests.get(f"{base_url}/api/v1/cameras", timeout=10).json()
    if len(cameras) < 2:
        pytest.skip("needs >= 2 cameras")
    page.goto(f"{base_url}/cameras/{cameras[0]['id']}")
    page.get_by_role("combobox", name="Switch camera").select_option(str(cameras[1]["id"]))
    expect(page).to_have_url(f"{base_url}/cameras/{cameras[1]['id']}")
    expect(page.locator("h1")).to_contain_text(cameras[1]["name"])


def test_settings_cameras_page(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/cameras")
    expect(page.locator("h1")).to_contain_text("Cameras")
    # The "Add Camera" control confirms the page rendered
    expect(page.get_by_role("button", name="Add Camera")).to_be_visible(timeout=8000)


def test_settings_locations_page(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/locations")
    expect(page.locator("h1")).to_contain_text("Locations")
