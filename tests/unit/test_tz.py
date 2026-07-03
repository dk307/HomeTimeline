"""Unit tests for app.services.tz."""

import zoneinfo
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


def test_detect_local_tz_returns_string():
    from app.services.tz import _detect_local_tz

    result = _detect_local_tz()
    assert isinstance(result, str)
    assert len(result) > 0


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
