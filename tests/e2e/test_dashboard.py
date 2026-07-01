"""E2E tests for the Dashboard page."""
from playwright.sync_api import Page, expect


def test_dashboard_loads(page: Page, base_url: str):
    page.goto(base_url)
    expect(page.locator("h1")).to_contain_text("Dashboard")


def test_dashboard_shows_stat_cards(page: Page, base_url: str):
    page.goto(base_url)
    # Four stat cards should be visible
    expect(page.get_by_text("Total Recordings")).to_be_visible()
    expect(page.get_by_text("Indexed Size")).to_be_visible()
    expect(page.get_by_text("Disk Used")).to_be_visible()
    expect(page.get_by_text("Active Cameras")).to_be_visible()


def test_dashboard_scan_now_button(page: Page, base_url: str):
    page.goto(base_url)
    btn = page.get_by_role("button", name="Scan Now")
    expect(btn).to_be_visible()
    btn.click()
    # Button should briefly show scanning state
    page.wait_for_timeout(500)


def test_navigation_sidebar(page: Page, base_url: str):
    page.goto(base_url)
    # Click Timeline link
    page.get_by_role("link", name="Timeline").click()
    expect(page).to_have_url(f"{base_url}/timeline")
    expect(page.locator("h1")).to_contain_text("Timeline")


def test_navigation_to_settings(page: Page, base_url: str):
    page.goto(base_url)
    page.get_by_role("link", name="Cameras").click()
    expect(page).to_have_url(f"{base_url}/settings/cameras")
