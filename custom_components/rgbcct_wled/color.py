"""Channel conversion between WLED's white+cct model and HA's RGBWW model.

Home Assistant's `light` entity cannot hold RGB and colour-temperature at once
(the color modes are mutually exclusive). We sidestep that with
`ColorMode.RGBWW`, which carries r, g, b, cold-white and warm-white — encoding
colour temperature as the cold/warm *ratio* and white level as their *sum*.

WLED, by contrast, stores a single white channel `w` (0-255) plus a separate
`cct` (0-255). This module is the one place the two models meet.

**Polarity (verified on device):** WLED `cct=0` is WARM (~2000 K) and `cct=255`
is COLD (~6500 K). So cold-white grows with `cct`, warm-white as `cct` falls.
HA `rgbww_color` orders the whites as (..., cold_white, warm_white).

Fidelity has two parts (see tests/test_color.py):
- the **channel values** (r, g, b, cold_white, warm_white) — what HA stores and
  what drives the LEDs — round-trip to +/-1 (`cw + ww` ~= `w` <= 255, no clamping);
- the derived **cct number**, however, is encoded in the cold/warm *ratio*, which
  has only `white` levels of resolution. So the recovered cct can drift by up to
  ~128/white — negligible physically (it scales with how little white is lit) and
  <= ~1 once white >= ~128, but it means a low-white cct readback is approximate.

This mirrors the JavaScript pair in `src/color.js` (`whiteCctToColdWarm` /
`coldWarmToWhiteCct`) so both sides of the boundary agree.
"""

from __future__ import annotations


def white_cct_to_cold_warm(white: int, cct: int) -> tuple[int, int]:
    """Map WLED (white 0-255, cct 0-255) -> HA (cold_white, warm_white)."""
    cold_white = round(white * cct / 255)
    warm_white = round(white * (255 - cct) / 255)
    return cold_white, warm_white


def cold_warm_to_white_cct(
    cold_white: int, warm_white: int, previous_cct: int
) -> tuple[int, int]:
    """Map HA (cold_white, warm_white) -> WLED (white 0-255, cct 0-255).

    When both whites are zero the temperature is indeterminate, so the previous
    `cct` is preserved rather than snapping to an arbitrary value (mirrors how
    the card keeps hue when value is zero).
    """
    white = min(255, cold_white + warm_white)
    total = cold_white + warm_white
    cct = round(cold_white / total * 255) if total > 0 else previous_cct
    return white, cct
