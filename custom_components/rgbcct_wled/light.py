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
from .models import DEFAULT_CCT, SegmentState, WledState
from .payload import build_turn_off_payload, build_turn_on_payload

if TYPE_CHECKING:
    from . import RgbcctWledConfigEntry


async def async_setup_entry(
    hass: HomeAssistant,
    entry: "RgbcctWledConfigEntry",
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Create the group light + one light per current segment."""
    coordinator = entry.runtime_data
    entities: list[RgbcctWledLight] = [RgbcctWledLight(coordinator, segment_id=None)]
    entities.extend(
        RgbcctWledLight(coordinator, segment_id=segment.segment_id)
        for segment in coordinator.data.segments
    )
    async_add_entities(entities)


class RgbcctWledLight(CoordinatorEntity[RgbcctWledCoordinator], LightEntity):
    """A WLED segment (or the whole device) as an RGBWW light."""

    _attr_has_entity_name = True
    _attr_supported_color_modes = {ColorMode.RGBWW}
    _attr_color_mode = ColorMode.RGBWW

    def __init__(self, coordinator: RgbcctWledCoordinator, segment_id: int | None) -> None:
        """segment_id None -> the whole-device group entity."""
        super().__init__(coordinator)
        self._segment_id = segment_id
        self._is_group = segment_id is None

        if self._is_group:
            self._attr_name = None  # -> entity_id light.<device>
            self._attr_unique_id = f"{coordinator.mac}_group"
        else:
            self._attr_name = f"Segment {segment_id}"  # -> light.<device>_segment_<n>
            self._attr_unique_id = f"{coordinator.mac}_segment_{segment_id}"

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
        """The segment this entity reads from.

        **Contract (chosen, not incidental): the group reports segment 0.** When
        segments hold different colours the group entity shows segment 0's and
        gives no signal that the others differ — HA's light model has no "mixed"
        concept to express it with (the card carried a Mixed badge for exactly
        this, `src/mixins/segments.js`). Segment 0 is picked because it is stable
        and is the segment WLED itself treats as primary; averaging would invent
        a colour no segment actually shows, and reporting `None` would make the
        group unusable in scenes and automations.
        """
        state: WledState | None = self.coordinator.data
        if state is None or not state.segments:
            return None
        if self._is_group:
            return state.segments[0]
        return state.segment(self._segment_id)  # type: ignore[arg-type]

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
        """Segment brightness (WLED seg.bri) — unscaled from the colour.

        **Known limitation.** WLED's real output is `master_bri * seg.bri / 255`,
        and this reports only `seg.bri`, so while the device master is below 255
        the number overstates actual output (master 40% + seg 255 reads as 255 and
        lights at 40%). A *group* turn-on pins the master to full and restores
        truth; a *segment* turn-on deliberately leaves the master alone, because
        writing a device-global from a segment entity is worse (see `payload.py`).

        Reporting the true product instead was considered and rejected: a segment
        could then never reach 255 while the master is low — `seg.bri` cannot
        exceed 255 — so HA would set full and read back the capped value, snapping
        the slider. The group entity is the device-wide control, so device-wide
        state resetting there is the coherent contract.
        """
        segment = self._segment
        return segment.brightness if segment is not None else None

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
            return [self._segment_id]  # type: ignore[list-item]
        state = self.coordinator.data
        return [segment.segment_id for segment in state.segments] if state else []

    async def async_turn_on(self, **kwargs: Any) -> None:
        """Apply whatever Home Assistant supplied, and power on.

        **Only the channels actually requested are written.** Reconstructing the
        omitted ones from current state looks harmless but is not: for the group
        `_segment` is segment 0, and the write fans out to *every* segment — so a
        bare turn-on (a UI toggle, a scene, a voice command) would stamp segment
        0's colour over all the others, destroying per-segment state on the
        device. Anything not requested is left off the wire entirely.

        Turning on also powers the device on (Pattern 5): a lit segment needs the
        device on to actually show, and the group turns every segment on. It all
        goes in one POST.
        """
        wled_color = None
        if ATTR_RGBWW_COLOR in kwargs:
            red, green, blue, cold_white, warm_white = kwargs[ATTR_RGBWW_COLOR]
            segment = self._segment
            white, cct = cold_warm_to_white_cct(
                cold_white, warm_white, segment.cct if segment else DEFAULT_CCT
            )
            wled_color = (red, green, blue, white, cct)

        await self.coordinator.async_command(
            build_turn_on_payload(
                self._target_ids,
                is_group=self._is_group,
                wled_color=wled_color,
                brightness=kwargs.get(ATTR_BRIGHTNESS),
            )
        )

    async def async_turn_off(self, **kwargs: Any) -> None:
        """Power off (see `payload.build_turn_off_payload` for the group rule)."""
        await self.coordinator.async_command(
            build_turn_off_payload(self._target_ids, is_group=self._is_group)
        )
