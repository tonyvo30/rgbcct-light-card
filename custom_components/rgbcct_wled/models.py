"""Pure data model + WLED-JSON parsing (no Home Assistant imports).

Kept free of HA dependencies so the parsing — a historically bug-prone boundary —
can be unit-tested without installing Home Assistant. `coordinator.py` and
`light.py` import these types.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class SegmentState:
    """One WLED segment's colour/white/brightness/power."""

    seg_id: int
    on: bool
    r: int
    g: int
    b: int
    w: int
    cct: int
    bri: int


@dataclass(slots=True)
class WledState:
    """Parsed WLED device state the entities read from."""

    on: bool
    segments: list[SegmentState]

    def segment(self, seg_id: int) -> SegmentState | None:
        """Return the segment with this id, or None."""
        return next((seg for seg in self.segments if seg.seg_id == seg_id), None)


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
    are created for them.
    """
    state = payload.get("state", payload)
    segments: list[SegmentState] = []

    for index, seg in enumerate(state.get("seg", [])):
        start = _coerce_int(seg.get("start", 0), 0)
        stop = seg.get("stop")
        if stop is not None and _coerce_int(stop, 0) <= start:
            continue  # unused segment slot

        columns = seg.get("col") or [[0, 0, 0, 0]]
        primary = columns[0] if columns else [0, 0, 0, 0]

        segments.append(
            SegmentState(
                seg_id=_coerce_int(seg.get("id", index), index),
                on=bool(seg.get("on", True)),
                r=_coerce_int(primary[0] if len(primary) > 0 else 0, 0),
                g=_coerce_int(primary[1] if len(primary) > 1 else 0, 0),
                b=_coerce_int(primary[2] if len(primary) > 2 else 0, 0),
                w=_coerce_int(primary[3] if len(primary) > 3 else 0, 0),
                cct=_coerce_int(seg.get("cct", 127), 127),
                bri=_coerce_int(seg.get("bri", 255), 255),
            )
        )

    return WledState(on=bool(state.get("on", True)), segments=segments)
