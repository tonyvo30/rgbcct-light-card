import { renderCard } from "./render.js";
import { setupEvents } from "./events.js";
import { updateWLED } from "./wled.js";
import { addStyles } from "./styles.js";
import { hsvToRgb, rgbToHsv, satToRadius } from "./color.js";


class RGBCTLightCard extends HTMLElement {

  setConfig(config) {

    if (!config.entity) {
      throw new Error("You must define an entity");
    }

    this.config = config;

    this.compact =
      config.compact ?? false;

    // The colour wheel works in HSV (hue 0-360, sat/val 0-1); r/g/b
    // are derived from it and are what actually gets sent to WLED.
    // bri / w / cct stay as plain 0-255 slider values.
    this.bri = this.bri ?? 255;
    this.h = this.h ?? 0;
    this.s = this.s ?? 0;
    this.v = this.v ?? 1;
    this.w = this.w ?? 0;
    this.cct = this.cct ?? 127;

    this.applyHsv();

    this.render();

    if (this._hass) {
      this.syncFromState();
    }

  }


  set hass(hass) {

    this._hass = hass;

    if (this.config) {
      this.syncFromState();
    }

  }

  get hass() {
    return this._hass;
  }


  render() {

    renderCard(this);

    addStyles(this);

    setupEvents(this);

    this.updateUI();

  }


  // Pull current values from the light entity's attributes.
  syncFromState() {

    const state =
      this._hass?.states?.[this.config.entity];

    if (!state) return;

    const attr = state.attributes ?? {};

    if (typeof attr.brightness === "number") {
      this.bri = attr.brightness;
    }

    if (Array.isArray(attr.rgbw_color)) {
      const [r, g, b, w] = attr.rgbw_color;
      this.setRgb(r, g, b);
      this.w = w;
    }
    else if (Array.isArray(attr.rgb_color)) {
      const [r, g, b] = attr.rgb_color;
      this.setRgb(r, g, b);
    }

    if (typeof attr.color_temp_kelvin === "number") {
      const min = attr.min_color_temp_kelvin ?? 2000;
      const max = attr.max_color_temp_kelvin ?? 6535;
      const frac = (attr.color_temp_kelvin - min) / (max - min);
      this.cct = Math.round(
        Math.min(1, Math.max(0, frac)) * 255
      );
    }

    this.updateUI();

  }


  // Push current state into the sliders (skipping any control
  // the user is actively dragging) and refresh the readouts.
  updateUI() {

    const set = (el, val) => {
      if (el && el !== document.activeElement) {
        el.value = val;
      }
    };

    set(this.brightness, this.bri);
    set(this.value, Math.round(this.v * 255));
    set(this.white, this.w);
    set(this.cctInput, this.cct);

    // Skip while the user is dragging the wheel so we don't
    // fight the handle they're moving.
    if (!this._wheelActive) {
      this.updateWheel();
    }

    this.updateReadouts();

  }


  // Derive r/g/b (what we send to WLED) from the working HSV state.
  applyHsv() {
    [this.r, this.g, this.b] = hsvToRgb(this.h, this.s, this.v);
  }


  // Adopt an external r/g/b (from the entity) into the HSV state.
  // Hue is only trusted when there's saturation, and saturation only
  // when there's value, so a dark/greyed light doesn't wipe the
  // remembered wheel position.
  setRgb(r, g, b) {

    this.r = r;
    this.g = g;
    this.b = b;

    const [h, s, v] = rgbToHsv(r, g, b);

    this.v = v;
    if (v > 0) this.s = s;
    if (v > 0 && s > 0) this.h = h;

  }


  // Place the wheel handle (angle = hue, distance from centre =
  // saturation) to match the CSS disc: red at the top, hue
  // increasing clockwise. Also dim the whole disc by value.
  updateWheel() {

    const wheel = this.wheel;
    const handle = this.wheelHandle;

    if (!wheel || !handle) return;

    const maxR = (wheel.clientWidth || 180) / 2;
    const radius = satToRadius(this.s) * maxR;
    const rad = this.h * Math.PI / 180;

    handle.style.left = (maxR + radius * Math.sin(rad)) + "px";
    handle.style.top = (maxR - radius * Math.cos(rad)) + "px";

    if (this.wheelShade) {
      this.wheelShade.style.opacity = (1 - this.v).toFixed(3);
    }

  }


  updateReadouts() {

    if (this.compact) {

      const state =
        this._hass?.states?.[this.config.entity];

      const icon = this.querySelector("#icon");
      const name = this.querySelector("#name");
      const summary = this.querySelector("#summary");

      if (icon) icon.setAttribute("icon", "mdi:lightbulb");
      if (name) {
        name.textContent =
          state?.attributes?.friendly_name ?? this.config.entity;
      }
      if (summary) {
        summary.textContent =
          `${Math.round((this.bri / 255) * 100)}%`;
      }

      return;

    }

    const swatch = this.querySelector("#swatch");
    if (swatch) {
      swatch.style.background = `rgb(${this.r}, ${this.g}, ${this.b})`;
    }

    const text = (id, val) => {
      const el = this.querySelector(id);
      if (el) el.textContent = val;
    };

    text("#bri-val", this.bri);
    text("#rgb-val", `${this.r}, ${this.g}, ${this.b}`);
    text("#v-val", Math.round(this.v * 255));
    text("#w-val", this.w);
    text("#cct-val", this.cct);

    // WLED-style gradient tracks. Brightness runs black -> the live
    // colour, Value runs black -> the pure hue, White black -> white,
    // and CCT warm -> cool.
    const bg = (el, gradient) => {
      if (el) el.style.background = gradient;
    };

    bg(this.brightness,
      `linear-gradient(90deg, #000, rgb(${this.r}, ${this.g}, ${this.b}))`);
    bg(this.value,
      `linear-gradient(90deg, #000, hsl(${this.h}, 100%, 50%))`);
    bg(this.white,
      `linear-gradient(90deg, #000, #fff)`);
    bg(this.cctInput,
      `linear-gradient(90deg, #ffb46b, #fff, #a9c8ff)`);

  }


  // Debounced so dragging a slider doesn't spam the service.
  send() {

    clearTimeout(this._sendTimer);

    this._sendTimer = setTimeout(
      () => this.updateWLED(),
      100
    );

  }


  async updateWLED() {

    if (!this._hass) return;

    // Re-derive r/g/b from the wheel's HSV state right before
    // sending, so the payload handed to the "send wled with cct"
    // script always carries the current colour — never a stale
    // r/g/b from a code path that forgot to call applyHsv().
    this.applyHsv();

    await updateWLED(this);

  }


  toggleCompact() {

    this.compact = !this.compact;

    this.render();

  }


  getCardSize() {
    return this.compact ? 1 : 4;
  }

}


customElements.define(
  "rgbcct-light-card",
  RGBCTLightCard
);
