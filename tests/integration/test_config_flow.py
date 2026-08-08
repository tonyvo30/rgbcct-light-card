"""HA-harness tests for the config flow.

Requires pytest-homeassistant-custom-component (see requirements_test.txt); skips
cleanly without it. `_async_fetch_info` is patched so no real WLED is needed.
"""

import pytest

pytest.importorskip("pytest_homeassistant_custom_component")

from unittest.mock import patch  # noqa: E402

import aiohttp  # noqa: E402
from homeassistant import config_entries  # noqa: E402
from homeassistant.core import HomeAssistant  # noqa: E402
from homeassistant.data_entry_flow import FlowResultType  # noqa: E402
from pytest_homeassistant_custom_component.common import MockConfigEntry  # noqa: E402

from custom_components.rgbcct_wled.const import DOMAIN  # noqa: E402

_INFO = {"mac": "aabbccddeeff", "name": "Desk WLED", "arch": "esp32", "ver": "0.14.0"}
_FETCH = "custom_components.rgbcct_wled.config_flow._async_fetch_info"
# A successful flow makes HA immediately set the entry up for real, which starts the
# coordinator's poll + websocket against the fake host — a socket the harness blocks,
# and a task still running at teardown ("Lingering task after test"). These are
# config-flow tests, so stub setup out; the coordinator has its own tests.
_SETUP = "custom_components.rgbcct_wled.async_setup_entry"


async def test_user_flow_success(hass: HomeAssistant) -> None:
    """A reachable host creates an entry keyed on the MAC."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM

    with patch(_FETCH, return_value=_INFO), patch(_SETUP, return_value=True):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"host": "1.2.3.4"}
        )
        await hass.async_block_till_done()

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Desk WLED"
    assert result["data"]["host"] == "1.2.3.4"
    assert result["data"]["mac"] == "aabbccddeeff"
    assert result["result"].unique_id == "aabbccddeeff"


async def test_user_flow_cannot_connect(hass: HomeAssistant) -> None:
    """An unreachable host shows the cannot_connect error."""
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    with patch(_FETCH, side_effect=aiohttp.ClientError):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"host": "1.2.3.4"}
        )

    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}


async def test_duplicate_mac_aborts(hass: HomeAssistant) -> None:
    """Adding a strip whose MAC is already configured aborts (and updates host)."""
    existing = MockConfigEntry(
        domain=DOMAIN,
        unique_id="aabbccddeeff",
        data={"host": "1.2.3.4", "mac": "aabbccddeeff", "name": "Desk WLED"},
    )
    existing.add_to_hass(hass)

    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    with patch(_FETCH, return_value=_INFO):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {"host": "5.6.7.8"}
        )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    # _abort_if_unique_id_configured(updates=...) refreshes the stored host.
    assert existing.data["host"] == "5.6.7.8"
