"""E2E tests for the per-camera pages (Cameras list + Camera detail).

Runs in CI against an empty-DB container: seeds a camera via the API, then drives
the UI. Covers the sidebar entry, the browse list, and every section of the
per-camera detail page (stat cards, activity chart, timeline, live-feed
placeholder, and the commands panel).
"""

import re

import requests
from playwright.sync_api import Page, expect


def _seed_camera(base_url: str, name: str = "E2E Detail Cam") -> dict:
    """Create a camera via the API and return its serialized dict."""
    r = requests.post(
        f"{base_url}/api/v1/cameras",
        json={"name": name, "recording_path": "/tmp/recordings/e2e"},
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def test_cameras_list_page_loads(page: Page, base_url: str):
    page.goto(f"{base_url}/cameras")
    expect(page.locator("h1")).to_contain_text("Cameras")


def test_cameras_list_shows_seeded_camera(page: Page, base_url: str):
    _seed_camera(base_url, name="E2E List Cam")
    page.goto(f"{base_url}/cameras")
    expect(page.get_by_text("E2E List Cam").first).to_be_visible()


def test_cameras_list_navigates_to_detail(page: Page, base_url: str):
    _seed_camera(base_url, name="E2E Nav Cam")
    page.goto(f"{base_url}/cameras")
    page.get_by_role("link", name=re.compile(re.escape("E2E Nav Cam"))).first.click()
    expect(page).to_have_url(re.compile(rf"{re.escape(base_url)}/cameras/\d+"))
    expect(page.locator("h1")).to_contain_text("E2E Nav Cam")


def test_camera_detail_header(page: Page, base_url: str):
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.locator("h1")).to_contain_text(cam["name"])
    # Back link to the browse list.
    expect(page.locator('a[href="/cameras"]').first).to_be_visible()


def test_camera_detail_stat_cards(page: Page, base_url: str):
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_text("Total Recordings")).to_be_visible()
    expect(page.get_by_text("Total Clip Length")).to_be_visible()
    expect(page.get_by_text("Last Video")).to_be_visible()
    expect(page.get_by_text("Indexed Size")).to_be_visible()


def test_camera_detail_activity_chart(page: Page, base_url: str):
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("heading", name="Recording activity")).to_be_visible()
    # Recharts renders an <svg> surface for the chart.
    expect(page.locator("svg.recharts-surface").first).to_be_visible(timeout=8000)


def test_camera_detail_timeline_section(page: Page, base_url: str):
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("heading", name="Timeline")).to_be_visible()
    # Date/range preset trigger (defaults to Last 7 days) + zoom indicator.
    expect(page.get_by_role("button", name=re.compile("Last 7 days")).first).to_be_visible()
    expect(page.get_by_text(re.compile(r"^\d+x$"))).to_be_visible()


def test_camera_detail_live_feed_placeholder(page: Page, base_url: str):
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("heading", name="Live Feed")).to_be_visible()
    expect(page.get_by_text("Live camera feed coming soon")).to_be_visible()


def test_camera_detail_commands_panel(page: Page, base_url: str):
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("heading", name="Commands")).to_be_visible()
    # Wired commands are enabled; future commands are disabled placeholders.
    expect(page.get_by_role("button", name="Reindex")).to_be_enabled()
    expect(page.get_by_role("button", name="Drop Index")).to_be_enabled()
    expect(page.get_by_role("button", name="Download Clips")).to_be_disabled()
    expect(page.get_by_role("button", name="Purge Old Clips")).to_be_disabled()


def test_camera_detail_drop_index_command(page: Page, base_url: str):
    """The Drop Index command runs against the backend and clears the index."""
    cam = _seed_camera(base_url, name="E2E Drop Cam")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    # Auto-accept the confirm() dialog, then trigger the command.
    page.on("dialog", lambda d: d.accept())
    # Wait for the DELETE to complete so the stats fetch below isn't racing it.
    with page.expect_response(
        lambda r: (
            r.request.method == "DELETE" and r.url.endswith(f"/cameras/{cam['id']}/recordings")
        )
    ) as resp_info:
        page.get_by_role("button", name="Drop Index").click()
    assert resp_info.value.ok
    # Endpoint returns a deleted count; UI stays on the page and refreshes stats.
    resp = requests.get(f"{base_url}/api/v1/cameras/{cam['id']}/stats", timeout=10)
    assert resp.status_code == 200
    assert resp.json()["total_recordings"] == 0


def test_camera_detail_scan_button(page: Page, base_url: str):
    """The top-of-page Scan button triggers a per-camera scan (POST /scan)."""
    cam = _seed_camera(base_url, name="E2E Scan Cam")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    scan_btn = page.get_by_title("Scan this camera's recording path for new files")
    expect(scan_btn).to_be_visible()
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith(f"/cameras/{cam['id']}/scan")
    ) as resp_info:
        scan_btn.click()
    assert resp_info.value.status == 202


def test_camera_detail_not_found(page: Page, base_url: str):
    page.goto(f"{base_url}/cameras/999999")
    expect(page.get_by_text("Camera not found.")).to_be_visible(timeout=8000)
