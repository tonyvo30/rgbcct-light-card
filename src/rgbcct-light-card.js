import { renderCard } from "./render.js";
import { setupEvents } from "./events.js";
import { updateWLED } from "./wled.js";
import { addStyles } from "./styles.js";


class RGBCTLightCard extends HTMLElement {

  setConfig(config) {

    if (!config.entity) {
      throw new Error("You must define an entity");
    }

    this.config = config;

    this.compact =
      config.compact ?? false;

    // Working colour state (0-255). Populated from the entity
    // in syncFromState() once hass is available.
    this.bri = this.bri ?? 255;
    this.r = this.r ?? 255;
    this.g = this.g ?? 255;
    this.b = this.b ?? 255;
    this.w = this.w ?? 0;
    this.cct = this.cct ?? 127;

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
      [this.r, this.g, this.b, this.w] = attr.rgbw_color;
    }
    else if (Array.isArray(attr.rgb_color)) {
      [this.r, this.g, this.b] = attr.rgb_color;
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
    set(this.red, this.r);
    set(this.green, this.g);
    set(this.blue, this.b);
    set(this.white, this.w);
    set(this.cctInput, this.cct);

    this.updateReadouts();

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
    text("#r-val", this.r);
    text("#g-val", this.g);
    text("#b-val", this.b);
    text("#w-val", this.w);
    text("#cct-val", this.cct);

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
