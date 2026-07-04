from datetime import datetime, timezone

from peewee import Model

from app.database import db


def utcnow() -> datetime:
    """Current time as a naive UTC datetime — the DB storage convention. Independent
    of the server's local timezone (unlike ``datetime.now()``)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class BaseModel(Model):
    class Meta:
        database = db
