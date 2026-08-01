"""Build-time metadata injected via Dockerfile ARGs → ENV."""

import os

GIT_SHA: str = os.getenv("GIT_SHA", "unknown")
BUILD_TIME: str = os.getenv("BUILD_TIME", "unknown")
GO2RTC_VERSION: str = "1.9.14"  # must match Dockerfile ARG
NODE_VERSION: str = "26"  # must match Dockerfile stage
