"""Unit tests for app.services.tz."""

import zoneinfo
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


def test_detect_local_tz_returns_string():
    from app.services.tz import _detect_local_tz

    result = _detect_local_tz()
    assert isinstance(result, str)
    assert len(result) > 0


def test_detect_local_tz_etc_timezone_branch():
    """Covers lines 19-29: /etc/timezone file fallback when /etc/localtime is not a symlink."""
    from unittest.mock import MagicMock

    from app.services.tz import _detect_local_tz

    mock_lt = MagicMock()
    mock_lt.is_symlink.return_value = False

    mock_tz_file = MagicMock()
    mock_tz_file.exists.return_value = True
    mock_tz_file.read_text.return_value = "Europe/Berlin\n"

    def path_factory(p):
        if str(p) == "/etc/localtime":
            return mock_lt
        if str(p) == "/etc/timezone":
            return mock_tz_file
        return MagicMock()

    with patch("pathlib.Path", side_effect=path_factory):
        result = _detect_local_tz()

    assert result == "Europe/Berlin"


def test_get_app_tz_falls_back_when_settings_fail():
    """get_app_tz() falls back to local tz detection when AppSettings raises."""
    from app.services.tz import get_app_tz, invalidate_tz_cache

    invalidate_tz_cache()
    with patch(
        "app.models.app_settings.AppSettings.get_instance",
        side_effect=Exception("db error"),
    ):
        result = get_app_tz()

    assert isinstance(result, zoneinfo.ZoneInfo)
    invalidate_tz_cache()


def test_get_app_tz_falls_back_to_utc_when_all_fail():
    """Covers lines 38-39: final _UTC fallback when both AppSettings and _detect_local_tz raise."""
    from app.services import tz as tz_module
    from app.services.tz import invalidate_tz_cache

    invalidate_tz_cache()
    with patch(
        "app.models.app_settings.AppSettings.get_instance",
        side_effect=Exception("db error"),
    ):
        with patch("app.services.tz._detect_local_tz", side_effect=Exception("no tz")):
            result = tz_module.get_app_tz()

    assert result is tz_module._UTC
    invalidate_tz_cache()


def test_get_app_tz_uses_cache():
    """Second call to get_app_tz() returns the cached value without hitting AppSettings."""
    from app.services.tz import get_app_tz, invalidate_tz_cache

    invalidate_tz_cache()
    with patch(
        "app.models.app_settings.AppSettings.get_instance",
        side_effect=Exception("should only be called once"),
    ):
        with patch("app.services.tz._detect_local_tz", return_value="America/New_York"):
            first = get_app_tz()
            second = get_app_tz()  # Should use cache, not call AppSettings again

    assert first == second
    invalidate_tz_cache()


def test_to_app_tz_naive_treated_as_utc():
    from app.services.tz import to_app_tz

    naive = datetime(2024, 1, 15, 12, 0, 0)
    eastern = zoneinfo.ZoneInfo("America/New_York")
    with patch("app.services.tz.get_app_tz", return_value=eastern):
        result = to_app_tz(naive)
    assert result is not None
    assert result.tzinfo is not None
    # UTC noon → EST (UTC-5 in Jan) = 07:00
    assert result.hour == 7
    assert result.utcoffset() == timedelta(hours=-5)


def test_to_app_tz_aware_converted():
    from app.services.tz import to_app_tz

    aware = datetime(2024, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
    pacific = zoneinfo.ZoneInfo("America/Los_Angeles")
    with patch("app.services.tz.get_app_tz", return_value=pacific):
        result = to_app_tz(aware)
    assert result is not None
    # UTC noon → PST (UTC-8 in Jan) = 04:00
    assert result.hour == 4


def test_to_app_tz_none_returns_none():
    from app.services.tz import to_app_tz

    assert to_app_tz(None) is None


def test_fmt_dt_includes_offset():
    from app.services.tz import fmt_dt

    eastern = zoneinfo.ZoneInfo("America/New_York")
    with patch("app.services.tz.get_app_tz", return_value=eastern):
        result = fmt_dt(datetime(2024, 1, 15, 12, 0, 0))  # naive UTC
    assert result is not None
    # EST offset in January is -05:00
    assert "-05:00" in result


def test_fmt_dt_none_returns_none():
    from app.services.tz import fmt_dt

    assert fmt_dt(None) is None


def test_detect_local_tz_localtime_exception_handled():
    """Covers lines 20-21: exception in /etc/localtime block is caught, falls through."""
    from unittest.mock import MagicMock

    from app.services.tz import _detect_local_tz

    mock_lt = MagicMock()
    mock_lt.is_symlink.side_effect = OSError("permission denied")

    mock_tz_file = MagicMock()
    mock_tz_file.exists.return_value = True
    mock_tz_file.read_text.return_value = "Pacific/Tokyo"

    def path_factory(p):
        if str(p) == "/etc/localtime":
            return mock_lt
        if str(p) == "/etc/timezone":
            return mock_tz_file
        return MagicMock()

    with patch("pathlib.Path", side_effect=path_factory):
        result = _detect_local_tz()

    assert result == "Pacific/Tokyo"


def test_detect_local_tz_falls_back_to_utc():
    """Covers lines 28-30: both /etc paths fail, returns 'UTC'."""
    from unittest.mock import MagicMock

    from app.services.tz import _detect_local_tz

    mock_lt = MagicMock()
    mock_lt.is_symlink.return_value = False

    mock_tz_file = MagicMock()
    mock_tz_file.exists.side_effect = OSError("permission denied")

    def path_factory(p):
        if str(p) == "/etc/localtime":
            return mock_lt
        if str(p) == "/etc/timezone":
            return mock_tz_file
        return MagicMock()

    with patch("pathlib.Path", side_effect=path_factory):
        result = _detect_local_tz()

    assert result == "UTC"
