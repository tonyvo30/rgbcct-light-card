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

  let r = 0, g = 0, b = 0;

  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }

  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255)
  ];

}


export function rgbToHsv(r, g, b) {

  r /= 255; g /= 255; b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;

  if (d !== 0) {
    if (max === r)      h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else                h = (r - g) / d + 4;

    h *= 60;
    if (h < 0) h += 360;
  }

  const s = max === 0 ? 0 : d / max;

  return [h, s, max];

}
