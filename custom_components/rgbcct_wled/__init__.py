"""The RGBCCT WLED integration.

A custom Home Assistant integration that owns all I/O with an RGBCCT WLED strip
and exposes it as RGBWW `light` entities — one per segment plus a whole-device
"group" light. It replaces the frontend card's two HA scripts and its browser
`ws://` doorbell, so colour/brightness/CCT sync works (with instant push) even on
HTTPS dashboards — a browser cannot open an insecure `ws://` from an HTTPS page,
which is what cost the old design its push channel.
"""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant

from .coordinator import RgbcctWledCoordinator

PLATFORMS: list[Platform] = [Platform.LIGHT]

type RgbcctWledConfigEntry = ConfigEntry[RgbcctWledCoordinator]


async def async_setup_entry(hass: HomeAssistant, entry: RgbcctWledConfigEntry) -> bool:
    """Set up a WLED device from a config entry."""
    coordinator = RgbcctWledCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await coordinator.async_start()

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload_on_update))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: RgbcctWledConfigEntry) -> bool:
    """Tear down the config entry: stop the websocket, unload platforms."""
    await entry.runtime_data.async_stop()
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_reload_on_update(hass: HomeAssistant, entry: RgbcctWledConfigEntry) -> None:
    """Reload when options (poll interval / push toggle) change."""
    await hass.config_entries.async_reload(entry.entry_id)
