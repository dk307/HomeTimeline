"""E2E tests for camera and location settings."""

import re

import pytest
from playwright.sync_api import Page, expect


def test_can_add_location(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/locations")
    page.get_by_placeholder("Name (e.g. Front Door)").fill("Test Location")
    page.get_by_role("button", name="Add").click()
    expect(page.get_by_text("Test Location")).to_be_visible()


def test_can_delete_location(page: Page, base_url: str):
    # Create first
    page.goto(f"{base_url}/settings/locations")
    page.get_by_placeholder("Name (e.g. Front Door)").fill("Delete Me")
    page.get_by_role("button", name="Add").click()
    expect(page.get_by_text("Delete Me")).to_be_visible()
    # Delete — click the Trash button next to "Delete Me"
    page.locator("p", has_text="Delete Me").locator("../..").get_by_role("button").last.click()
    expect(page.get_by_text("Delete Me")).not_to_be_visible()


def test_can_add_camera(page: Page, base_url: str):
    # Add location first
    page.goto(f"{base_url}/settings/locations")
    page.get_by_placeholder("Name (e.g. Front Door)").fill("Main Entrance")
    page.get_by_role("button", name="Add").click()

    # Now add camera
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name="Add Camera").click()
    page.get_by_placeholder("e.g. Garage Cam").fill("Entrance Cam")
    page.get_by_placeholder("/nas/camera/Garage").fill("/mnt/recordings/entrance")
    page.get_by_role("button", name="Save").click()
    # Live DB may already contain a camera by this name from a prior run — assert
    # at least one is visible rather than requiring uniqueness.
    expect(page.get_by_text("Entrance Cam").first).to_be_visible()


def test_camera_form_scan_file_system_defaults_to_never(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name="Add Camera").click()
    # The per-camera "Scan file system" control defaults to Never (manual only).
    expect(page.get_by_text("Scan file system").first).to_be_visible()
    expect(page.get_by_text("Never — scan manually only")).to_be_visible()


def test_camera_form_scan_file_system_toggle_reveals_interval(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name="Add Camera").click()
    # Enabling auto-scan reveals the minutes interval input.
    page.locator("#scan-enabled").click()
    expect(page.get_by_text("minutes")).to_be_visible()
    expect(page.locator("#scan-enabled")).to_be_visible()


def test_can_add_camera_with_scan_interval(page: Page, base_url: str):
    """Create a camera with an auto-scan interval and confirm it persists."""
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name="Add Camera").click()
    page.get_by_placeholder("e.g. Garage Cam").fill("Scan Sched Cam")
    page.get_by_placeholder("/nas/camera/Garage").fill("/mnt/recordings/sched")
    # Turn on auto-scan and set the interval to 20 minutes.
    page.locator("#scan-enabled").click()
    scan_block = page.locator("div.col-span-2", has_text="Scan file system")
    scan_block.get_by_role("spinbutton").fill("20")
    page.get_by_role("button", name="Save").click()
    # The saved camera row summarizes its schedule.
    expect(page.get_by_text("Scan file system: every 20 min").first).to_be_visible()


def test_can_add_camera_defaults_scan_to_never(page: Page, base_url: str):
    """A camera saved without touching the toggle shows 'Never' in its row."""
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name="Add Camera").click()
    page.get_by_placeholder("e.g. Garage Cam").fill("Never Scan Cam")
    page.get_by_placeholder("/nas/camera/Garage").fill("/mnt/recordings/never")
    page.get_by_role("button", name="Save").click()
    expect(page.get_by_text("Scan file system: Never").first).to_be_visible()


def test_timeline_page_loads(page: Page, base_url: str):
    page.goto(f"{base_url}/timeline")
    expect(page.locator("h1")).to_contain_text("Timeline")
    # The date/range picker trigger shows the active preset (defaults to Last 7 days)
    expect(page.get_by_role("button", name=re.compile("Last 7 days")).first).to_be_visible()


def test_recordings_page_loads(page: Page, base_url: str):
    page.goto(f"{base_url}/recordings")
    expect(page.locator("h1")).to_contain_text("Recordings")


def test_general_settings_has_no_scan_frequency(page: Page, base_url: str):
    """Scan frequency moved to per-camera settings; General no longer shows it."""
    page.goto(f"{base_url}/settings/general")
    expect(page.locator("h1")).to_contain_text("General Settings")
    expect(page.get_by_text("Scan frequency (minutes)")).to_have_count(0)


def test_general_settings_shows_timezone(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/general")
    expect(page.locator("h1")).to_contain_text("General Settings")
    expect(page.get_by_label("Timezone")).to_be_visible()


def test_general_settings_can_update_timezone(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/general")
    # Timezone is now a searchable combobox (button + filterable list), not a <select>.
    page.get_by_label("Timezone").click()
    page.get_by_placeholder("Search timezones…").fill("Chicago")
    page.get_by_role("option", name="America/Chicago").click()
    page.get_by_role("button", name="Save").click()
    expect(page.get_by_text("Saved")).to_be_visible()


def _set_timezone(page: Page, base_url: str, search: str, option: str):
    """Set the app timezone through the General settings combobox and save."""
    page.goto(f"{base_url}/settings/general")
    page.get_by_label("Timezone").click()
    page.get_by_placeholder("Search timezones…").fill(search)
    page.get_by_role("option", name=option).click()
    page.get_by_role("button", name="Save").click()
    expect(page.get_by_text("Saved")).to_be_visible()


def _oldest_log_time(page: Page, base_url: str) -> str | None:
    """The rendered time of the oldest log row (fmtDt/useTimezone output).

    The Logs table lists newest-first, so the last row is the oldest (startup)
    entry — a fixed instant that stays put as new logs prepend, which lets us
    compare the *same* instant under two timezones. Returns None if the container
    has no log entries (so the test can skip rather than fail)."""
    page.goto(f"{base_url}/logs")
    page.wait_for_timeout(500)
    rows = page.locator("tbody tr")
    if rows.count() == 0:
        return None
    return rows.last.locator("td").first.inner_text().strip()


def test_timezone_change_reflows_rendered_timestamps(page: Page, base_url: str):
    """The configured timezone (useTimezone → fmtDt) must actually drive how
    absolute timestamps render: the same instant, viewed in two zones ~22h
    apart, must format differently."""
    try:
        _set_timezone(page, base_url, "Honolulu", "Pacific/Honolulu")  # UTC-10
        time_hst = _oldest_log_time(page, base_url)
        if not time_hst:
            pytest.skip("no log entries available to assert timezone rendering")

        _set_timezone(page, base_url, "Auckland", "Pacific/Auckland")  # UTC+12/+13
        time_nzt = _oldest_log_time(page, base_url)

        assert time_hst != time_nzt, (
            f"timestamp did not change with timezone: {time_hst!r} == {time_nzt!r}"
        )
    finally:
        # Always restore a neutral default so later tests aren't affected by
        # ordering — even when we skip (no logs) or the assertion fails.
        _set_timezone(page, base_url, "UTC", "UTC")
