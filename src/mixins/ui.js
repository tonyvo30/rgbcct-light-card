// The card's DOM-update methods, mixed into the card's prototype: pushing
// the working state into the sliders/wheel and refreshing the readouts,
// gradient tracks, header swatch, and children. Kept separate from the
// state logic so the "what to show" lives apart from the "what is true".

import { satToRadius, hueConicGradient } from '../color.js';

export const uiMixin = {
  // Push current state into the sliders (skipping any control
  // the user is actively dragging) and refresh the readouts.
  updateUI() {
    const setValue = (element, value) => {
      if (element && element !== document.activeElement) {
        element.value = value;
      }
    };

    setValue(this.brightness, this.bri);
    setValue(this.value, Math.round(this.v * 255));
    setValue(this.white, this.w);
    setValue(this.cctInput, this.cct);

    // Skip while the user is dragging the wheel so we don't
    // fight the handle they're moving.
    if (!this._wheelActive) {
      this.updateWheel();
    }

    this.updateReadouts();
  },

  // Place the wheel handle (angle = hue, distance from centre =
  // saturation) to match the CSS disc: red at the top, hue
  // increasing clockwise. Also dim the whole disc by value.
  updateWheel() {
    const wheel = this.wheel;
    const handle = this.wheelHandle;

    if (!wheel || !handle) return;

    const maxRadius = (wheel.clientWidth || 180) / 2;
    const frac = typeof this.satR === 'number' ? this.satR : satToRadius(this.s);
    const radius = frac * maxRadius;
    const radians = (this.h * Math.PI) / 180;

    handle.style.left = maxRadius + radius * Math.sin(radians) + 'px';
    handle.style.top = maxRadius - radius * Math.cos(radians) + 'px';

    if (this.wheelShade) {
      this.wheelShade.style.opacity = (1 - this.v).toFixed(3);
    }
  },

  // Orchestrator: refresh every readout for the current state. Each
  // concern lives in its own helper below so this reads as a table of
  // contents rather than one long DOM-poking block.
  updateReadouts() {
    if (this.compact) {
      this.updateCompactReadout();
      return;
    }

    this.updateSwatch();
    this.updateTextReadouts();
    this.updateSliderTracks();
    this.updateColorPicker();

    this.updateChildren();

    // A fresh fetch can change which segments are lit; keep the toggle
    // (master = any segment on) in step with it, not just with hass pushes.
    this.syncToggle();
  },

  // Compact view: bulb icon + friendly name + brightness %, plus the
  // power toggle. No colour controls exist in compact mode.
  updateCompactReadout() {
    const state = this._hass?.states?.[this.config.entity];

    const icon = this.querySelector('#icon');
    const name = this.querySelector('#name');
    const summary = this.querySelector('#summary');

    if (icon) icon.setAttribute('icon', 'mdi:lightbulb');
    if (name) {
      name.textContent = state?.attributes?.friendly_name ?? this.config.entity;
    }
    if (summary) {
      summary.textContent = `${Math.round((this.bri / 255) * 100)}%`;
    }

    this.syncToggle();
  },

  // The header swatch normally shows the card's colour (seg 0 on a
  // master). When a master's segments aren't homogeneous, it becomes
  // a rainbow disc instead — an at-a-glance "these differ" cue, paired
  // with the "Mixed" chip for anyone who can't read the colour alone.
  updateSwatch() {
    const mixed = this.isMaster() && this.segmentsAreMixed();

    const swatch = this.querySelector('#swatch');
    if (swatch) {
      swatch.style.background = mixed ? hueConicGradient() : `rgb(${this.r}, ${this.g}, ${this.b})`;
    }

    const badge = this.querySelector('#mixed-badge');
    if (badge) badge.classList.toggle('show', mixed);
  },

  updateTextReadouts() {
    const setText = (id, value) => {
      const element = this.querySelector(id);
      if (element) element.textContent = value;
    };

    setText('#bri-val', this.bri);
    setText('#rgb-val', `${this.r}, ${this.g}, ${this.b}`);
    setText('#v-val', Math.round(this.v * 255));
    setText('#w-val', this.w);
    setText('#cct-val', this.cct);
  },

  // WLED-style gradient tracks. Brightness runs black -> the live
  // colour, Value runs black -> the pure hue, White black -> white,
  // and CCT warm -> cool.
  updateSliderTracks() {
    const setBackground = (element, gradient) => {
      if (element) element.style.background = gradient;
    };

    setBackground(
      this.brightness,
      `linear-gradient(90deg, #000, rgb(${this.r}, ${this.g}, ${this.b}))`,
    );
    setBackground(this.value, `linear-gradient(90deg, #000, hsl(${this.h}, 100%, 50%))`);
    setBackground(this.white, `linear-gradient(90deg, #000, #fff)`);
    setBackground(this.cctInput, `linear-gradient(90deg, #ffb46b, #fff, #a9c8ff)`);
  },

  // Keep the native colour picker seeded with the current colour so it
  // opens on it. Skip while it's focused/open so we don't fight it.
  updateColorPicker() {
    if (this.colorInput && this.colorInput !== document.activeElement) {
      const hex = (channel) =>
        Math.max(0, Math.min(255, Math.round(channel)))
          .toString(16)
          .padStart(2, '0');
      this.colorInput.value = `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
    }
  },
};
