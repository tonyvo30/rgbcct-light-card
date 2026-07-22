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
  const c = Math.min(1, Math.max(0, s));
  return c * c * SAT_FULL_RADIUS;
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
    const f = i / 20;
    const alpha = (1 - radiusToSat(f)).toFixed(3);
    stops.push(`rgba(255, 255, 255, ${alpha}) ${Math.round(f * 100)}%`);
  }

  return `radial-gradient(circle at center, ${stops.join(', ')})`;
}

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;

  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;

    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;

  return [h, s, max];
}
