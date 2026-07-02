"""Unit tests for the in-memory log buffer."""

import logging

from app.services.log_buffer import _BUFFER, _LOCK, BufferHandler, get_entries, install


def _clear_buffer():
    with _LOCK:
        _BUFFER.clear()


def test_buffer_handler_captures_records():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.capture")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.info("hello world")
    logger.removeHandler(handler)
    entries = get_entries()
    assert any(e["msg"] == "hello world" for e in entries)


def test_get_entries_level_filter():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.level")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.debug("debug msg")
    logger.warning("warn msg")
    logger.removeHandler(handler)

    debug_entries = get_entries(level="DEBUG")
    warn_entries = get_entries(level="WARNING")
    assert all(e["level"] == "DEBUG" for e in debug_entries)
    assert all(e["level"] == "WARNING" for e in warn_entries)
    assert any(e["msg"] == "warn msg" for e in warn_entries)


def test_get_entries_limit():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.limit")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    for i in range(10):
        logger.info(f"msg {i}")
    logger.removeHandler(handler)
    assert len(get_entries(limit=3)) == 3


def test_get_entries_empty():
    _clear_buffer()
    assert get_entries() == []


def test_get_entries_has_required_fields():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.fields")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.error("check fields")
    logger.removeHandler(handler)
    entries = get_entries()
    assert entries
    e = entries[-1]
    assert "ts" in e
    assert "level" in e
    assert "logger" in e
    assert "msg" in e


def test_buffer_is_bounded_at_max_capacity():
    """Buffer drops oldest entries once it exceeds maxlen=500."""
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.bounded")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)

    for i in range(600):
        logger.info(f"entry {i}")

    logger.removeHandler(handler)
    entries = get_entries(limit=600)
    # Buffer maxlen=500; earliest entries should have been evicted
    assert len(entries) == 500
    # The oldest retained entry should be 'entry 100' (entries 0-99 evicted)
    assert entries[0]["msg"] == "entry 100"


def test_install_adds_handler_to_root():
    root = logging.getLogger()
    before = [h for h in root.handlers if isinstance(h, BufferHandler)]
    try:
        install(level=logging.DEBUG)
        after = [h for h in root.handlers if isinstance(h, BufferHandler)]
        assert len(after) >= 1
    finally:
        # Remove any BufferHandlers added by this test to avoid polluting later tests
        added = [h for h in root.handlers if isinstance(h, BufferHandler) and h not in before]
        for h in added:
            root.removeHandler(h)
