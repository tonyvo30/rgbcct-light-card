"""Pure data model + WLED-JSON parsing (no Home Assistant imports).

Kept free of HA dependencies so the parsing — a historically bug-prone boundary —
can be unit-tested without installing Home Assistant. `coordinator.py` and
`light.py` import these types.

Parsing is deliberately total: WLED frames arrive from the network and a
malformed one must not raise, because the caller cannot tell a parse bug from a
dropped connection once an exception escapes. Anything unrecognised is skipped.
"""

from __future__ import annotations

from dataclasses import dataclass

# Neutral colour temperature: the default when WLED omits `cct`, and the tie-break
# when both white channels are zero (temperature is then indeterminate). Defined
# here rather than in `const.py` because this module must import nothing — that is
# what lets the tests exercise it on a bare `pytest` with no Home Assistant.
DEFAULT_CCT = 127


@dataclass(slots=True)
class SegmentState:
    """One WLED segment's colour/white/brightness/power."""

    segment_id: int
    on: bool
    r: int
    g: int
    b: int
    w: int
    cct: int
    brightness: int


@dataclass(slots=True)
class WledState:
    """Parsed WLED device state the entities read from."""

    on: bool
    segments: list[SegmentState]

    def segment(self, segment_id: int) -> SegmentState | None:
        """Return the segment with this id, or None."""
        return next(
            (segment for segment in self.segments if segment.segment_id == segment_id),
            None,
        )

    def primary_segment(self) -> SegmentState | None:
        """The segment the whole-device group entity reports its colour from.

        **The first segment that is on**, falling back to the first segment when
        none are. The group is "on" whenever *any* segment is lit, so reporting a
        dark segment's stored colour would contradict its own power state — the
        entity would say on/orange while the strip showed pink. WLED keeps a
        segment's colour while it is off, so this is not a theoretical case.

        Still a single real segment, deliberately: averaging would invent a colour
        no segment is showing, and returning None would make the group unusable in
        scenes and automations. When segments differ, the group shows one of them
        and gives no signal that the others differ — Home Assistant's light model
        has no "mixed" concept (the card carries a Mixed badge for exactly this,
        `src/mixins/segments.js`).
        """
        if not self.segments:
            return None
        return next((segment for segment in self.segments if segment.on), self.segments[0])


def _coerce_int(value: object, default: int) -> int:
    """Best-effort int() with a fallback (WLED fields are occasionally absent)."""
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return default


def parse_state(payload: dict) -> WledState:
    """Build a WledState from a /json/state object or a /ws frame.

    Websocket frames wrap the state as ``{"state": {...}, "info": {...}}`` while
    ``GET /json/state`` returns the state object directly; accept either.
    Inactive segment slots (``stop <= start``) are skipped so no phantom entities
    are created for them, as is any entry that is not a JSON object.
    """
    # `.get("state", payload)` alone is not enough: a frame carrying an explicit
    # `"state": null` returns None rather than falling back to the default.
    state = payload.get("state") or payload
    if not isinstance(state, dict):
        state = {}

    raw_segments = state.get("seg")
    if not isinstance(raw_segments, list):
        raw_segments = []

    segments: list[SegmentState] = []
    for index, raw_segment in enumerate(raw_segments):
        if not isinstance(raw_segment, dict):
            continue  # not a segment object

        start = _coerce_int(raw_segment.get("start", 0), 0)
        stop = raw_segment.get("stop")
        if stop is not None and _coerce_int(stop, 0) <= start:
            continue  # unused segment slot

        columns = raw_segment.get("col")
        if not isinstance(columns, list) or not columns:
            columns = [[0, 0, 0, 0]]
        primary = columns[0]
        if not isinstance(primary, (list, tuple)):
            primary = [0, 0, 0, 0]

        segments.append(
            SegmentState(
                segment_id=_coerce_int(raw_segment.get("id", index), index),
                on=bool(raw_segment.get("on", True)),
                r=_coerce_int(primary[0] if len(primary) > 0 else 0, 0),
                g=_coerce_int(primary[1] if len(primary) > 1 else 0, 0),
                b=_coerce_int(primary[2] if len(primary) > 2 else 0, 0),
                w=_coerce_int(primary[3] if len(primary) > 3 else 0, 0),
                cct=_coerce_int(raw_segment.get("cct", DEFAULT_CCT), DEFAULT_CCT),
                brightness=_coerce_int(raw_segment.get("bri", 255), 255),
            )
        )

    return WledState(on=bool(state.get("on", True)), segments=segments)
