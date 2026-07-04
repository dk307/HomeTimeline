from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/cam.db"
    recording_locations: str = "/mnt/recordings"
    thumbnail_dir: str = "./data/thumbnails"
    log_file: str = "./data/app.log"
    # Legacy: scanning is now scheduled per-camera (Camera.scan_interval_minutes).
    # Retained so an existing SCAN_INTERVAL_MINUTES env var still parses cleanly.
    scan_interval_minutes: int = 5
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"

    @property
    def recording_paths(self) -> list[str]:
        return [p.strip() for p in self.recording_locations.split(":") if p.strip()]

    @property
    def db_path(self) -> str:
        return self.database_url.replace("sqlite:///", "")


settings = Settings()
