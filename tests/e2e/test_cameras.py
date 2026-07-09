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


def test_camera_detail_live_view_placeholder_generic(page: Page, base_url: str):
    """Generic cameras get a "Hikvision only" placeholder where live view would be."""
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("heading", name="Live View")).to_be_visible()
    expect(page.get_by_text("Live view is available for Hikvision cameras only.")).to_be_visible()


def test_camera_detail_tabs_switch_sections(page: Page, base_url: str):
    """The detail page is organized into Timeline / Details / Commands tabs."""
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    # Timeline is the default tab → its stat cards are visible.
    expect(page.get_by_role("tab", name="Timeline")).to_be_visible()
    expect(page.get_by_text("Total Recordings")).to_be_visible()
    # Commands live behind their tab — not rendered until selected.
    expect(page.get_by_role("heading", name="Commands")).to_have_count(0)
    page.get_by_role("tab", name="Commands").click()
    expect(page.get_by_role("heading", name="Commands")).to_be_visible()


def test_camera_detail_commands_panel(page: Page, base_url: str):
    cam = _seed_camera(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    page.get_by_role("tab", name="Commands").click()
    expect(page.get_by_role("heading", name="Commands")).to_be_visible()
    # Both wired commands are enabled. (Purging now lives in the header, not here.)
    expect(page.get_by_role("button", name="Reindex")).to_be_enabled()
    expect(page.get_by_role("button", name="Drop Index")).to_be_enabled()


def test_camera_detail_drop_index_command(page: Page, base_url: str):
    """The Drop Index command runs against the backend and clears the index."""
    cam = _seed_camera(base_url, name="E2E Drop Cam")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    page.get_by_role("tab", name="Commands").click()
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


# --------------------------------------------------------------- Hikvision


def _seed_hikvision(base_url: str, name: str = "E2E Hik Cam") -> dict:
    """Create a Hikvision camera (host is TEST-NET, i.e. unreachable) via the API."""
    r = requests.post(
        f"{base_url}/api/v1/cameras",
        json={
            "name": name,
            "recording_path": "/tmp/recordings/e2e-hik",
            "camera_type": "hikvision",
            "host": "192.0.2.10",  # TEST-NET-1, guaranteed unroutable
            "username": "admin",
            "password": "secret",
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def test_hikvision_detail_shows_download_and_details(page: Page, base_url: str):
    cam = _seed_hikvision(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    # Hikvision-only header buttons + stat card (all in the default Timeline tab).
    expect(page.get_by_role("button", name=re.compile("Download Videos"))).to_be_visible()
    expect(page.get_by_role("button", name=re.compile("Purge Old Videos"))).to_be_visible()
    expect(page.get_by_text("Last Downloaded")).to_be_visible()
    # Device details live under the Details tab.
    page.get_by_role("tab", name="Details").click()
    expect(page.get_by_role("heading", name="Camera Details")).to_be_visible()


def test_hikvision_live_view_section(page: Page, base_url: str):
    """Hikvision cameras render a real Live View section (not the generic placeholder)."""
    cam = _seed_hikvision(base_url, name="E2E Hik Live")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("heading", name="Live View")).to_be_visible()
    # The generic "Hikvision only" placeholder must NOT appear here.
    expect(page.get_by_text("Live view is available for Hikvision cameras only.")).to_have_count(0)
    # Either the player mounts (go2rtc up) or a graceful status message shows —
    # the seeded host is unroutable, so we only assert the section is functional.
    expect(
        page.locator("video")
        .or_(page.get_by_text(re.compile("Connecting|unavailable|not running", re.I)))
        .first
    ).to_be_visible(timeout=8000)


def test_hikvision_download_button_triggers_request(page: Page, base_url: str):
    cam = _seed_hikvision(base_url, name="E2E Hik Download")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    btn = page.get_by_role("button", name=re.compile("Download Videos"))
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith(f"/cameras/{cam['id']}/download")
    ) as resp_info:
        btn.click()
    assert resp_info.value.status == 202


def test_hikvision_purge_button_disabled_without_retention(page: Page, base_url: str):
    """With no retention age configured there's nothing to purge — button disabled."""
    cam = _seed_hikvision(base_url, name="E2E Hik Purge Off")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("button", name=re.compile("Purge Old Videos"))).to_be_disabled()


def test_hikvision_purge_button_triggers_request(page: Page, base_url: str):
    """With a retention age set, the header purge button POSTs /purge."""
    cam = _seed_hikvision(base_url, name="E2E Hik Purge")
    # Configure a retention window so the button becomes enabled.
    requests.patch(
        f"{base_url}/api/v1/cameras/{cam['id']}",
        json={"purge_older_than_days": 30},
        timeout=10,
    ).raise_for_status()
    page.goto(f"{base_url}/cameras/{cam['id']}")
    page.on("dialog", lambda d: d.accept())  # confirm() the destructive action
    btn = page.get_by_role("button", name=re.compile("Purge Old Videos"))
    expect(btn).to_be_enabled()
    with page.expect_response(
        lambda r: r.request.method == "POST" and r.url.endswith(f"/cameras/{cam['id']}/purge")
    ) as resp_info:
        btn.click()
    assert resp_info.value.status == 202


def test_settings_camera_form_reveals_hikvision_fields(page: Page, base_url: str):
    """The Add Camera form renames Time Source and reveals Hikvision fields on type."""
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name=re.compile("Add Camera")).click()
    # Renamed clip-storage-strategy field is present.
    expect(page.get_by_text("Clip Storage Strategy")).to_be_visible()
    # Generic by default → no Host field yet.
    expect(page.get_by_text("Host")).to_have_count(0)
    # Switch Type → Hikvision via the first combobox (Type is first in the form).
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name=re.compile("Hikvision")).click()
    # Match the form labels exactly — list rows below also contain "Download videos: …".
    expect(page.get_by_text("Host", exact=True)).to_be_visible()
    expect(page.get_by_text("Download videos", exact=True)).to_be_visible()


# --------------------------------------------------------------- Aqura


def _seed_aqura(base_url: str, name: str = "E2E Aqura Cam") -> dict:
    r = requests.post(
        f"{base_url}/api/v1/cameras",
        json={
            "name": name,
            "recording_path": "/tmp/recordings/e2e-aqura",
            "camera_type": "aqura",
            "stream_url_1": "rtsp://10.0.0.1:554/1",
            "stream_url_2": "rtsp://10.0.0.1:554/2",
            "stream_url_3": "rtsp://10.0.0.1:554/3",
            "aqura_username": "admin",
            "aqura_password": "secret",
        },
        timeout=10,
    )
    r.raise_for_status()
    return r.json()


def test_aqura_detail_shows_live_view(page: Page, base_url: str):
    cam = _seed_aqura(base_url)
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("heading", name="Live View")).to_be_visible()
    # The generic placeholder must NOT appear.
    expect(
        page.get_by_text("Live view is available for Hikvision cameras only.")
    ).to_have_count(0)


def test_aqura_detail_shows_stream_buttons(page: Page, base_url: str):
    cam = _seed_aqura(base_url, name="E2E Aqura Streams")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("button", name=re.compile("Channel1"))).to_be_visible()
    expect(page.get_by_role("button", name=re.compile("Channel2"))).to_be_visible()
    expect(page.get_by_role("button", name=re.compile("Channel3"))).to_be_visible()


def test_aqura_detail_hides_download_purge(page: Page, base_url: str):
    cam = _seed_aqura(base_url, name="E2E Aqura NoDL")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    expect(page.get_by_role("button", name=re.compile("Download Videos"))).to_have_count(0)
    expect(page.get_by_role("button", name=re.compile("Purge Old Videos"))).to_have_count(0)


def test_aqura_detail_shows_stream_urls_in_details(page: Page, base_url: str):
    cam = _seed_aqura(base_url, name="E2E Aqura Details")
    page.goto(f"{base_url}/cameras/{cam['id']}")
    page.get_by_role("tab", name="Details").click()
    expect(page.get_by_role("heading", name="Aqura Camera")).to_be_visible()
    expect(page.get_by_text("rtsp://10.0.0.1:554/1")).to_be_visible()
    expect(page.get_by_text("rtsp://10.0.0.1:554/2")).to_be_visible()
    expect(page.get_by_text("rtsp://10.0.0.1:554/3")).to_be_visible()


def test_settings_camera_form_reveals_aqura_fields(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name=re.compile("Add Camera")).click()
    # Generic by default → no stream URL fields yet.
    expect(page.get_by_placeholder(re.compile("rtsp://"))).to_have_count(0)
    # Switch Type → Aqura.
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name=re.compile("Aqura")).click()
    # Stream URL inputs appear + RTSP username.
    expect(page.get_by_placeholder(re.compile("rtsp://"))).to_have_count(3)
    expect(page.get_by_text("RTSP Username", exact=True)).to_be_visible()


def test_settings_camera_form_hides_hikvision_fields_for_aqura(page: Page, base_url: str):
    page.goto(f"{base_url}/settings/cameras")
    page.get_by_role("button", name=re.compile("Add Camera")).click()
    page.get_by_role("combobox").first.click()
    page.get_by_role("option", name=re.compile("Aqura")).click()
    # Hikvision-only fields should NOT be visible.
    expect(page.get_by_text("Host", exact=True)).to_have_count(0)
    expect(page.get_by_text("Download videos", exact=True)).to_have_count(0)
