"""Fixtures for the HA-harness integration tests.

These tests need `pytest-homeassistant-custom-component` (which pulls in Home
Assistant). Each test module `importorskip`s it, so without the harness installed
they skip cleanly and this autouse fixture is never invoked.
"""

import pytest


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Allow Home Assistant to load our custom_components/ during tests."""
    yield
