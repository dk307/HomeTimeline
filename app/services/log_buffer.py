"""In-memory circular log buffer — captures recent log records for the UI."""

import logging
from collections import deque
from datetime import datetime, timezone
from threading import Lock

_BUFFER: deque = deque(maxlen=500)
_LOCK = Lock()


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


def get_entries(level: str | None = None, limit: int = 200) -> list[dict]:
    with _LOCK:
        entries = list(_BUFFER)
    if level:
        entries = [e for e in entries if e["level"] == level.upper()]
    return entries[-limit:]
