"""State coordinator for a single WLED device.

Owns all I/O with the strip (replacing the old "get/send wled with cct" HA
scripts + rest_commands, and the browser-side ws:// doorbell):

- **HTTP** `GET /json/state` as a fallback poll and `POST /json/state` for writes.
- A **persistent server-side websocket** to `ws://<host>/ws`. WLED broadcasts its
  full state on every change (and once on connect), so here we *parse the frame
  directly* — unlike the browser doorbell, there's no scarce WS-client slot, no
  HTTPS block, and no need to re-read through a script. Each frame pushes fresh
  state to the entities, which HA relays to the frontend over its own secure WS.

The poll is only a safety net for when the socket is down; the websocket carries
the fast path. Reconnect uses capped exponential backoff so a rebooting or absent
ESP (which has little heap) isn't hammered.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from datetime import timedelta

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_HOST,
    CONF_POLL_INTERVAL,
    CONF_PUSH,
    DEFAULT_POLL_INTERVAL,
    DOMAIN,
    HTTP_TIMEOUT,
    WS_HEARTBEAT,
    WS_RECONNECT_INITIAL,
    WS_RECONNECT_MAX,
)
from .models import WledState, parse_state

_LOGGER = logging.getLogger(__name__)


class RgbcctWledCoordinator(DataUpdateCoordinator[WledState]):
    """Coordinate HTTP polling + the push websocket for one WLED device."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        """Set up the coordinator from a config entry."""
        self.entry = entry
        self.host: str = entry.data[CONF_HOST]
        self.mac: str = entry.data["mac"]
        self.device_name: str = entry.data.get("name") or self.host
        self.model: str | None = entry.data.get("model")
        self.sw_version: str | None = entry.data.get("version")

        poll_interval = entry.options.get(CONF_POLL_INTERVAL, DEFAULT_POLL_INTERVAL)
        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN} ({self.host})",
            update_interval=timedelta(seconds=poll_interval),
        )

        self._session = async_get_clientsession(hass)
        self._push_enabled: bool = entry.options.get(CONF_PUSH, True)
        self._ws_task: asyncio.Task | None = None
        # Push-channel health, tracked so failures are logged on transition
        # rather than once per retry (or, as before, not visibly at all).
        self._push_connected = False
        self._push_failure_logged = False

    # -- HTTP ---------------------------------------------------------------

    async def _async_update_data(self) -> WledState:
        """Fallback poll: read the true state over HTTP."""
        try:
            async with asyncio.timeout(HTTP_TIMEOUT):
                async with self._session.get(f"http://{self.host}/json/state") as resp:
                    resp.raise_for_status()
                    payload = await resp.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise UpdateFailed(f"Error fetching WLED state from {self.host}: {err}") from err
        return parse_state(payload)

    async def async_command(self, payload: dict) -> None:
        """POST a raw /json/state payload to WLED (the one write path).

        Callers (light.py) build the full payload — device `on` plus a `seg`
        list — so a whole turn_on/turn_off, including power propagation, is a
        single request (gentle on the ESP). A refresh is requested afterwards so
        state still settles when push is disabled or the socket is momentarily
        down; the websocket frame normally beats it.
        """
        try:
            async with asyncio.timeout(HTTP_TIMEOUT):
                async with self._session.post(
                    f"http://{self.host}/json/state", json=payload
                ) as resp:
                    resp.raise_for_status()
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise HomeAssistantError(f"Failed to send to WLED at {self.host}: {err}") from err
        await self.async_request_refresh()

    # -- Push websocket -----------------------------------------------------

    async def async_start(self) -> None:
        """Start the background push websocket (unless disabled)."""
        if not self._push_enabled or self._ws_task is not None:
            return
        self._ws_task = self.entry.async_create_background_task(
            self.hass, self._ws_loop(), f"{DOMAIN}_ws_{self.host}"
        )

    async def async_stop(self) -> None:
        """Cancel the push websocket task."""
        if self._ws_task is not None:
            self._ws_task.cancel()
            with suppress(asyncio.CancelledError):
                await self._ws_task
            self._ws_task = None

    async def _ws_loop(self) -> None:
        """Hold the WLED websocket open, pushing each frame to the entities.

        Push loss is reported at `warning` on the *transition*, not swallowed at
        debug: the integration advertises `iot_class: local_push`, so a socket
        that never connects leaves it quietly serving state up to a poll interval
        stale while still looking healthy. Repeat failures drop to debug so a
        long outage does not flood the log.
        """
        delay = WS_RECONNECT_INITIAL
        url = f"ws://{self.host}/ws"
        while True:
            try:
                # heartbeat= sends WS pings so a half-open socket is detected and
                # torn down (the browser doorbell had to fake this by sending {}).
                async with self._session.ws_connect(url, heartbeat=WS_HEARTBEAT) as socket:
                    if not self._push_connected:
                        _LOGGER.info("WLED push websocket connected: %s", self.host)
                    self._push_connected = True
                    self._push_failure_logged = False
                    delay = WS_RECONNECT_INITIAL
                    async for message in socket:
                        if message.type is aiohttp.WSMsgType.TEXT:
                            # Frame handling never raises (see _handle_frame), so
                            # a parse bug cannot masquerade as a disconnect here.
                            self._handle_frame(message.data)
                        elif message.type in (
                            aiohttp.WSMsgType.ERROR,
                            aiohttp.WSMsgType.CLOSE,
                            aiohttp.WSMsgType.CLOSING,
                            aiohttp.WSMsgType.CLOSED,
                        ):
                            break
            except asyncio.CancelledError:
                raise
            except Exception as err:  # noqa: BLE001 - log and reconnect on anything
                self._report_push_lost(err)
            else:
                self._report_push_lost(None)

            await asyncio.sleep(delay)
            delay = min(delay * 2, WS_RECONNECT_MAX)

    def _report_push_lost(self, err: Exception | None) -> None:
        """Log a push-channel failure once per outage, then quietly."""
        if not self._push_failure_logged:
            _LOGGER.warning(
                "WLED push websocket unavailable for %s (%s); falling back to "
                "polling every %ss and retrying",
                self.host,
                err or "connection closed",
                self.update_interval.total_seconds() if self.update_interval else "?",
            )
            self._push_failure_logged = True
        else:
            _LOGGER.debug("WLED websocket retry failed for %s: %s", self.host, err)
        self._push_connected = False

    def _handle_frame(self, raw: str) -> None:
        """Parse a websocket frame and push it as fresh coordinator data.

        Deliberately total — it must not raise. `_ws_loop` treats an exception as
        a dead connection and reconnects, so a parse bug escaping here would be
        indistinguishable from a network blip and would silently retry forever.
        """
        try:
            payload = json.loads(raw)
        except ValueError:
            _LOGGER.debug("Ignoring non-JSON WLED frame from %s", self.host)
            return
        if not isinstance(payload, dict):
            return
        # Only frames that actually carry state (guards against WLED's occasional
        # ack/info-only frames).
        if not any(key in payload for key in ("state", "seg", "on")):
            return

        try:
            state = parse_state(payload)
        except Exception:  # noqa: BLE001 - a parse bug must not kill the socket
            _LOGGER.exception("Malformed WLED frame from %s: %.200s", self.host, raw)
            return

        # A frame carrying no segments (e.g. a bare {"on": true} ack) would
        # otherwise replace good data with an empty state, marking every entity
        # unavailable and making group turn-off a no-op until the next poll.
        if not state.segments:
            _LOGGER.debug("Ignoring WLED frame with no segments from %s", self.host)
            return

        self.async_set_updated_data(state)
