"""E2E test configuration for Playwright."""
# --base-url and base_url fixture are provided by pytest-playwright.

import pytest


@pytest.fixture(autouse=True)
def test_db():
    """Shadow the root conftest test_db so E2E tests don't require peewee."""
    pass
