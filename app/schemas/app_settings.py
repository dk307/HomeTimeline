from pydantic import BaseModel


class AppSettingsOut(BaseModel):
    timezone: str
    debug_logs: bool

    model_config = {"from_attributes": True}


class AppSettingsUpdate(BaseModel):
    timezone: str | None = None
    debug_logs: bool | None = None
