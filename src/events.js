import { radiusToSat } from './color.js';
import { BRIGHTNESS_CHANNEL, COLOR_CHANNEL } from './wled.js';

export function setupEvents(card) {
  if (card.compact) {
    const element = card.querySelector('.compact-card');

    if (element) {
      element.onclick = () => card.toggleCompact();
    }

    const toggle = card.toggle;

    if (toggle) {
      // Keep flipping the switch from also expanding the card.
      toggle.addEventListener('click', (event) => event.stopPropagation());
      toggle.addEventListener('change', (event) => {
        event.stopPropagation();
        card.setPower(toggle.checked);
      });
    }

    return;
  }

  const bind = (input, property, channel) => {
    if (!input) return;

    input.oninput = () => {
      card[property] = Number(input.value);
      card.updateReadouts();
      card.send(channel);
    };
  };

  // White and CCT are COLOUR edits, not channels of their own: the two encode
  // jointly into `rgbww_color`'s cold/warm pair, so neither can be written
  // without the other. Brightness is genuinely separate — and must stay that
  // way, since on a master it is the one slider that should not repaint the
  // whole strip.
  bind(card.brightness, 'bri', BRIGHTNESS_CHANNEL);
  bind(card.white, 'w', COLOR_CHANNEL);
  bind(card.cctInput, 'cct', COLOR_CHANNEL);

  // Header on/off switch (mirrors the compact view's toggle). The header
  // itself isn't clickable, so no stopPropagation is needed here.
  if (card.toggle) {
    card.toggle.addEventListener('change', () => card.setPower(card.toggle.checked));
  }

  setupWheel(card);
  setupValue(card);
  setupColorInput(card);

  const collapse = card.querySelector('#collapse');

  if (collapse) {
    collapse.onclick = () => card.toggleCompact();
  }

  const childrenToggle = card.querySelector('#children-toggle');

  if (childrenToggle) {
    childrenToggle.onclick = () => card.toggleChildren();
  }
}

// The wheel sets hue (angle) and saturation (distance from centre).
// Orientation matches the CSS disc: red at the top (12 o'clock),
// hue increasing clockwise. Value is left to the Value slider.
function setupWheel(card) {
  const wheel = card.wheel;

  if (!wheel) return;

  const pick = (event) => {
    const rect = wheel.getBoundingClientRect();
    const maxRadius = rect.width / 2;

    const x = event.clientX - rect.left - maxRadius;
    const y = event.clientY - rect.top - maxRadius;

    // Store the actual click radius so the handle tracks the cursor
    // even across the fully-saturated outer band (where saturation
    // alone can't locate it).
    card.satR = Math.min(1, Math.sqrt(x * x + y * y) / maxRadius);
    card.s = radiusToSat(card.satR);

    // Clockwise angle from the top: top = 0deg = hue 0 (red).
    let hue = (Math.atan2(x, -y) * 180) / Math.PI;
    if (hue < 0) hue += 360;
    card.h = hue;

    card.applyHsv();
    card.updateReadouts();
    card.updateWheel();
    card.send(COLOR_CHANNEL);
  };

  wheel.addEventListener('pointerdown', (event) => {
    card._wheelActive = true;
    wheel.setPointerCapture(event.pointerId);
    pick(event);
  });

  wheel.addEventListener('pointermove', (event) => {
    if (card._wheelActive) pick(event);
  });

  // Release is bound to the DOCUMENT, not the wheel.
  //
  // `set hass` can re-render mid-drag, and renderCard() replaces innerHTML — so
  // a listener on the wheel dies with the element it was watching, taking the
  // only thing that clears `_wheelActive` with it. The flag would then stay true
  // forever, and the consequences escalate: syncFromState stops adopting entity
  // state, and the *replacement* wheel's pointermove — which checks only that
  // flag — starts picking colours and writing to the device on mere hover.
  //
  // The document survives any re-render, and also catches a pointerup released
  // outside the wheel. setupEvents runs again on every render, so drop the
  // previous registration first or they accumulate one per render.
  card.releaseWheel ??= () => {
    card._wheelActive = false;
  };
  document.removeEventListener('pointerup', card.releaseWheel);
  document.removeEventListener('pointercancel', card.releaseWheel);
  document.addEventListener('pointerup', card.releaseWheel);
  document.addEventListener('pointercancel', card.releaseWheel);
}

// The Value slider (0-255) scales the colour's HSV value, dimming
// the wheel and the r/g/b we send without touching hue/saturation.
function setupValue(card) {
  const input = card.value;

  if (!input) return;

  input.oninput = () => {
    card.v = Number(input.value) / 255;
    card.applyHsv();
    card.updateReadouts();
    card.updateWheel();
    card.send(COLOR_CHANNEL);
  };
}

// The native <input type="color"> gives the browser's colour picker
// (RGB / HEX / HSL). Its value is a #rrggbb hex, which we feed straight
// into the wheel's HSV state via setRgb().
function setupColorInput(card) {
  const input = card.colorInput;

  if (!input) return;

  // The button sits inside the wheel, so keep its click from also
  // registering as a colour pick on the wheel underneath.
  input.addEventListener('pointerdown', (event) => event.stopPropagation());

  input.oninput = () => {
    const hex = input.value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);

    if ([r, g, b].some(Number.isNaN)) return;

    // setRgb() derives hue/sat/value/handle from the picked colour, so
    // a dim pick lowers the value. updateUI() (not just updateReadouts)
    // moves the Value slider thumb too, so it reflects what was picked
    // instead of appearing stuck at the previous value.
    card.setRgb(r, g, b);
    card.updateUI();
    card.send(COLOR_CHANNEL);
  };
}
