"""RGBWW light entities for a WLED device.

One entity per WLED segment plus a whole-device "group" entity, matching the
card's N segments -> N+1 entities convention (`src/entities.js`). Each is a
standard `ColorMode.RGBWW` light, so Home Assistant itself (scenes, voice,
automations, the native light card) can drive colour + temperature — the
custom card is just one more client.

Colour temperature rides the cold/warm-white channels (`color.py`); the write
path converts back to WLED's `w`+`cct` so the on-the-wire payload is unchanged
from the original "send wled with cct" script.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from homeassistant.components.light import (
    ATTR_BRIGHTNESS,
    ATTR_RGBWW_COLOR,
    ColorMode,
    LightEntity,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .color import cold_warm_to_white_cct, white_cct_to_cold_warm
from .const import DOMAIN
from .coordinator import RgbcctWledCoordinator
from .models import SegmentState, WledState

if TYPE_CHECKING:
    from . import RgbcctWledConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: "RgbcctWledConfigEntry",
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the group light + one light per current segment."""
    coordinator = entry.runtime_data
    entities: list[RgbcctWledLight] = [RgbcctWledLight(coordinator, seg_id=None)]
    entities.extend(
        RgbcctWledLight(coordinator, seg_id=segment.seg_id)
        for segment in coordinator.data.segments
    )
    async_add_entities(entities)


class RgbcctWledLight(CoordinatorEntity[RgbcctWledCoordinator], LightEntity):
    """A WLED segment (or the whole device) as an RGBWW light."""

    _attr_has_entity_name = True
    _attr_supported_color_modes = {ColorMode.RGBWW}
    _attr_color_mode = ColorMode.RGBWW

    def __init__(self, coordinator: RgbcctWledCoordinator, seg_id: int | None) -> None:
        """seg_id None -> the whole-device group entity."""
        super().__init__(coordinator)
        self._seg_id = seg_id
        self._is_group = seg_id is None

        if self._is_group:
            self._attr_name = None  # -> entity_id light.<device>
            self._attr_unique_id = f"{coordinator.mac}_group"
        else:
            self._attr_name = f"Segment {seg_id}"  # -> light.<device>_segment_<n>
            self._attr_unique_id = f"{coordinator.mac}_segment_{seg_id}"

        self._attr_device_info = DeviceInfo(
            # identifiers (NOT connections={CONNECTION_NETWORK_MAC}) so this stays
            # a distinct device from the native WLED integration — see the plan.
            identifiers={(DOMAIN, coordinator.mac)},
            name=coordinator.device_name,
            manufacturer="WLED",
            model=coordinator.model,
            sw_version=coordinator.sw_version,
            configuration_url=f"http://{coordinator.host}",
        )

    # -- reads --------------------------------------------------------------

    @property
    def _segment(self) -> SegmentState | None:
        """The segment this entity reads from (the group reads segment 0)."""
        state: WledState | None = self.coordinator.data
        if state is None or not state.segments:
            return None
        if self._is_group:
            return state.segments[0]
        return state.segment(self._seg_id)  # type: ignore[arg-type]

    @property
    def available(self) -> bool:
        """Unavailable if the device is unreachable or the segment is gone."""
        return super().available and self._segment is not None

    @property
    def is_on(self) -> bool | None:
        """On/off from the device power flag AND the segment power flag.

        The group is on when the device is on and *any* segment is on (so the
        master reflects "any segment lit"), gated by the device power.
        """
        state = self.coordinator.data
        if state is None:
            return None
        if self._is_group:
            return state.on and any(segment.on for segment in state.segments)
        segment = self._segment
        return bool(state.on and segment.on) if segment is not None else None

    @property
    def brightness(self) -> int | None:
        """Segment brightness (WLED seg.bri) — unscaled from the colour."""
        segment = self._segment
        return segment.bri if segment is not None else None

    @property
    def rgbww_color(self) -> tuple[int, int, int, int, int] | None:
        """(r, g, b, cold_white, warm_white) derived from WLED w+cct."""
        segment = self._segment
        if segment is None:
            return None
        cold_white, warm_white = white_cct_to_cold_warm(segment.w, segment.cct)
        return (segment.r, segment.g, segment.b, cold_white, warm_white)

    # -- writes -------------------------------------------------------------

    @property
    def _target_ids(self) -> list[int]:
        """Segments a write touches: every segment for the group, else just one.

        Guarded against a missing coordinator payload: a service call can race a
        failed first refresh, and an empty target list is a harmless no-op where
        an attribute error would surface as a stack trace in the log.
        """
        if not self._is_group:
            return [self._seg_id]  # type: ignore[list-item]
        state = self.coordinator.data
        return [segment.seg_id for segment in state.segments] if state else []

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Apply colour/brightness and power on.

        Starts from the current segment values so a partial call (e.g. only
        brightness) doesn't wipe colour. Turning on also powers the device on
        (Pattern 5): a lit segment must have the device on to actually show, and
        the group turns every segment on. All of this goes in one POST.
        """
        segment = self._segment
        red, green, blue = (segment.r, segment.g, segment.b) if segment else (255, 255, 255)
        white, cct = (segment.w, segment.cct) if segment else (0, 127)
        brightness = segment.bri if segment else 255

        if ATTR_RGBWW_COLOR in kwargs:
            red, green, blue, cold_white, warm_white = kwargs[ATTR_RGBWW_COLOR]
            white, cct = cold_warm_to_white_cct(cold_white, warm_white, cct)
        if ATTR_BRIGHTNESS in kwargs:
            brightness = kwargs[ATTR_BRIGHTNESS]

        seg_payload = [
            {
                "id": seg_id,
                "on": True,
                "bri": brightness,
                "col": [[red, green, blue, white]],
                "cct": cct,
            }
            for seg_id in self._target_ids
        ]
        await self.coordinator.async_command({"on": True, "seg": seg_payload})

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Power off.

        The group clears device power and every segment's power. A single
        segment only clears its own power (device and other segments untouched),
        matching the original card's Pattern 5 behaviour.
        """
        if self._is_group:
            await self.coordinator.async_command(
                {"on": False, "seg": [{"id": seg_id, "on": False} for seg_id in self._target_ids]}
            )
        else:
            await self.coordinator.async_command({"seg": [{"id": self._seg_id, "on": False}]})
