"""Builders for the WLED ``/json/state`` POST bodies.

Imports nothing — like `color.py` and `models.py`, this is a dependency-free leaf
so it can be unit-tested on a bare `pytest` with no Home Assistant installed. The
write payload is the other bug-prone boundary (it is what actually reaches the
device), so it earns the same treatment as the parsing and the colour maths.

Colour *conversion* stays in `color.py`; this module takes values already in
WLED's own terms and does one job: decide which keys go on the wire.

**The rule it encodes: only write what the caller asked for.** A group write fans
out across every segment by design (`integration-plan.md`), so any key present is
applied to *all* of them — which makes an unrequested key destructive rather than
merely redundant. A bare `light.turn_on` on the group that carried a colour would
flatten every segment to one colour, destroying per-segment state on the device.
So `col`/`cct` appear only when a colour was supplied, `bri` only when a
brightness was.
"""

from __future__ import annotations

# WLED multiplies its device-level `bri` by each segment's `bri` to get the real
# output, but Home Assistant exposes a single brightness per entity and we map that
# to the *segment* value. Every turn-on therefore pins the device master to full:
# a master lowered in the WLED app would otherwise leave the strip dim with no way
# to recover from HA — "turn on to 100%" would stay dark. Deliberate trade-off: a
# master brightness set in the WLED app does not survive an HA turn-on.
MASTER_BRIGHTNESS_FULL = 255


def build_turn_on_payload(
    segment_ids: list[int],
    *,
    wled_color: tuple[int, int, int, int, int] | None = None,
    brightness: int | None = None,
) -> dict:
    """Build the POST body for a turn-on across ``segment_ids``.

    ``wled_color`` is ``(r, g, b, white, cct)`` already converted into WLED's
    model by `color.cold_warm_to_white_cct`; ``brightness`` is WLED's segment
    ``bri``. ``None`` means "not requested" for either, and that key is then
    omitted so the device keeps what it already had.
    """
    changes: dict = {"on": True}

    if wled_color is not None:
        red, green, blue, white, cct = wled_color
        changes["col"] = [[red, green, blue, white]]
        changes["cct"] = cct

    if brightness is not None:
        changes["bri"] = brightness

    return {
        "on": True,
        "bri": MASTER_BRIGHTNESS_FULL,
        "seg": [{"id": segment_id, **changes} for segment_id in segment_ids],
    }


def build_turn_off_payload(segment_ids: list[int], *, is_group: bool) -> dict:
    """Build the POST body for a turn-off.

    The group clears device power *and* every segment's power — WLED keeps
    per-segment power flags, so clearing only the device would let a stale
    segment flag relight it. A single segment clears just its own flag, leaving
    the device and its siblings alone (the card's Pattern 5 behaviour).
    """
    segments = [{"id": segment_id, "on": False} for segment_id in segment_ids]
    if is_group:
        return {"on": False, "seg": segments}
    return {"seg": segments}
