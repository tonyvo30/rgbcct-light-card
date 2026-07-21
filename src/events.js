import { radiusToSat } from "./color.js";


export function setupEvents(card) {

  if (card.compact) {

    const el = card.querySelector(".compact-card");

    if (el) {
      el.onclick = () => card.toggleCompact();
    }

    const toggle = card.toggle;

    if (toggle) {
      // Keep flipping the switch from also expanding the card.
      toggle.addEventListener("click", (e) => e.stopPropagation());
      toggle.addEventListener("change", (e) => {
        e.stopPropagation();
        card.setPower(toggle.checked);
      });
    }

    return;

  }


  const bind = (input, prop) => {

    if (!input) return;

    input.oninput = () => {
      card[prop] = Number(input.value);
      card.updateReadouts();
      card.send();
    };

  };


  bind(card.brightness, "bri");
  bind(card.white, "w");
  bind(card.cctInput, "cct");

  // Header on/off switch (mirrors the compact view's toggle). The header
  // itself isn't clickable, so no stopPropagation is needed here.
  if (card.toggle) {
    card.toggle.addEventListener("change", () =>
      card.setPower(card.toggle.checked)
    );
  }

  setupWheel(card);
  setupValue(card);
  setupColorInput(card);


  const collapse = card.querySelector("#collapse");

  if (collapse) {
    collapse.onclick = () => card.toggleCompact();
  }

  const childrenToggle = card.querySelector("#children-toggle");

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


  const pick = (ev) => {

    const rect = wheel.getBoundingClientRect();
    const maxR = rect.width / 2;

    const x = ev.clientX - rect.left - maxR;
    const y = ev.clientY - rect.top - maxR;

    // Store the actual click radius so the handle tracks the cursor
    // even across the fully-saturated outer band (where saturation
    // alone can't locate it).
    card.satR = Math.min(1, Math.sqrt(x * x + y * y) / maxR);
    card.s = radiusToSat(card.satR);

    // Clockwise angle from the top: top = 0deg = hue 0 (red).
    let hue = Math.atan2(x, -y) * 180 / Math.PI;
    if (hue < 0) hue += 360;
    card.h = hue;

    card.applyHsv();
    card.updateReadouts();
    card.updateWheel();
    card.send();

  };


  wheel.addEventListener("pointerdown", (ev) => {
    card._wheelActive = true;
    wheel.setPointerCapture(ev.pointerId);
    pick(ev);
  });

  wheel.addEventListener("pointermove", (ev) => {
    if (card._wheelActive) pick(ev);
  });

  const release = () => {
    card._wheelActive = false;
  };

  wheel.addEventListener("pointerup", release);
  wheel.addEventListener("pointercancel", release);

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
    card.send();
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
  input.addEventListener("pointerdown", (e) => e.stopPropagation());

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
    card.send();

  };

}
