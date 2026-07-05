"""Shared test fixtures for unit and integration tests."""

import os

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite:////tmp/test_cam.db")
os.environ.setdefault("RECORDING_LOCATIONS", "/tmp/test_recordings")
os.environ.setdefault("THUMBNAIL_DIR", "/tmp/test_thumbnails")
os.environ.setdefault("SCAN_INTERVAL_MINUTES", "60")


@pytest.fixture(autouse=True)
def test_db(tmp_path):
    from app.database import db
    from app.models.app_settings import AppSettings
    from app.models.camera import Camera
    from app.models.download_event import DownloadEvent
    from app.models.location import Location
    from app.models.purge_event import PurgeEvent
    from app.models.recording import Recording
    from app.models.scan_event import ScanEvent

    tables = [Location, Camera, Recording, ScanEvent, DownloadEvent, PurgeEvent, AppSettings]
    db_file = str(tmp_path / "test.db")
    db.init(db_file, pragmas={"journal_mode": "wal", "foreign_keys": 1})
    db.connect(reuse_if_open=True)
    db.create_tables(tables)
    yield db
    from app.services.tz import invalidate_tz_cache

    invalidate_tz_cache()
    db.drop_tables(tables, safe=True)
    db.close()


@pytest.fixture()
def client(test_db):
    from fastapi import FastAPI
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.testclient import TestClient

    from app.api import (
        activity,
        app_settings,
        cameras,
        health,
        locations,
        logs,
        recordings,
        scanner,
        storage,
        timeline,
    )

    app = FastAPI(title="CEM Test")
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
    )
    prefix = "/api/v1"
    app.include_router(health.router, prefix=prefix)
    app.include_router(locations.router, prefix=prefix)
    app.include_router(cameras.router, prefix=prefix)
    app.include_router(recordings.router, prefix=prefix)
    app.include_router(timeline.router, prefix=prefix)
    app.include_router(scanner.router, prefix=prefix)
    app.include_router(storage.router, prefix=prefix)
    app.include_router(logs.router, prefix=prefix)
    app.include_router(activity.router, prefix=prefix)
    app.include_router(app_settings.router, prefix=prefix)

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


@pytest.fixture()
def location(test_db):
    from app.models.location import Location

    return Location.create(name="Front Door")


@pytest.fixture()
def camera(test_db, location):
    from app.models.camera import Camera

    return Camera.create(
        name="Test Cam",
        recording_path="/tmp/test_recordings",
        location=location,
    )


@pytest.fixture()
def recording(test_db, camera):
    from datetime import datetime

    from app.models.recording import Recording

    return Recording.create(
        camera=camera,
        file_path="/tmp/test_recordings/test.mp4",
        start_time=datetime(2024, 1, 15, 10, 0, 0),
        end_time=datetime(2024, 1, 15, 10, 1, 0),
        duration_secs=60.0,
        file_size_bytes=1024 * 1024,
        status="ready",
    )
