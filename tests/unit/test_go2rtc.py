"""Unit tests for the go2rtc live-streaming service (no real process/network)."""

import urllib.error
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services import go2rtc


@pytest.fixture(autouse=True)
def _reset_proc():
    """Keep the module-level process handle isolated between tests."""
    go2rtc._proc = None
    yield
    go2rtc._proc = None


def _cam(**kw):
    base = dict(id=7, host="192.168.1.10", username="admin", password="pw", camera_type="hikvision")
    base.update(kw)
    return SimpleNamespace(**base)


# ------------------------------------------------------------------- pure helpers


def test_stream_name():
    assert go2rtc.stream_name(7, "main") == "cam7_main"
    assert go2rtc.stream_name(7, "sub") == "cam7_sub"


def test_rtsp_url_main_and_sub():
    cam = _cam()
    assert go2rtc.rtsp_url(cam, "main") == "rtsp://admin:pw@192.168.1.10:554/Streaming/Channels/101"
    assert go2rtc.rtsp_url(cam, "sub") == "rtsp://admin:pw@192.168.1.10:554/Streaming/Channels/102"


def test_rtsp_url_strips_scheme_and_encodes_credentials():
    cam = _cam(host="http://cam.local", username="user@x", password="p@ss/word")
    url = go2rtc.rtsp_url(cam, "main")
    # scheme stripped to the bare host; credentials percent-encoded.
    assert url == "rtsp://user%40x:p%40ss%2Fword@cam.local:554/Streaming/Channels/101"


def test_rtsp_url_without_credentials_has_no_auth():
    cam = _cam(username=None, password=None)
    assert go2rtc.rtsp_url(cam, "main") == "rtsp://192.168.1.10:554/Streaming/Channels/101"


def test_binary_none_when_disabled():
    with patch.object(go2rtc.settings, "go2rtc_enabled", False):
        assert go2rtc._binary() is None


# ------------------------------------------------------------------- config file


def test_write_config_includes_candidate(tmp_path):
    with (
        patch.object(go2rtc.settings, "go2rtc_config_dir", str(tmp_path)),
        patch.object(go2rtc.settings, "go2rtc_webrtc_candidate", "1.2.3.4:8555"),
    ):
        text = go2rtc._write_config().read_text()
    assert 'listen: ":8555"' in text
    assert "candidates:" in text
    assert "1.2.3.4:8555" in text
    assert 'listen: "127.0.0.1:1984"' in text
    # RTSP relay must stay enabled (localhost) for the ffmpeg transcode fallback.
    assert 'listen: "127.0.0.1:8554"' in text


def test_write_config_omits_candidate_when_empty(tmp_path):
    with (
        patch.object(go2rtc.settings, "go2rtc_config_dir", str(tmp_path)),
        patch.object(go2rtc.settings, "go2rtc_webrtc_candidate", ""),
    ):
        text = go2rtc._write_config().read_text()
    assert "candidates:" not in text


# ------------------------------------------------------------------- process mgmt


def test_start_noop_when_binary_missing():
    with patch.object(go2rtc, "_binary", return_value=None):
        go2rtc.start()  # must not raise
        assert go2rtc.is_available() is False


def test_is_available_false_when_not_started():
    assert go2rtc.is_available() is False


def test_start_and_stop_manage_process(tmp_path):
    fake = MagicMock()
    fake.poll.return_value = None
    fake.pid = 1234
    with (
        patch.object(go2rtc.settings, "go2rtc_config_dir", str(tmp_path)),
        patch.object(go2rtc, "_binary", return_value="/usr/bin/go2rtc"),
        patch("subprocess.Popen", return_value=fake) as popen,
    ):
        go2rtc.start()
        assert go2rtc.is_available() is True
        popen.assert_called_once()
        # A second start is a no-op while the process is alive.
        go2rtc.start()
        popen.assert_called_once()
        go2rtc.stop()
    fake.terminate.assert_called_once()
    assert go2rtc.is_available() is False


def test_start_handles_spawn_error(tmp_path):
    with (
        patch.object(go2rtc.settings, "go2rtc_config_dir", str(tmp_path)),
        patch.object(go2rtc, "_binary", return_value="/usr/bin/go2rtc"),
        patch("subprocess.Popen", side_effect=OSError("nope")),
    ):
        go2rtc.start()  # must not raise
    assert go2rtc.is_available() is False


def test_stop_is_noop_when_not_running():
    go2rtc.stop()  # no process — must not raise
    assert go2rtc.is_available() is False


def test_stop_kills_process_that_ignores_terminate():
    import subprocess

    fake = MagicMock()
    fake.poll.return_value = None
    fake.wait.side_effect = subprocess.TimeoutExpired(cmd="go2rtc", timeout=5)
    go2rtc._proc = fake
    go2rtc.stop()
    fake.terminate.assert_called_once()
    fake.kill.assert_called_once()  # escalated after the wait timed out
    assert go2rtc.is_available() is False


# ------------------------------------------------------------- stream registration


def test_ensure_streams_none_when_unavailable():
    with patch.object(go2rtc, "is_available", return_value=False):
        assert go2rtc.ensure_camera_streams(_cam()) is None


def test_ensure_streams_none_without_host():
    with patch.object(go2rtc, "is_available", return_value=True):
        assert go2rtc.ensure_camera_streams(_cam(host="")) is None


def test_ensure_streams_registers_both_channels():
    calls: list[tuple[str, list[str]]] = []
    with (
        patch.object(go2rtc, "is_available", return_value=True),
        patch.object(go2rtc, "_put_stream", side_effect=lambda n, s: calls.append((n, s))),
    ):
        names = go2rtc.ensure_camera_streams(_cam())
    assert names == {"main": "cam7_main", "sub": "cam7_sub"}
    assert [n for n, _ in calls] == ["cam7_main", "cam7_sub"]
    # main: native RTSP (101) + an H.264 transcode fallback; sub: native RTSP (102) only.
    main_srcs = calls[0][1]
    assert main_srcs[0].endswith("/101")
    assert main_srcs[1] == "ffmpeg:cam7_main#video=h264"
    assert calls[1][1] == [go2rtc.rtsp_url(_cam(), "sub")]


def test_stream_sources_only_main_gets_transcode():
    cam = _cam()
    assert go2rtc._stream_sources(cam, "sub", "cam7_sub") == [go2rtc.rtsp_url(cam, "sub")]
    main = go2rtc._stream_sources(cam, "main", "cam7_main")
    assert len(main) == 2 and main[1] == "ffmpeg:cam7_main#video=h264"


def test_ensure_streams_skips_channel_on_register_error():
    def _put(name, srcs):
        if name.endswith("_sub"):
            raise urllib.error.URLError("boom")

    with (
        patch.object(go2rtc, "is_available", return_value=True),
        patch.object(go2rtc, "_put_stream", side_effect=_put),
    ):
        names = go2rtc.ensure_camera_streams(_cam())
    assert names == {"main": "cam7_main"}


def test_put_stream_calls_go2rtc_api_with_multiple_sources():
    with patch("urllib.request.urlopen") as uo:
        uo.return_value.__enter__.return_value = MagicMock()
        go2rtc._put_stream("cam1_main", ["rtsp://host/x", "ffmpeg:cam1_main#video=h264"])
    req = uo.call_args[0][0]
    assert req.get_method() == "PUT"
    assert "/api/streams?" in req.full_url and "cam1_main" in req.full_url
    # both producers are present as repeated src params
    assert req.full_url.count("src=") == 2
    assert "video%3Dh264" in req.full_url  # ffmpeg fragment url-encoded


def test_api_probe_true_on_valid_json():
    with patch("urllib.request.urlopen") as uo:
        cm = MagicMock()
        cm.read.return_value = b"{}"
        uo.return_value.__enter__.return_value = cm
        assert go2rtc.api_probe("cam1_main") is True


def test_api_probe_false_on_error():
    with patch("urllib.request.urlopen", side_effect=urllib.error.URLError("down")):
        assert go2rtc.api_probe("cam1_main") is False


# ------------------------------------------------------------- Aqura streams


def _aqura_cam(**kw):
    base = dict(
        id=8,
        camera_type="aqura",
        stream_url_1="rtsp://10.0.0.1:554/Streaming/Channels/101",
        stream_url_2="rtsp://10.0.0.1:554/Streaming/Channels/102",
        stream_url_3="rtsp://10.0.0.1:554/Streaming/Channels/103",
        aqura_username="admin",
        aqura_password="pw",
    )
    base.update(kw)
    return SimpleNamespace(**base)


def test_aqura_rtsp_url_returns_stored_url():
    cam = _aqura_cam()
    assert go2rtc.rtsp_url(cam, "1") == "rtsp://admin:pw@10.0.0.1:554/Streaming/Channels/101"
    assert go2rtc.rtsp_url(cam, "2") == "rtsp://admin:pw@10.0.0.1:554/Streaming/Channels/102"
    assert go2rtc.rtsp_url(cam, "3") == "rtsp://admin:pw@10.0.0.1:554/Streaming/Channels/103"


def test_aqura_rtsp_url_no_credentials():
    cam = _aqura_cam(aqura_username=None, aqura_password=None)
    assert go2rtc.rtsp_url(cam, "1") == "rtsp://10.0.0.1:554/Streaming/Channels/101"


def test_aqura_rtsp_url_empty_url():
    cam = _aqura_cam(stream_url_1="", stream_url_2=None)
    assert go2rtc.rtsp_url(cam, "1") == ""
    assert go2rtc.rtsp_url(cam, "2") == ""


def test_aqura_stream_sources_all_get_transcode():
    cam = _aqura_cam()
    for q in ("1", "2", "3"):
        name = f"cam{cam.id}_{q}"
        srcs = go2rtc._stream_sources(cam, q, name)
        assert len(srcs) == 2
        assert srcs[1] == f"ffmpeg:{name}#video=h264"


def test_aqura_ensure_camera_streams_registers_all_3():
    calls: list[tuple[str, list[str]]] = []
    with (
        patch.object(go2rtc, "is_available", return_value=True),
        patch.object(go2rtc, "_put_stream", side_effect=lambda n, s: calls.append((n, s))),
    ):
        names = go2rtc.ensure_camera_streams(_aqura_cam())
    assert names == {"1": "cam8_1", "2": "cam8_2", "3": "cam8_3"}
    assert [n for n, _ in calls] == ["cam8_1", "cam8_2", "cam8_3"]


def test_aqura_ensure_camera_streams_none_when_unavailable():
    with patch.object(go2rtc, "is_available", return_value=False):
        assert go2rtc.ensure_camera_streams(_aqura_cam()) is None


def test_aqura_ensure_camera_streams_none_without_urls():
    with patch.object(go2rtc, "is_available", return_value=True):
        assert (
            go2rtc.ensure_camera_streams(
                _aqura_cam(stream_url_1="", stream_url_2=None, stream_url_3=None)
            )
            is None
        )


def test_aqura_ensure_camera_streams_skips_channel_on_register_error():
    def _put(name, srcs):
        if name.endswith("_2"):
            raise urllib.error.URLError("boom")

    with (
        patch.object(go2rtc, "is_available", return_value=True),
        patch.object(go2rtc, "_put_stream", side_effect=_put),
    ):
        names = go2rtc.ensure_camera_streams(_aqura_cam())
    assert names == {"1": "cam8_1", "3": "cam8_3"}


def test_aqura_ensure_camera_streams_partially_configured():
    """Only channels with a configured URL are registered."""
    cam = _aqura_cam(stream_url_1="rtsp://10.0.0.1:554/1", stream_url_2=None, stream_url_3="")
    calls: list[tuple[str, list[str]]] = []
    with (
        patch.object(go2rtc, "is_available", return_value=True),
        patch.object(go2rtc, "_put_stream", side_effect=lambda n, s: calls.append((n, s))),
    ):
        names = go2rtc.ensure_camera_streams(cam)
    assert names == {"1": "cam8_1"}
    assert len(calls) == 1
    assert calls[0][0] == "cam8_1"


def test_aqura_stream_name():
    assert go2rtc.stream_name(8, "1") == "cam8_1"
    assert go2rtc.stream_name(8, "2") == "cam8_2"
    assert go2rtc.stream_name(8, "3") == "cam8_3"
