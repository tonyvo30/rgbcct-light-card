"""Pure unit tests for WLED-JSON parsing. No Home Assistant."""

import models


def test_parse_basic_state():
    payload = {
        "on": True,
        "seg": [
            {"id": 0, "on": True, "col": [[10, 20, 30, 40]], "cct": 100, "bri": 200, "start": 0, "stop": 10}
        ],
    }
    state = models.parse_state(payload)

    assert state.on is True
    assert len(state.segments) == 1
    segment = state.segments[0]
    assert (segment.r, segment.g, segment.b, segment.w) == (10, 20, 30, 40)
    assert segment.cct == 100
    assert segment.brightness == 200
    assert segment.on is True


def test_parse_websocket_wrapper_and_defaults():
    # A /ws frame wraps state; a 3-element col has no white; missing cct/bri default.
    payload = {"state": {"on": False, "seg": [{"id": 0, "col": [[1, 2, 3]]}]}, "info": {}}
    state = models.parse_state(payload)

    assert state.on is False
    segment = state.segments[0]
    assert (segment.r, segment.g, segment.b, segment.w) == (1, 2, 3, 0)
    assert segment.cct == 127
    assert segment.brightness == 255


def _segment(segment_id, *, on, r):
    return models.SegmentState(
        segment_id=segment_id, on=on, r=r, g=0, b=0, w=0, cct=127, brightness=255
    )


def test_primary_segment_prefers_the_first_lit_one():
    # Regression (found on hardware): with segment 0 off the group entity reported
    # segment 0's stored colour, so it showed "on" in one segment's colour while
    # actually displaying another's. WLED keeps a segment's colour while it is off.
    state = models.WledState(on=True, segments=[_segment(0, on=False, r=255), _segment(1, on=True, r=10)])
    assert state.primary_segment().segment_id == 1

    state = models.WledState(on=True, segments=[_segment(0, on=True, r=255), _segment(1, on=True, r=10)])
    assert state.primary_segment().segment_id == 0


def test_primary_segment_falls_back_when_nothing_is_lit():
    # No segment is a truthful answer, but None would make the group unusable in
    # scenes; the first segment keeps the reading stable and deterministic.
    state = models.WledState(on=False, segments=[_segment(0, on=False, r=255), _segment(1, on=False, r=10)])
    assert state.primary_segment().segment_id == 0

    assert models.WledState(on=False, segments=[]).primary_segment() is None


def test_inactive_segments_are_skipped():
    payload = {
        "seg": [
            {"id": 0, "start": 0, "stop": 10, "col": [[0, 0, 0, 0]]},
            {"id": 1, "start": 0, "stop": 0},  # unused slot
        ]
    }
    state = models.parse_state(payload)
    assert [segment.segment_id for segment in state.segments] == [0]


def test_segment_lookup():
    payload = {"seg": [{"id": 3, "col": [[0, 0, 0, 0]], "stop": 5}]}
    state = models.parse_state(payload)
    assert state.segment(3) is not None
    assert state.segment(99) is None
