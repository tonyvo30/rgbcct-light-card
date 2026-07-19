export function setupEvents(card) {

  if (card.compact) {

    const el = card.querySelector(".compact-card");

    if (el) {
      el.onclick = () => card.toggleCompact();
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

  setupWheel(card);
  setupValue(card);


  const collapse = card.querySelector("#collapse");

  if (collapse) {
    collapse.onclick = () => card.toggleCompact();
  }

}


// The wheel sets hue (angle) and saturation (distance from centre),
// matching WLED's iro wheel: red at 3 o'clock, hue increasing
// counter-clockwise. Value is left to the Value slider.
function setupWheel(card) {

  const wheel = card.wheel;

  if (!wheel) return;


  const pick = (ev) => {

    const rect = wheel.getBoundingClientRect();
    const maxR = rect.width / 2;

    const x = ev.clientX - rect.left - maxR;
    const y = ev.clientY - rect.top - maxR;

    card.s = Math.min(1, Math.sqrt(x * x + y * y) / maxR);

    let hue = Math.atan2(-y, x) * 180 / Math.PI;
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
