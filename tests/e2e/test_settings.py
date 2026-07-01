"""E2E tests for camera and location settings."""
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
    # Delete
    page.locator("button[aria-label='delete'], button:has(svg)").last.click()
    expect(page.get_by_text("Delete Me")).not_to_be_visible()


def test_can_add_camera(page: Page, base_url: str):
    # Add location first
    page.goto(f"{base_url}/settings/locations")
    page.get_by_placeholder("Name (e.g. Front Door)").fill("Main Entrance")
    page.get_by_role("button", name="Add").click()

    # Now add camera
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name="Add Camera").click()
    page.get_by_placeholder("Name").fill("Entrance Cam")
    page.get_by_placeholder("/mnt/recordings/frontdoor").fill("/mnt/recordings/entrance")
    page.get_by_role("button", name="Save").click()
    expect(page.get_by_text("Entrance Cam")).to_be_visible()


def test_timeline_page_loads(page: Page, base_url: str):
    page.goto(f"{base_url}/timeline")
    expect(page.locator("h1")).to_contain_text("Timeline")
    # Date input should be present
    expect(page.locator("input[type='date']")).to_be_visible()


def test_recordings_page_loads(page: Page, base_url: str):
    page.goto(f"{base_url}/recordings")
    expect(page.locator("h1")).to_contain_text("Recordings")
