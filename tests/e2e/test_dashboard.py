"""E2E tests for the Dashboard page."""

import re

import requests
from playwright.sync_api import Page, expect


def test_dashboard_loads(page: Page, base_url: str):
    page.goto(base_url)
    expect(page).to_have_title("Home Timeline")
    expect(page.locator("h1")).to_contain_text("Dashboard")


def test_dashboard_shows_stat_cards(page: Page, base_url: str):
    page.goto(base_url)
    # Use <p> locator to avoid strict-mode conflict with the table <th> that also contains "Indexed Size"
    expect(page.locator("p", has_text="Total Recordings")).to_be_visible()
    expect(page.locator("p", has_text="Indexed Size")).to_be_visible()
    expect(page.locator("p", has_text="Total Clip Length")).to_be_visible()


def test_dashboard_scan_disk_button(page: Page, base_url: str):
    page.goto(base_url)
    btn = page.get_by_role("button", name="Scan Disk")
    expect(btn).to_be_visible()
    btn.click()
    # Button should briefly show scanning state
    page.wait_for_timeout(500)


def test_dashboard_bulk_buttons_present(page: Page, base_url: str):
    """The bulk Download/Purge Videos buttons render on the dashboard header."""
    page.goto(base_url)
    expect(page.get_by_role("button", name="Download Videos")).to_be_visible()
    expect(page.get_by_role("button", name="Purge Videos")).to_be_visible()


def test_dashboard_bulk_download_enabled_and_triggers_with_hikvision(page: Page, base_url: str):
    """Seeding a Hikvision camera makes the bulk Download action available; clicking
    it POSTs the bulk endpoint. The camera is removed afterward so the shared test
    volume isn't left in a state that affects later runs."""
    r = requests.post(
        f"{base_url}/api/v1/cameras",
        json={
            "name": "E2E Dash Bulk Hik",
            "recording_path": "/tmp/recordings/e2e-dash-hik",
            "camera_type": "hikvision",
            "host": "192.0.2.20",
            "username": "admin",
            "password": "secret",
        },
        timeout=10,
    )
    r.raise_for_status()
    cam_id = r.json()["id"]
    try:
        page.goto(base_url)
        btn = page.get_by_role("button", name=re.compile("Download Videos"))
        expect(btn).to_be_enabled()
        with page.expect_response(
            lambda r: r.request.method == "POST" and r.url.endswith("/cameras/download-all")
        ) as resp_info:
            btn.click()
        assert resp_info.value.status == 202
    finally:
        requests.delete(f"{base_url}/api/v1/cameras/{cam_id}", timeout=10)


def test_navigation_sidebar(page: Page, base_url: str):
    page.goto(base_url)
    # Click Timeline link
    page.get_by_role("link", name="Timeline").click()
    expect(page).to_have_url(f"{base_url}/timeline")
    expect(page.locator("h1")).to_contain_text("Timeline")


def test_navigation_to_settings(page: Page, base_url: str):
    page.goto(base_url)
    # Two nav links are named "Cameras" (top-level browse + Settings); target the
    # Settings one by href to avoid a strict-mode ambiguity.
    page.locator('a[href="/settings/cameras"]').click()
    expect(page).to_have_url(f"{base_url}/settings/cameras")


def test_navigation_to_cameras(page: Page, base_url: str):
    page.goto(base_url)
    # Top-level "Cameras" browse page (distinct from Settings › Cameras).
    page.locator('a[href="/cameras"]').click()
    expect(page).to_have_url(f"{base_url}/cameras")
    expect(page.locator("h1")).to_contain_text("Cameras")
