"""Minimal async Hikvision ISAPI client (search / download / device info).

Ported from the user's pyscript. Uses raw ``aiohttp`` against the camera's ISAPI
endpoints — no third-party Hikvision library. All methods are async and expect the
client to be used as an async context manager so the session is opened/closed:

    async with HikvisionClient(host, user, password) as hk:
        recordings = await hk.search_all_recordings()
"""

import logging
import os
import subprocess
import xml.etree.ElementTree as ET
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import aiofiles
import aiohttp
from yarl import URL

logger = logging.getLogger(__name__)

class DownloadStopped(Exception):
    """Raised inside download_clip when a stop is requested mid-stream."""


# Noisy/low-value deviceInfo tags hidden from the camera-details UI.
_DEVICE_INFO_HIDE = frozenset(
    {
        "deviceLocation",
        "systemContact",
        "encoderVersion",
        "encoderReleasedDate",
        "bootVersion",
        "bootReleasedDate",
        "hardwareVersion",
        "deviceType",
        "telecontrolID",
        "supportBeep",
        "supportVideoLoss",
        "firmwareVersionInfo",
    }
)


class HikvisionClient:
    """Minimal async client for Hikvision ISAPI search/download over HTTP."""

    def __init__(self, host_name: str, user_name: str, password: str, *, timeout: int = 300):
        # Camera.username / Camera.password may be None; encode_basic_auth needs strings.
        # Pre-encode the Basic auth header rather than passing auth= to the session,
        # which aiohttp deprecates (removal in v4).
        self.base_url = self._create_url(host_name or "")
        self.auth_header = aiohttp.encode_basic_auth(user_name or "", password or "")
        self.timeout = aiohttp.ClientTimeout(total=timeout)
        self.session: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> HikvisionClient:
        self.session = aiohttp.ClientSession(
            headers={"Authorization": self.auth_header}, timeout=self.timeout
        )
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        if self.session and not self.session.closed:
            await self.session.close()

    async def search_all_recordings(self, batch_size: int = 40) -> list[dict]:
        """Retrieve all recordings, paging through results in ``batch_size`` chunks."""
        assert self.session is not None
        all_videos: list[dict] = []
        start_pos = 0
        search_id = os.urandom(16).hex()

        while True:
            batch = await self._search_batch(
                search_id=search_id, start_pos=start_pos, max_results=batch_size
            )
            if not batch:
                break
            all_videos.extend(batch)
            start_pos += batch_size
            if len(batch) < batch_size:
                break  # no more pages

        return all_videos

    async def _search_batch(self, search_id: str, start_pos: int, max_results: int) -> list[dict]:
        """Fetch a single page of search results."""
        root = ET.Element("CMSearchDescription")
        ET.SubElement(root, "searchID").text = search_id
        ET.SubElement(root, "maxResults").text = str(max_results)
        ET.SubElement(root, "searchResultPosition").text = str(start_pos)

        xml_body = ET.tostring(root, encoding="utf-8", method="xml")
        uri = self._create_uri("/ISAPI/ContentMgmt/search")
        headers = {"Content-Type": "application/xml", "Accept": "application/xml"}

        resp = await self.session.post(uri, data=xml_body, headers=headers)
        try:
            resp.raise_for_status()
            xml_data = await resp.text()
        finally:
            resp.release()

        return self._parse_recordings(xml_data)

    async def download_clip(self, playback_uri: str, dest_path: Path, should_stop=None) -> Path:
        """Download a recording via ``GET /ISAPI/ContentMgmt/download``.

        Streams to a ``.tmp`` file in 1 MiB chunks, then atomically renames to the
        destination, replacing any existing file via a ``.old`` intermediate.
        ``should_stop`` (optional callable) is polled between chunks; if it returns
        True the download aborts with ``DownloadStopped`` and the temp file is
        cleaned up.
        """
        assert self.session is not None

        url = self.base_url.with_path("/ISAPI/ContentMgmt/download")
        body = self._build_download_xml(playback_uri)
        headers = {"Content-Type": "application/xml", "Accept": "*/*"}

        temp_path = dest_path.with_suffix(".tmp")
        temp_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            resp = await self.session.request("GET", str(url), data=body, headers=headers)
            try:
                resp.raise_for_status()
                chunk_size = 1024 * 1024
                async with aiofiles.open(temp_path, "wb") as f:
                    while True:
                        if should_stop is not None and should_stop():
                            raise DownloadStopped()
                        chunk = await resp.content.read(chunk_size)
                        if not chunk:
                            break
                        await f.write(chunk)
            finally:
                resp.release()

            # Replace existing .mp4 if present.
            if dest_path.exists():
                old_path = dest_path.with_suffix(".old")
                try:
                    dest_path.rename(old_path)
                    try:
                        old_path.unlink()
                    except FileNotFoundError:
                        pass
                except FileNotFoundError:
                    pass

            temp_path.rename(dest_path)
            return dest_path
        finally:
            # Best-effort cleanup of the temp file on any failure.
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass

    async def get_device_info(self) -> dict[str, str]:
        """Fetch ``/ISAPI/System/deviceInfo`` and return a flat tag→text dict."""
        assert self.session is not None
        uri = self._create_uri("/ISAPI/System/deviceInfo")
        resp = await self.session.get(uri, headers={"Accept": "application/xml"})
        try:
            resp.raise_for_status()
            xml_data = await resp.text()
        finally:
            resp.release()

        tree = self._strip_ns(ET.fromstring(xml_data))
        info: dict[str, str] = {}
        for child in tree:
            if child.tag in _DEVICE_INFO_HIDE:
                continue
            if child.text and child.text.strip():
                info[child.tag] = child.text.strip()
        return info

    async def set_manual_recording(self, action: str, track_id: str = "101") -> None:
        """Control manual recording for a track (``action`` = ``start`` | ``stop``).

        Ported for completeness; not currently wired to an endpoint.
        """
        path = f"/ISAPI/ContentMgmt/record/control/manual/{action}/tracks/{track_id}"
        resp = await self.session.put(self._create_uri(path))
        try:
            resp.raise_for_status()
        finally:
            resp.release()

    def _build_download_xml(self, playback_uri: str) -> str:
        root = ET.Element("downloadRequest")
        ET.SubElement(root, "playbackURI").text = playback_uri
        return ET.tostring(root, encoding="utf-8", method="xml").decode("utf-8")

    def _create_uri(self, path: str) -> str:
        return str(self.base_url.with_path(path))

    @staticmethod
    def _create_url(host: str) -> URL:
        # If no scheme, default to http:// (Hikvision ISAPI on a LAN typically only
        # serves http). NOTE: with http, BasicAuth credentials and ISAPI/stream
        # traffic go in cleartext — provide an explicit https:// host to secure it.
        u = URL(host)
        if not u.scheme:
            u = URL(f"http://{host}")
        return u

    @staticmethod
    def _strip_ns(elem: ET.Element) -> ET.Element:
        for e in elem.iter():
            if "}" in e.tag:
                e.tag = e.tag.split("}", 1)[1]
        return elem

    def _parse_recordings(self, xml_data: str) -> list[dict]:
        videos: list[dict] = []
        tree = self._strip_ns(ET.fromstring(xml_data))

        for item in tree.findall(".//matchList/searchMatchItem"):
            track_id = item.findtext("trackID")
            start_time = item.findtext("timeSpan/startTime")
            end_time = item.findtext("timeSpan/endTime")
            playback_uri = item.findtext("mediaSegmentDescriptor/playbackURI")

            if track_id and start_time and end_time and playback_uri:
                videos.append(
                    {
                        "track_id": int(track_id),
                        "start_time": datetime.fromisoformat(start_time.replace("Z", "+00:00")),
                        "end_time": datetime.fromisoformat(end_time.replace("Z", "+00:00")),
                        "playback_uri": playback_uri,
                    }
                )
        return videos


def build_clip_name_from_recording(recording: Mapping[str, Any]) -> str:
    """Derive the clip filename from the ``?name=`` param of its playback_uri."""
    playback_uri = str(recording.get("playback_uri") or "")
    parsed = urlparse(playback_uri)
    params = parse_qs(parsed.query)
    return params.get("name", [""])[0].strip()


def set_file_times(path: Path, start_utc: datetime, end_utc: datetime) -> None:
    """Set atime=clip start, mtime=clip end (the scanner reads mtime as end time)."""
    atime = start_utc.astimezone(UTC).timestamp()
    mtime = end_utc.astimezone(UTC).timestamp()
    os.utime(path, (atime, mtime))


def set_mp4_metadata(
    path: Path,
    start_utc: datetime,
    track_id: int,
    camera_name: str,
    camera_host: str,
    clip_name: str,
) -> None:
    """Write embedded MP4 metadata tags via ffmpeg (stream copy, no re-encode).

    Sets ``creation_time`` (shown as "Media Created" on Windows), Apple QuickTime
    creation date, title, artist, description, comment, and encoder.  Best-effort:
    failures are logged but not raised.
    """
    start_iso = start_utc.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    tmp_path = path.with_suffix(".meta_tmp")

    try:
        subprocess.run(
            [
                "ffmpeg",
                "-i", str(path),
                "-c", "copy",
                "-metadata", f"creation_time={start_iso}",
                "-metadata", f"com.apple.quicktime.creationdate={start_iso}",
                "-metadata", f"title={clip_name}",
                "-metadata", f"artist={camera_name}",
                "-metadata", f"description=Track {track_id} · {camera_host}",
                "-metadata", "comment=Downloaded via Hikvision ISAPI",
                "-metadata", "encoder=Hikvision ISAPI download",
                "-y", str(tmp_path),
            ],
            check=True,
            capture_output=True,
        )
        tmp_path.replace(path)
    except Exception:
        logger.warning("Failed to set MP4 metadata for %s", path, exc_info=True)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass


def device_stream_urls(host: str) -> dict[str, str]:
    """Derive RTSP + snapshot URLs for the main stream of channel 1 from the host.

    The snapshot URL mirrors the client's http:// default for scheme-less hosts, so
    it is cleartext unless an explicit https:// host is configured.
    """
    u = URL(host)
    if not u.scheme:
        u = URL(f"http://{host}")
    hostname = u.host or host
    return {
        "rtsp_url": f"rtsp://{hostname}:554/Streaming/Channels/101",
        "snapshot_url": str(u.with_path("/ISAPI/Streaming/channels/101/picture")),
    }
