"""Unit tests for the in-memory log buffer."""

import logging

from app.services.log_buffer import (
    _BUFFER,
    _LOCK,
    BufferHandler,
    get_entries,
    install,
    seed_from_file,
)


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


def test_seed_from_file_restores_entries(tmp_path):
    """Persisted log lines are parsed back into structured buffer entries so the
    UI shows recent history after a restart."""
    _clear_buffer()
    log = tmp_path / "app.log"
    log.write_text(
        "2026-07-04 22:56:43,659 INFO app.main: Starting Camera Event Manager\n"
        "2026-07-04 22:56:44,001 WARNING app.scanner: slow scan\n",
        encoding="utf-8",
    )
    n = seed_from_file(str(log))
    assert n == 2
    entries = get_entries()
    assert [e["msg"] for e in entries] == ["Starting Camera Event Manager", "slow scan"]
    assert entries[0]["level"] == "INFO"
    assert entries[1]["logger"] == "app.scanner"
    # Timestamps are treated as UTC (the file handler writes UTC).
    assert entries[0]["ts"] == "2026-07-04T22:56:43.659000+00:00"


def test_seed_from_file_attaches_traceback_continuations(tmp_path):
    """Lines that don't match the formatter shape (tracebacks) append to the
    preceding entry rather than becoming their own rows."""
    _clear_buffer()
    log = tmp_path / "app.log"
    log.write_text(
        "2026-07-04 22:56:43,659 ERROR app.api: boom\n"
        "Traceback (most recent call last):\n"
        '  File "x.py", line 1, in <module>\n'
        "ValueError: bad\n",
        encoding="utf-8",
    )
    assert seed_from_file(str(log)) == 1
    entry = get_entries()[-1]
    assert entry["msg"].startswith("boom\nTraceback")
    assert entry["msg"].endswith("ValueError: bad")


def test_seed_from_file_missing_file_is_noop(tmp_path):
    _clear_buffer()
    assert seed_from_file(str(tmp_path / "nope.log")) == 0
    assert get_entries() == []


def test_seed_from_file_read_error_is_noop(tmp_path, monkeypatch):
    """A file that exists but can't be read degrades to a no-op, not a crash."""
    _clear_buffer()
    log = tmp_path / "app.log"
    log.write_text("2026-07-04 22:56:43,659 INFO app.main: x\n", encoding="utf-8")

    def boom(*args, **kwargs):
        raise OSError("unreadable")

    monkeypatch.setattr("pathlib.Path.open", boom)
    assert seed_from_file(str(log)) == 0
    assert get_entries() == []


def test_seed_from_file_prepends_before_live_entries(tmp_path):
    """Seeded (older) history is inserted ahead of anything already buffered so
    ordering stays chronological."""
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.seedorder")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.info("live entry")
    logger.removeHandler(handler)

    log = tmp_path / "app.log"
    log.write_text("2026-07-04 22:56:43,659 INFO app.main: historical entry\n", encoding="utf-8")
    seed_from_file(str(log))
    msgs = [e["msg"] for e in get_entries()]
    assert msgs == ["historical entry", "live entry"]


def test_seed_from_file_nearly_full_buffer_keeps_newest_live(tmp_path):
    """When the buffer is near maxlen (500), seeding must evict the OLDEST
    entries (the historical ones), never the newest live entries."""
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.seedfull")
    logger.propagate = False  # don't double-capture via any root-installed handler
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    # 498 live entries: 2 slots short of the 500 cap.
    for i in range(498):
        logger.info(f"live {i}")
    logger.removeHandler(handler)

    # 5 historical entries, all older than the live ones.
    log = tmp_path / "app.log"
    log.write_text(
        "".join(f"2026-07-04 22:56:{i:02d},000 INFO app.main: hist {i}\n" for i in range(5)),
        encoding="utf-8",
    )
    seed_from_file(str(log))

    msgs = [e["msg"] for e in get_entries(limit=1000)]
    # 498 live + 5 hist = 503 → capped at 500, dropping the 3 OLDEST (hist 0-2).
    assert len(msgs) == 500
    # Every live entry survives, newest last…
    assert msgs[-1] == "live 497"
    assert msgs[2] == "live 0"
    # …and only the two most-recent historical entries remain, ahead of the live.
    assert msgs[:2] == ["hist 3", "hist 4"]
    assert "hist 0" not in msgs


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


def test_buffer_handler_captures_camera_name():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.camera")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.info("Camera Garage: scan complete", extra={"camera_name": "Garage"})
    logger.removeHandler(handler)
    entries = get_entries()
    assert any(e["camera_name"] == "Garage" for e in entries)
    assert any(e["msg"].startswith("[Garage]") for e in entries)


def test_buffer_handler_no_camera_name():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.nocamera")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.info("no camera here")
    logger.removeHandler(handler)
    entries = get_entries()
    assert entries[-1]["camera_name"] is None
    assert entries[-1]["msg"] == "no camera here"


def test_get_entries_search_filter():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.search")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.info("apple pie")
    logger.info("banana bread")
    logger.info("apple cider")
    logger.removeHandler(handler)

    apple = get_entries(search="apple")
    assert len(apple) == 2

    banana = get_entries(search="banana")
    assert len(banana) == 1

    grape = get_entries(search="grape")
    assert len(grape) == 0


def test_get_entries_search_case_insensitive():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.case")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.info("Hello World")
    logger.removeHandler(handler)

    assert len(get_entries(search="hello")) == 1
    assert len(get_entries(search="HELLO")) == 1
    assert len(get_entries(search="world")) == 1


def test_get_entries_combines_level_and_search():
    _clear_buffer()
    handler = BufferHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger = logging.getLogger("test.combo")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.info("info msg")
    logger.warning("warn msg")
    logger.info("another info")
    logger.removeHandler(handler)

    result = get_entries(level="INFO", search="another")
    assert len(result) == 1
    assert result[0]["msg"] == "another info"
