"""Unit tests for camera Pydantic schemas (validation logic)."""

import pytest

from app.schemas.camera import CameraCreate, CameraUpdate


class TestCameraCreateClipStrategy:
    def test_hikvision_daily_folder_ok(self):
        c = CameraCreate(
            name="H", recording_path="/r", host="1.2.3.4", clip_strategy="daily_folder"
        )
        assert c.clip_strategy == "daily_folder"

    def test_hikvision_wrong_clip_strategy_rejected(self):
        with pytest.raises(ValueError, match="Hikvision cameras must use"):
            CameraCreate(
                name="H",
                recording_path="/r",
                host="1.2.3.4",
                camera_type="hikvision",
                clip_strategy="aqura_nas_upload",
            )

    def test_aqura_nas_upload_ok(self):
        c = CameraCreate(
            name="A",
            recording_path="/r",
            camera_type="aqura",
            stream_url_1="rtsp://x",
            clip_strategy="aqura_nas_upload",
        )
        assert c.clip_strategy == "aqura_nas_upload"

    def test_aqura_wrong_clip_strategy_rejected(self):
        with pytest.raises(ValueError, match="Aqura cameras must use"):
            CameraCreate(
                name="A",
                recording_path="/r",
                camera_type="aqura",
                stream_url_1="rtsp://x",
                clip_strategy="daily_folder",
            )


class TestCameraUpdateClipStrategy:
    def test_switch_to_hikvision_auto_corrects_clip_strategy(self):
        u = CameraUpdate(camera_type="hikvision", host="1.2.3.4")
        assert u.clip_strategy == "daily_folder"

    def test_switch_to_aqura_auto_corrects_clip_strategy(self):
        u = CameraUpdate(camera_type="aqura", stream_url_1="rtsp://x")
        assert u.clip_strategy == "aqura_nas_upload"

    def test_hikvision_with_wrong_explicit_clip_strategy_rejected(self):
        with pytest.raises(ValueError, match="Hikvision cameras must use"):
            CameraUpdate(camera_type="hikvision", host="1.2.3.4", clip_strategy="aqura_nas_upload")

    def test_aqura_with_wrong_explicit_clip_strategy_rejected(self):
        with pytest.raises(ValueError, match="Aqura cameras must use"):
            CameraUpdate(camera_type="aqura", stream_url_1="rtsp://x", clip_strategy="daily_folder")

    def test_no_type_change_does_not_enforce_clip_strategy(self):
        u = CameraUpdate(name="renamed")
        assert u.clip_strategy is None
