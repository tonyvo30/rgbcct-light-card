"""Pure unit tests for the WLED write payloads. No Home Assistant.

The headline case is the C1 regression: a group write fans out to *every*
segment, so any key present in the payload is applied to all of them. A bare
turn-on that carried colour would therefore flatten every segment to segment 0's
colour — destroying per-segment state on the device, not merely mis-rendering it.
These assert on key *absence*, which is the property that matters.
"""

import payload
import pytest


def test_bare_turn_on_writes_no_colour_or_brightness():
    """C1 regression: a plain toggle must not carry colour.

    This is the failure that a UI toggle, a scene or a voice command triggers.
    """
    body = payload.build_turn_on_payload([0, 1, 2], is_group=True)

    for segment in body["seg"]:
        assert "col" not in segment, "bare turn-on must not write colour"
        assert "cct" not in segment, "bare turn-on must not write colour temperature"
        assert "bri" not in segment, "bare turn-on must not write segment brightness"
        assert segment["on"] is True


def test_brightness_only_turn_on_writes_no_colour():
    """C1 regression: a brightness drag on the group must not flatten colours."""
    body = payload.build_turn_on_payload([0, 1], is_group=True, brightness=128)

    for segment in body["seg"]:
        assert segment["bri"] == 128
        assert "col" not in segment
        assert "cct" not in segment


def test_colour_only_turn_on_writes_no_brightness():
    body = payload.build_turn_on_payload([0], is_group=True, wled_color=(10, 20, 30, 40, 100))

    segment = body["seg"][0]
    assert segment["col"] == [[10, 20, 30, 40]]
    assert segment["cct"] == 100
    assert "bri" not in segment


def test_colour_fans_out_to_every_target_when_requested():
    """The fan-out itself is the documented design — only unrequested keys were the bug."""
    body = payload.build_turn_on_payload([0, 1, 2], is_group=True, wled_color=(1, 2, 3, 4, 5))

    assert [segment["id"] for segment in body["seg"]] == [0, 1, 2]
    assert all(segment["col"] == [[1, 2, 3, 4]] for segment in body["seg"])


def test_group_turn_on_powers_device_and_pins_master_brightness():
    """W1: the device-level master is pinned so a low master can't strand HA dark."""
    body = payload.build_turn_on_payload([0], is_group=True)

    assert body["on"] is True
    assert body["bri"] == payload.MASTER_BRIGHTNESS_FULL == 255


def test_segment_turn_on_leaves_device_master_brightness_alone():
    """R1 regression: a segment entity must not write a device-global.

    Master at 40% in the WLED app, then an automation turns segment 1 on — if the
    master were pinned here, every *other* segment would jump to full output. The
    light commanded would not be the light that visibly changed.
    """
    body = payload.build_turn_on_payload([1], is_group=False, brightness=100)

    assert "bri" not in body, "segment turn-on must not set device master brightness"
    assert body["on"] is True, "the device must still be powered on (Pattern 5)"
    assert body["seg"] == [{"id": 1, "on": True, "bri": 100}]


def test_colour_with_no_white_omits_cct():
    """Q1: cct only scales the white channels, so at white=0 it is inert.

    Writing it anyway would change nothing now and silently overwrite each
    segment's stored temperature preference for later.
    """
    body = payload.build_turn_on_payload(
        [0, 1], is_group=True, wled_color=(255, 0, 0, 0, 180)
    )

    for segment in body["seg"]:
        assert segment["col"] == [[255, 0, 0, 0]]
        assert "cct" not in segment, "cct is inert at white=0 and must not be written"


def test_colour_with_white_still_writes_cct():
    """The complement of the above — cct matters the moment any white is lit."""
    body = payload.build_turn_on_payload([0], is_group=True, wled_color=(0, 0, 0, 1, 180))

    assert body["seg"][0]["cct"] == 180


def test_group_turn_off_clears_device_and_every_segment():
    body = payload.build_turn_off_payload([0, 1], is_group=True)

    assert body["on"] is False
    assert body["seg"] == [{"id": 0, "on": False}, {"id": 1, "on": False}]


def test_segment_turn_off_leaves_device_power_alone():
    """Turning one segment off must not darken the whole strip."""
    body = payload.build_turn_off_payload([1], is_group=False)

    assert "on" not in body
    assert body["seg"] == [{"id": 1, "on": False}]


@pytest.mark.parametrize("segment_ids", [[], [0], [0, 1, 2, 3]])
def test_payload_covers_exactly_the_given_targets(segment_ids):
    body = payload.build_turn_on_payload(segment_ids, is_group=True, brightness=10)
    assert [segment["id"] for segment in body["seg"]] == segment_ids
