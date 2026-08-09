// Colour-space helpers shared by the wheel picker (events.js) and
// the handle positioning (rgbcct-light-card.js).
//
// The wheel maps angle -> hue and distance-from-centre -> saturation,
// with value fixed at 1. Overall dimming is handled by the separate
// Brightness slider, so colours coming off the wheel are always full
// value.

export function hsvToRgb(h, s, v) {
  h = ((h % 360) + 360) % 360;

  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;

  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// Saturation curve for the wheel. Radius fraction (0 at centre, 1 at
// the rim) maps to saturation with a small white core, reaching full
// saturation at SAT_FULL_RADIUS and staying there to the edge — a
// wide, vivid pure-colour band like WLED. Because the outer band is
// all fully saturated, saturation alone can't say where in it the
// handle sits; the wheel stores the picked radius separately (satR)
// so the handle still tracks the cursor to the rim. satToRadius() is
// the best-effort inverse used only when adopting an external colour.
export const SAT_FULL_RADIUS = 0.6;

export function radiusToSat(frac) {
  return Math.min(1, Math.sqrt(Math.min(1, Math.max(0, frac)) / SAT_FULL_RADIUS));
}

export function satToRadius(s) {
  const clamped = Math.min(1, Math.max(0, s));
  return clamped * clamped * SAT_FULL_RADIUS;
}

// The rainbow hue ring used as the wheel's base and, on a master card,
// as the header swatch when its segments aren't all the same colour —
// an instantly-readable "mixed" cue. Shared so both stay in sync.
export function hueConicGradient() {
  return `conic-gradient(
    hsl(0, 100%, 50%),
    hsl(60, 100%, 50%),
    hsl(120, 100%, 50%),
    hsl(180, 100%, 50%),
    hsl(240, 100%, 50%),
    hsl(300, 100%, 50%),
    hsl(360, 100%, 50%)
  )`;
}

// White-overlay radial gradient (painted over the conic hue wheel)
// whose alpha at each radius is 1 - sat, so the displayed colour
// matches radiusToSat() exactly.
export function wheelWhiteGradient() {
  const stops = [];

  for (let i = 0; i <= 20; i++) {
    const frac = i / 20;
    const alpha = (1 - radiusToSat(frac)).toFixed(3);
    stops.push(`rgba(255, 255, 255, ${alpha}) ${Math.round(frac * 100)}%`);
  }

  return `radial-gradient(circle at center, ${stops.join(', ')})`;
}

// -- the white/cct <-> cold/warm boundary --------------------------------
//
// The card thinks in WLED's model: one white channel `w` (0-255) plus a
// separate `cct` (0-255). Home Assistant's RGBWW light carries cold-white and
// warm-white instead, encoding temperature as their *ratio* and white level as
// their *sum* — which is what lets one entity hold colour and temperature at
// once (`color_temp` mode cannot, and that lossiness is why the card used to
// bypass the entity entirely).
//
// Polarity, verified on device: WLED cct=0 is WARM (~2000 K), cct=255 is COLD
// (~6500 K). HA orders rgbww_color as (r, g, b, cold_white, warm_white).
//
// These mirror `white_cct_to_cold_warm` / `cold_warm_to_white_cct` in
// custom_components/rgbcct_wled/color.py so both sides of the boundary agree.
// The integration's copy is the authoritative one (it is what reaches the LEDs);
// this copy exists so the card can write and read the same encoding.
//
// **The round trip is LOSSY, and badly so at low white.** Temperature is carried
// as the cold/warm ratio, so its resolution is the white level: the recovered
// cct can be out by up to ~128/white. Measured through this pair:
//
//     white   1 -> cct 127 comes back as   0   (fully warm)
//     white   3 -> cct 127 comes back as  85
//     white   8 -> worst drift 16
//     white 128 -> worst drift 1
//
// This is not cosmetic. `wled.js` feeds `card.cct` straight back to the device
// on the next edit, so a drifted readback is a *write input* — raise white from
// 0 to 3 at neutral and the CCT slider lurches a sixth of its travel toward
// warm. The old script path kept `w` and `cct` independent and had no such loss,
// so this is a regression introduced by the RGBWW encoding.
//
// The physics is unavoidable in that encoding; adopting the lossy value is not.
// `sync.js` only adopts these whites when they differ from what the card already
// holds — see the consistency check there.
//
// (Separately, and far smaller: this pair can differ from the Python one by 1,
// because Python's round() breaks ties to even and Math.round() breaks them
// upward.)

export function whiteCctToColdWarm(w, cct) {
  return [Math.round((w * cct) / 255), Math.round((w * (255 - cct)) / 255)];
}

// `previousCct` is returned when both whites are zero: with no white lit the
// temperature is indeterminate, and snapping the slider to an arbitrary value
// would lose the user's setting — the same reasoning that keeps hue when value
// is zero in setRgb(). The total is capped at 255 (WLED's single white channel
// cannot hold more) while cct comes from the *uncapped* ratio, so an oversized
// pair scales down proportionally instead of clipping.
export function coldWarmToWhiteCct(coldWhite, warmWhite, previousCct) {
  const total = coldWhite + warmWhite;

  return {
    w: Math.min(255, total),
    cct: total > 0 ? Math.round((coldWhite / total) * 255) : previousCct,
  };
}

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;

  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;

    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : delta / max;

  return [h, s, max];
}
