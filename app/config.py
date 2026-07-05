from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/cam.db"
    recording_locations: str = "/mnt/recordings"
    thumbnail_dir: str = "./data/thumbnails"
    log_file: str = "./data/app.log"
    host: str = "0.0.0.0"
    port: int = 8080
    log_level: str = "INFO"

    # go2rtc — embedded live-streaming (WebRTC/MSE) bridge for Hikvision cameras.
    go2rtc_enabled: bool = True
    go2rtc_binary: str = "go2rtc"
    go2rtc_api: str = "http://127.0.0.1:1984"
    go2rtc_config_dir: str = "./data"
    go2rtc_log_level: str = "warn"
    go2rtc_webrtc_port: int = 8555
    # Reachable "host:port" advertised to browsers for WebRTC. Inside a container
    # go2rtc can't detect the host's LAN IP, so the deploy passes it explicitly.
    # Empty = rely on go2rtc auto-detection (works for host networking / MSE only).
    go2rtc_webrtc_candidate: str = ""

    @property
    def recording_paths(self) -> list[str]:
        return [p.strip() for p in self.recording_locations.split(":") if p.strip()]

    @property
    def db_path(self) -> str:
        return self.database_url.replace("sqlite:///", "")


settings = Settings()
