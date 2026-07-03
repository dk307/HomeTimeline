"""Shared assertion helpers for the test suite."""


def assert_offset_aware_iso(value: str) -> None:
    """Assert an ISO-8601 string carries a timezone.

    Sign-agnostic: the offset may be ``Z``, ``+HH:MM``, or ``-HH:MM`` in the time
    part, so the check holds regardless of the local timezone the tests run under.
    """
    assert value is not None
    assert "T" in value, f"expected ISO-8601 timestamp with a 'T' separator, got {value!r}"
    time_part = value.split("T", 1)[1]
    assert value.endswith("Z") or "+" in time_part or "-" in time_part, (
        f"expected tz-aware ISO timestamp, got {value!r}"
    )
