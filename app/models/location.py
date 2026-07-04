from peewee import AutoField, CharField, DateTimeField, TextField

from app.models.base import BaseModel, utcnow


class Location(BaseModel):
    id = AutoField()
    name = CharField(unique=True)
    description = TextField(null=True)
    created_at = DateTimeField(default=utcnow)

    class Meta:
        table_name = "locations"
