"""In-memory circular log buffer — captures recent log records for the UI."""

import logging
import re
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

_BUFFER: deque = deque(maxlen=500)
_LOCK = Lock()

# Matches a line written by the file handler's formatter
# ("%(asctime)s %(levelname)s %(name)s: %(message)s"), where asctime is the
# default "YYYY-MM-DD HH:MM:SS,mmm". Used to rebuild structured entries from the
# persisted log so the UI still shows recent history after a restart.
_LINE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3}) (\w+) (\S+?): (.*)$")


class BufferHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        with _LOCK:
            _BUFFER.append(
                {
                    "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
                    "level": record.levelname,
                    "logger": record.name,
                    "msg": self.format(record),
                }
            )


_handler = BufferHandler()
_handler.setFormatter(logging.Formatter("%(message)s"))


def install(level: int = logging.DEBUG) -> None:
    _handler.setLevel(level)
    logging.getLogger().addHandler(_handler)


def seed_from_file(path: str, limit: int = 500) -> int:
    """Prefill the buffer from a persisted log file so recent history survives a
    restart (the in-memory buffer is otherwise empty on boot).

    The file handler writes timestamps in UTC (see ``app/main.py``), so each
    parsed asctime is treated as UTC. Lines that don't match the formatter shape
    (e.g. traceback continuations) are appended to the preceding entry's message.
    Only the most recent ``limit`` entries are kept, merged ahead of anything
    already buffered so ordering stays chronological.

    Merging is done explicitly rather than by ``extendleft`` so this is safe to
    call at any point — even after ``install()`` has begun capturing live entries:
    the historical entries go in front and the deque's ``maxlen`` drops the
    OLDEST on overflow, so live entries are never evicted.
    """
    p = Path(path)
    if not p.is_file():
        return 0
    entries: list[dict] = []
    try:
        with p.open("r", encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.rstrip("\n")
                m = _LINE_RE.match(line)
                if m:
                    date_s, ms, level, logger_name, msg = m.groups()
                    dt = datetime.strptime(date_s, "%Y-%m-%d %H:%M:%S").replace(
                        tzinfo=timezone.utc, microsecond=int(ms) * 1000
                    )
                    entries.append(
                        {"ts": dt.isoformat(), "level": level, "logger": logger_name, "msg": msg}
                    )
                elif entries:
                    entries[-1]["msg"] += "\n" + line
    except OSError:
        return 0
    entries = entries[-limit:]
    with _LOCK:
        # Historical (older) entries in front, then whatever is already buffered.
        # Re-extending a fresh deque lets maxlen evict from the LEFT (oldest) on
        # overflow; extendleft would instead drop the newest live entries.
        merged = entries + list(_BUFFER)
        _BUFFER.clear()
        _BUFFER.extend(merged)
    return len(entries)


def get_entries(level: str | None = None, limit: int = 200) -> list[dict]:
    with _LOCK:
        entries = list(_BUFFER)
    if level:
        entries = [e for e in entries if e["level"] == level.upper()]
    return entries[-limit:]
