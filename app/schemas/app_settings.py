from pydantic import BaseModel


class AppSettingsOut(BaseModel):
    timezone: str

    model_config = {"from_attributes": True}


class AppSettingsUpdate(BaseModel):
    timezone: str | None = None
