from datetime import datetime

from pydantic import BaseModel


class LocationBase(BaseModel):
    name: str
    description: str | None = None


class LocationCreate(LocationBase):
    pass


class LocationUpdate(BaseModel):
    name: str | None = None
    description: str | None = None


class LocationOut(LocationBase):
    id: int
    created_at: datetime

    model_config = {"from_attributes": True}
