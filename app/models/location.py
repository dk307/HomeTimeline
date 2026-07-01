from datetime import datetime

from peewee import AutoField, CharField, DateTimeField, TextField

from app.models.base import BaseModel


class Location(BaseModel):
    id = AutoField()
    name = CharField(unique=True)
    description = TextField(null=True)
    created_at = DateTimeField(default=datetime.now)

    class Meta:
        table_name = "locations"
