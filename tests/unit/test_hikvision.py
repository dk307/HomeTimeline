"""Unit tests for the ported Hikvision ISAPI client (no real network)."""

from datetime import UTC, datetime
from unittest.mock import patch

import aiohttp
import pytest

from app.services import hikvision
from app.services.hikvision import HikvisionClient

SEARCH_XML = """<?xml version="1.0"?>
<CMSearchResult xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <matchList>
    <searchMatchItem>
      <trackID>101</trackID>
      <timeSpan>
        <startTime>2024-01-15T10:00:00Z</startTime>
        <endTime>2024-01-15T10:05:00Z</endTime>
      </timeSpan>
      <mediaSegmentDescriptor>
        <playbackURI>rtsp://cam/Streaming/tracks/101?name=clipA&amp;size=10</playbackURI>
      </mediaSegmentDescriptor>
    </searchMatchItem>
  </matchList>
</CMSearchResult>"""

DEVICE_XML = """<?xml version="1.0"?>
<DeviceInfo xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <deviceName>Front Door</deviceName>
  <model>DS-2CD2085</model>
  <firmwareVersion>V5.7.3</firmwareVersion>
  <deviceLocation>hangzhou</deviceLocation>
  <hardwareVersion>0x0</hardwareVersion>
  <bootVersion>V1.3.4</bootVersion>
  <supportBeep>false</supportBeep>
</DeviceInfo>"""


class _FakeResp:
    def __init__(self, text="", chunks=None):
        self._text = text
        self._chunks = list(chunks or [])
        self.content = self

    def raise_for_status(self):
        pass

    def release(self):
        pass

    async def text(self):
        return self._text

    async def read(self, _n):
        return self._chunks.pop(0) if self._chunks else b""


class _FakeSession:
    """Returns the same response for every verb; records nothing."""

    def __init__(self, resp):
        self._resp = resp
        self.closed = False

    async def post(self, *a, **k):
        return self._resp

    async def get(self, *a, **k):
        return self._resp

    async def request(self, *a, **k):
        return self._resp

    async def put(self, *a, **k):
        return self._resp


# --------------------------------------------------------------- pure helpers


def test_device_stream_urls_adds_scheme():
    urls = hikvision.device_stream_urls("192.168.1.10")
    assert urls["rtsp_url"] == "rtsp://192.168.1.10:554/Streaming/Channels/101"
    assert urls["snapshot_url"].endswith("/ISAPI/Streaming/channels/101/picture")


def test_device_stream_urls_keeps_explicit_scheme():
    urls = hikvision.device_stream_urls("http://cam.local:8000")
    assert urls["rtsp_url"].startswith("rtsp://cam.local:554/")


def test_build_clip_name_from_playback_uri():
    rec = {"playback_uri": "rtsp://cam/tracks/101?name=clipZ&size=5"}
    assert hikvision.build_clip_name_from_recording(rec) == "clipZ"


def test_build_clip_name_missing_is_empty():
    assert hikvision.build_clip_name_from_recording({"playback_uri": "rtsp://cam/tracks"}) == ""


def test_set_file_times_sets_mtime_to_end(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"x")
    start = datetime(2024, 1, 15, 10, 0, tzinfo=UTC)
    end = datetime(2024, 1, 15, 10, 5, tzinfo=UTC)
    hikvision.set_file_times(f, start, end)
    assert abs(f.stat().st_mtime - end.timestamp()) < 2


def test_create_url_and_uri():
    client = HikvisionClient("192.168.1.10", "u", "p")
    assert client._create_uri("/ISAPI/System/deviceInfo").startswith("http://192.168.1.10")


def test_client_handles_none_credentials():
    # Camera.username / Camera.password may be None — construction must not raise.
    client = HikvisionClient("192.168.1.10", None, None)
    # None credentials are coerced to empty strings and encoded as an empty Basic header.
    assert client.auth_header == aiohttp.encode_basic_auth("", "")


def test_parse_recordings_extracts_fields():
    client = HikvisionClient("h", "u", "p")
    recs = client._parse_recordings(SEARCH_XML)
    assert len(recs) == 1
    r = recs[0]
    assert r["track_id"] == 101
    assert r["playback_uri"].endswith("name=clipA&size=10")
    assert r["start_time"].year == 2024 and r["end_time"].minute == 5


def test_build_download_xml_contains_uri():
    client = HikvisionClient("h", "u", "p")
    xml = client._build_download_xml("rtsp://cam?name=x")
    assert "<downloadRequest>" in xml and "rtsp://cam?name=x" in xml


# --------------------------------------------------------------- async methods


@pytest.mark.asyncio
async def test_search_all_recordings_pages_once():
    client = HikvisionClient("h", "u", "p")
    client.session = _FakeSession(_FakeResp(text=SEARCH_XML))
    recs = await client.search_all_recordings(batch_size=40)
    # One item (< batch_size) → single page, loop terminates.
    assert len(recs) == 1
    assert recs[0]["track_id"] == 101


@pytest.mark.asyncio
async def test_get_device_info_parses_tags():
    client = HikvisionClient("h", "u", "p")
    client.session = _FakeSession(_FakeResp(text=DEVICE_XML))
    info = await client.get_device_info()
    assert info["model"] == "DS-2CD2085"
    assert info["firmwareVersion"] == "V5.7.3"
    assert info["deviceName"] == "Front Door"
    # Noisy tags are filtered out of the details shown in the UI.
    for hidden in ("deviceLocation", "hardwareVersion", "bootVersion", "supportBeep"):
        assert hidden not in info


@pytest.mark.asyncio
async def test_download_clip_streams_and_renames(tmp_path):
    client = HikvisionClient("h", "u", "p")
    client.session = _FakeSession(_FakeResp(chunks=[b"abc", b"def"]))
    dest = tmp_path / "2024-01-15" / "clipA.mp4"
    result = await client.download_clip("rtsp://cam?name=clipA", dest)
    assert result == dest
    assert dest.read_bytes() == b"abcdef"
    assert not dest.with_suffix(".tmp").exists()


@pytest.mark.asyncio
async def test_set_manual_recording_calls_put():
    client = HikvisionClient("h", "u", "p")
    client.session = _FakeSession(_FakeResp())
    await client.set_manual_recording("start")  # should not raise


@pytest.mark.asyncio
async def test_download_clip_replaces_existing(tmp_path):
    """Downloading over an existing .mp4 replaces it (via the .old intermediate)."""
    client = HikvisionClient("h", "u", "p")
    dest = tmp_path / "day" / "clip.mp4"
    dest.parent.mkdir(parents=True)
    dest.write_bytes(b"OLD")
    client.session = _FakeSession(_FakeResp(chunks=[b"NEW"]))
    result = await client.download_clip("rtsp://cam?name=clip", dest)
    assert result == dest
    assert dest.read_bytes() == b"NEW"
    assert not dest.with_suffix(".old").exists()


class _SeqSession:
    """Returns queued responses in order (for multi-page search)."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.closed = False

    async def post(self, *a, **k):
        return self._responses.pop(0)


@pytest.mark.asyncio
async def test_search_all_recordings_multiple_pages():
    empty = """<CMSearchResult xmlns="x"><matchList></matchList></CMSearchResult>"""
    client = HikvisionClient("h", "u", "p")
    # Page 1 returns a full batch (1 == batch_size) → keep paging; page 2 empty → stop.
    client.session = _SeqSession([_FakeResp(text=SEARCH_XML), _FakeResp(text=empty)])
    recs = await client.search_all_recordings(batch_size=1)
    assert len(recs) == 1


@pytest.mark.asyncio
async def test_download_clip_stops_midstream(tmp_path):
    from app.services.hikvision import DownloadStopped

    client = HikvisionClient("h", "u", "p")
    client.session = _FakeSession(_FakeResp(chunks=[b"abc", b"def"]))
    dest = tmp_path / "day" / "clip.mp4"
    with pytest.raises(DownloadStopped):
        await client.download_clip("rtsp://cam?name=clip", dest, should_stop=lambda: True)
    # Neither the final file nor the temp file are left behind.
    assert not dest.exists()
    assert not dest.with_suffix(".tmp").exists()


# --------------------------------------------------------------- set_mp4_metadata


def test_set_mp4_metadata_invokes_ffmpeg(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"dummy-video")
    start = datetime(2024, 6, 15, 14, 30, 0, tzinfo=UTC)

    with patch("app.services.hikvision.subprocess.run") as mock_run:
        hikvision.set_mp4_metadata(f, start, track_id=101, camera_name="Front", clip_name="clipA")

    mock_run.assert_called_once()
    args, kwargs = mock_run.call_args
    cmd = args[0]
    assert cmd[0] == "ffmpeg"
    assert "-i" in cmd and str(f) in cmd
    assert "-c" in cmd and "copy" in cmd
    assert "-f" in cmd and "mp4" in cmd
    assert any("creation_time=2024-06-15T14:30:00.000Z" in a for a in cmd)
    assert any("title=clipA" in a for a in cmd)
    assert any("artist=Front" in a for a in cmd)
    assert any("description=Track 101" in a for a in cmd)
    assert any("Downloaded via Hikvision ISAPI" in a for a in cmd)
    assert any("encoder=Hikvision ISAPI download" in a for a in cmd)
    assert kwargs.get("check") is True
    assert kwargs.get("timeout") == 60


def test_set_mp4_metadata_replaces_file_on_success(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"original-content")
    start = datetime(2024, 6, 15, 14, 30, 0, tzinfo=UTC)

    def _fake_run(cmd, **_kw):
        meta_tmp = f.with_suffix(".meta_tmp.mp4")
        meta_tmp.write_bytes(b"metadata-enhanced-content")

    with patch("app.services.hikvision.subprocess.run", side_effect=_fake_run):
        hikvision.set_mp4_metadata(f, start, track_id=101, camera_name="Front", clip_name="clipA")

    assert f.read_bytes() == b"metadata-enhanced-content"
    assert not f.with_suffix(".meta_tmp.mp4").exists()


def test_set_mp4_metadata_ffmpeg_called_process_error_logs_stderr(tmp_path, caplog):
    """A CalledProcessError from ffmpeg logs stderr and stdout in the warning."""
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"original-content")
    start = datetime(2024, 6, 15, 14, 30, 0, tzinfo=UTC)
    from subprocess import CalledProcessError

    err = CalledProcessError(1, ["ffmpeg"])
    err.stderr = b"invalid input"
    err.stdout = b""

    with patch("app.services.hikvision.subprocess.run", side_effect=err):
        hikvision.set_mp4_metadata(f, start, track_id=101, camera_name="Front", clip_name="clipA")

    assert f.read_bytes() == b"original-content"
    messages = " ".join(caplog.messages)
    assert "Failed to set MP4 metadata" in messages
    assert "invalid input" in messages


def test_set_mp4_metadata_other_exception_logs_warning(tmp_path, caplog):
    """Non-ffmpeg exceptions (e.g. OSError) are logged generically."""
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"original-content")
    start = datetime(2024, 6, 15, 14, 30, 0, tzinfo=UTC)

    with patch("app.services.hikvision.subprocess.run", side_effect=RuntimeError("disk full")):
        hikvision.set_mp4_metadata(f, start, track_id=101, camera_name="Front", clip_name="clipA")

    assert f.read_bytes() == b"original-content"
    assert any("Failed to set MP4 metadata" in msg for msg in caplog.messages)


def test_set_mp4_metadata_cleans_up_stale_temp(tmp_path):
    """A leftover .meta_tmp.mp4 from a prior crash is removed before ffmpeg runs."""
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"content")
    stale = f.with_suffix(".meta_tmp.mp4")
    stale.write_bytes(b"stale-data")
    start = datetime(2024, 6, 15, 14, 30, 0, tzinfo=UTC)

    def _fake_run(cmd, **_kw):
        assert not stale.exists()
        stale.write_bytes(b"new-output")

    with patch("app.services.hikvision.subprocess.run", side_effect=_fake_run):
        hikvision.set_mp4_metadata(f, start, track_id=101, camera_name="Front", clip_name="clipA")

    assert not stale.exists()


def test_set_mp4_metadata_special_chars_in_clip_name(tmp_path):
    f = tmp_path / "clip.mp4"
    f.write_bytes(b"content")
    start = datetime(2024, 6, 15, 14, 30, 0, tzinfo=UTC)

    with patch("app.services.hikvision.subprocess.run") as mock_run:
        hikvision.set_mp4_metadata(
            f, start, track_id=101, camera_name="Front Door", clip_name="clip with spaces & special"
        )

    cmd = mock_run.call_args[0][0]
    assert any("title=clip with spaces & special" in a for a in cmd)
    assert any("artist=Front Door" in a for a in cmd)

    cmd = mock_run.call_args[0][0]
    assert any("title=clip with spaces & special" in a for a in cmd)
    assert any("artist=Front Door" in a for a in cmd)
