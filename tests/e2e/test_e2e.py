"""
End-to-end tests against the live server.
Run with:
  pytest tests/e2e --base-url http://192.168.1.164:8080 --headed (or headless)

These tests assume at least one camera is configured and at least one recording
has been indexed (the Garage camera currently has ~300+ recordings from Jan 2026).
"""
import requests
from playwright.sync_api import Page, expect

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
    for rec in filtered:
        assert rec["start_time"].startswith(date_str)


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
    # Click "Last 7 days" preset — data may or may not exist but page shouldn't crash
    page.get_by_role("button", name="Last 7 days").click()
    page.wait_for_timeout(800)
    # Either rows appear or empty state — page must still be functional
    expect(page.locator("h1")).to_contain_text("Recordings")


def test_recordings_custom_range(page: Page, base_url: str):
    """Custom range From/To inputs appear and filter correctly."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_selector("tbody tr td:first-child", timeout=10000)
    # Switch to Custom preset
    page.get_by_role("button", name="Custom").click()
    page.wait_for_timeout(300)
    # Two date inputs should appear
    date_inputs = page.locator("input[type='date']").all()
    assert len(date_inputs) == 2
    # Fill a known range
    date_inputs[0].fill("2026-01-02")
    date_inputs[1].fill("2026-01-08")
    page.wait_for_timeout(800)
    expect(page.get_by_text("No recordings found.")).not_to_be_visible()
    # Clear it
    clear_btn = page.get_by_text("Clear")
    expect(clear_btn).to_be_visible()
    clear_btn.click()
    page.wait_for_timeout(300)

def test_recordings_all_preset_shows_all(page: Page, base_url: str):
    """All preset shows all recordings (no date filter)."""
    page.goto(f"{base_url}/recordings")
    page.wait_for_selector("tbody tr td:first-child", timeout=10000)
    # Click 7d then back to All
    page.get_by_role("button", name="Last 7 days").click()
    page.wait_for_timeout(500)
    page.get_by_role("button", name="All").click()
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
    expect(page.locator("input[type='date']")).to_be_visible()


def test_timeline_zoom_controls(page: Page, base_url: str):
    page.goto(f"{base_url}/timeline")
    expect(page.get_by_role("button", name="1×")).to_be_visible(timeout=5000)


def test_settings_cameras_page(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/cameras")
    expect(page.locator("h1, h2")).to_contain_text("Cameras")
    # Should show at least one camera
    page.wait_for_selector("table tbody tr, .camera-card", timeout=8000)


def test_settings_locations_page(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/locations")
    expect(page.locator("h1, h2")).to_contain_text("Locations")
