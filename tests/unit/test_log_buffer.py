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
    assert len(get_entries(limit=3)) <= 3


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


def test_install_adds_handler_to_root():
    root = logging.getLogger()
    install(level=logging.DEBUG)
    # install() should have added BufferHandler; it may already be present
    buffer_handlers = [h for h in root.handlers if isinstance(h, BufferHandler)]
    assert len(buffer_handlers) >= 1
    # Remove extras to avoid polluting other tests
    for h in buffer_handlers[1:]:
        root.removeHandler(h)
