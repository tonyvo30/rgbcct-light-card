"""Config flow for the RGBCCT WLED integration.

Adds each WLED to *our* integration (it can't reuse the native WLED config
entry). Two entry paths — manual host and `_wled._tcp` zeroconf discovery — both
identify the device by its MAC (`/json/info` -> `mac`), used as the config-entry
`unique_id` so the same strip can't be added twice and discovery can recognise an
already-configured device.
"""

from __future__ import annotations

import asyncio
import re
from typing import Any

import aiohttp
import voluptuous as vol
from homeassistant.config_entries import ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from .const import (
    CONF_HOST,
    CONF_POLL_INTERVAL,
    CONF_PUSH,
    DEFAULT_POLL_INTERVAL,
    DOMAIN,
    HTTP_TIMEOUT,
)


# The host is interpolated straight into "http://{host}/json/state" and the
# websocket URL, so it must be a bare host (optionally :port) and nothing else.
# Without this, "10.0.0.5@evil.example" would parse as *userinfo* and silently
# target evil.example, and "10.0.0.5/x?" would rewrite the path.
_HOST_PATTERN = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?::\d{1,5})?$")


def host_is_valid(host: str) -> bool:
    """True if `host` is a plain hostname/IPv4, optionally with a port.

    Bracketed IPv6 is not accepted; WLED devices are reached by IPv4 or mDNS
    name in practice, and allowing brackets here would widen the URL-injection
    surface this check exists to close.
    """
    return bool(_HOST_PATTERN.match(host))


async def _async_fetch_info(hass, host: str) -> dict:
    """Fetch WLED /json/info (raises aiohttp/timeout/ValueError on failure)."""
    session = async_get_clientsession(hass)
    async with asyncio.timeout(HTTP_TIMEOUT):
        async with session.get(f"http://{host}/json/info") as resp:
            resp.raise_for_status()
            return await resp.json()


def _entry_data(host: str, mac: str, info: dict) -> dict:
    """Build the config-entry data from a validated host + info."""
    return {
        CONF_HOST: host,
        "mac": mac,
        "name": info.get("name"),
        "model": info.get("arch"),
        "version": info.get("ver"),
    }


class RgbcctWledConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for RGBCCT WLED."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialise per-flow discovery state."""
        self._host: str | None = None
        self._mac: str | None = None
        self._info: dict | None = None

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manual host entry."""
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST].strip()
            info: dict | None = None

            if not host_is_valid(host):
                errors["base"] = "invalid_host"
            else:
                try:
                    info = await _async_fetch_info(self.hass, host)
                except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
                    errors["base"] = "cannot_connect"

            if info is not None:
                mac = info.get("mac")
                if not mac:
                    errors["base"] = "no_mac"
                else:
                    await self.async_set_unique_id(mac)
                    self._abort_if_unique_id_configured(updates={CONF_HOST: host})
                    return self.async_create_entry(
                        title=info.get("name") or host, data=_entry_data(host, mac, info)
                    )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_HOST): str}),
            errors=errors,
        )

    async def async_step_zeroconf(self, discovery_info: ZeroconfServiceInfo) -> ConfigFlowResult:
        """Handle `_wled._tcp` discovery."""
        host = discovery_info.host
        # Discovery data is attacker-influenceable on a hostile LAN, and this flow
        # can update an existing entry's host below — so it gets the same check as
        # typed input rather than being trusted for coming from zeroconf.
        if not host_is_valid(host):
            return self.async_abort(reason="invalid_host")
        try:
            info = await _async_fetch_info(self.hass, host)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError):
            return self.async_abort(reason="cannot_connect")

        mac = info.get("mac") or discovery_info.properties.get("mac")
        if not mac:
            return self.async_abort(reason="no_mac")

        await self.async_set_unique_id(mac)
        self._abort_if_unique_id_configured(updates={CONF_HOST: host})

        self._host = host
        self._mac = mac
        self._info = info
        self.context["title_placeholders"] = {"name": info.get("name") or host}
        return await self.async_step_zeroconf_confirm()

    async def async_step_zeroconf_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Confirm adding a discovered device."""
        # An explicit guard, not `assert` — asserts are stripped under `python -O`,
        # which would turn a lost flow context into an AttributeError instead.
        if self._host is None or self._mac is None or self._info is None:
            return self.async_abort(reason="cannot_connect")
        name = self._info.get("name") or self._host
        if user_input is not None:
            return self.async_create_entry(
                title=name, data=_entry_data(self._host, self._mac, self._info)
            )
        return self.async_show_form(
            step_id="zeroconf_confirm", description_placeholders={"name": name}
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry) -> OptionsFlow:
        """Return the options flow."""
        return RgbcctWledOptionsFlow()


class RgbcctWledOptionsFlow(OptionsFlow):
    """Options: fallback poll interval + push on/off."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Manage the options."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        options = self.config_entry.options
        schema = vol.Schema(
            {
                vol.Optional(CONF_PUSH, default=options.get(CONF_PUSH, True)): bool,
                vol.Optional(
                    CONF_POLL_INTERVAL,
                    default=options.get(CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL),
                ): vol.All(int, vol.Range(min=3, max=3600)),
            }
        )
        return self.async_show_form(step_id="init", data_schema=schema)
