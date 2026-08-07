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
    assert segment.bri == 200
    assert segment.on is True


def test_parse_websocket_wrapper_and_defaults():
    # A /ws frame wraps state; a 3-element col has no white; missing cct/bri default.
    payload = {"state": {"on": False, "seg": [{"id": 0, "col": [[1, 2, 3]]}]}, "info": {}}
    state = models.parse_state(payload)

    assert state.on is False
    segment = state.segments[0]
    assert (segment.r, segment.g, segment.b, segment.w) == (1, 2, 3, 0)
    assert segment.cct == 127
    assert segment.bri == 255


def test_inactive_segments_are_skipped():
    payload = {
        "seg": [
            {"id": 0, "start": 0, "stop": 10, "col": [[0, 0, 0, 0]]},
            {"id": 1, "start": 0, "stop": 0},  # unused slot
        ]
    }
    state = models.parse_state(payload)
    assert [segment.seg_id for segment in state.segments] == [0]


def test_segment_lookup():
    payload = {"seg": [{"id": 3, "col": [[0, 0, 0, 0]], "stop": 5}]}
    state = models.parse_state(payload)
    assert state.segment(3) is not None
    assert state.segment(99) is None
