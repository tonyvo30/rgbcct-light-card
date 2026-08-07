"""Pure unit tests for the white+cct <-> cold/warm-white conversion.

This is the boundary that already produced a bug (CCT polarity), so it gets the
most direct coverage: known values + round-trip properties. No Home Assistant.

Note the two *different* round-trip guarantees (see `color.py`):
- the cold/warm **channel values** (what HA stores, what drives the LEDs) survive
  round-tripping to +/-1;
- the derived **cct number** is only well-conditioned when there is enough white
  to encode the cold/warm ratio, so at low white it can drift by ~128/white.
"""

import color
import pytest


def test_warm_end_is_cct_zero():
    # Verified on device: cct=0 is WARM -> all warm white, no cold.
    assert color.white_cct_to_cold_warm(200, 0) == (0, 200)


def test_cold_end_is_cct_255():
    # cct=255 is COLD -> all cold white, no warm.
    assert color.white_cct_to_cold_warm(200, 255) == (200, 0)


def test_neutral():
    assert color.white_cct_to_cold_warm(200, 128) == (100, 100)


def test_inverse_known_values():
    assert color.cold_warm_to_white_cct(0, 200, 127) == (200, 0)  # warm
    assert color.cold_warm_to_white_cct(200, 0, 127) == (200, 255)  # cold
    assert color.cold_warm_to_white_cct(100, 100, 127) == (200, 128)  # neutral


def test_zero_white_preserves_previous_cct():
    # Both whites zero -> temperature indeterminate; keep the previous cct.
    assert color.cold_warm_to_white_cct(0, 0, 200) == (0, 200)


@pytest.mark.parametrize("cold_white", range(0, 256, 15))
@pytest.mark.parametrize("warm_white", range(0, 256, 15))
def test_channel_round_trip_within_one(cold_white, warm_white):
    """The physical guarantee: the cold/warm channels HA stores and that drive
    the LEDs survive HA -> WLED -> HA to +/-1."""
    if cold_white + warm_white > 255:
        # Not reachable from WLED's single 0-255 white channel, so out of scope.
        pytest.skip("cw+ww>255 cannot come back from one white channel")

    white, cct = color.cold_warm_to_white_cct(cold_white, warm_white, 127)
    cold_back, warm_back = color.white_cct_to_cold_warm(white, cct)

    assert abs(cold_back - cold_white) <= 1
    assert abs(warm_back - warm_white) <= 1


@pytest.mark.parametrize("white", range(0, 256, 15))
@pytest.mark.parametrize("cct", range(0, 256, 15))
def test_white_round_trips_within_one(white, cct):
    """White level survives WLED -> HA -> WLED to +/-1 regardless of cct."""
    cold_white, warm_white = color.white_cct_to_cold_warm(white, cct)
    white_back, _ = color.cold_warm_to_white_cct(cold_white, warm_white, cct)
    assert abs(white_back - white) <= 1


@pytest.mark.parametrize("white", range(0, 256, 15))
@pytest.mark.parametrize("cct", range(0, 256, 15))
def test_cct_error_bounded_by_white_resolution(white, cct):
    """cct rides the cold/warm ratio, so its recovered value can drift by up to
    ~128/white (only ~+/-1 once white >= ~128). Documents the low-white limit."""
    cold_white, warm_white = color.white_cct_to_cold_warm(white, cct)
    _, cct_back = color.cold_warm_to_white_cct(cold_white, warm_white, cct)

    if white == 0:
        assert cct_back == cct  # nothing to encode -> previous cct kept
    else:
        assert abs(cct_back - cct) <= 128 / white + 2
