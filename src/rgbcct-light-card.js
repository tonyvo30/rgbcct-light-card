import { renderCard } from "./render.js";
import { setupEvents } from "./events.js";
import { updateWLED } from "./wled.js";
import { addStyles } from "./styles.js";
import { hsvToRgb, rgbToHsv, satToRadius, SAT_FULL_RADIUS } from "./color.js";


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

    // Handle radius fraction (0-1). Decoupled from saturation so the
    // handle can sit anywhere in the fully-saturated outer band.
    this.satR = this.satR ?? satToRadius(this.s);

    // The HA entity can't faithfully report the multi-channel state we
    // write raw to WLED, so on load we restore the last state this card
    // sent. If found, the card owns its state and won't be overwritten
    // by the (lossy) entity read-back.
    this.restoreState();

    this.applyHsv();

    this.render();

    if (this._hass) {
      this.fetchStateOnce();
      this.syncFromState();
    }

  }


  set hass(hass) {

    this._hass = hass;

    if (this.config) {
      this.fetchStateOnce();
      this.syncFromState();
      this.syncToggle();
      this.syncOnEntityChange();
    }

  }

  get hass() {
    return this._hass;
  }


  connectedCallback() {

    // Poll the true /json/state as a fallback. The entity-change trigger
    // handles CCT/brightness instantly, but colour changes never surface
    // on the (color_temp-mode) entity, so nothing else would ever pull a
    // sibling/other-device colour change in. Guarded so it never fights
    // an active edit, and throttled so it can't stack with triggers.
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (!this._hass || !this.config) return;
      if (this._wheelActive || Date.now() < (this._holdUntil || 0)) return;
      this.refetchThrottled();
    }, 3000);

  }


  disconnectedCallback() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    clearTimeout(this._refetchTimer);
    this._refetchTimer = null;
  }


  render() {

    renderCard(this);

    addStyles(this);

    setupEvents(this);

    this.updateUI();

  }

  fetchStateOnce() {

    if (this._fetched || !this._hass || !this.config) return;

    this._fetched = true;
    this.fetchWledState();

  }


  // Ask the "get wled with cct" HA script for the device's live state
  // and adopt it. This is the true source of truth (reflects changes
  // made outside the card); localStorage/entity are only fallbacks used
  // until this resolves, or if WLED/the script is unreachable.
  async fetchWledState() {

    if (!this._hass) return;

    // Only one fetch in flight; if another is requested meanwhile, run
    // it once this one finishes (so a change during the request isn't
    // lost).
    if (this._fetching) {
      this._refetchQueued = true;
      return;
    }

    this._fetching = true;
    this._lastFetchAt = Date.now();

    try {

      const res = await this._hass.callWS({
        type: "call_service",
        domain: "script",
        service: "get_wled_with_cct",
        service_data: { light_entity: this.config.entity },
        return_response: true
      });

      const d = res?.response;
      if (!d) return;

      // The user may have started interacting while this was in flight;
      // if so, their input wins — drop the fetched result.
      if (this._wheelActive || Date.now() < (this._holdUntil || 0)) return;

      const n = (val, fallback) => {
        const x = Number(val);
        return Number.isFinite(x) ? x : fallback;
      };

      this.bri = n(d.bri, this.bri);
      this.w = n(d.w, this.w);
      this.cct = n(d.cct, this.cct);
      this.setRgb(n(d.r, this.r), n(d.g, this.g), n(d.b, this.b));

      // Live device state wins over the lossy entity read-back.
      this._stateIsOwned = true;
      this.persistState();
      this.updateUI();

    }
    catch (e) {
      // WLED offline or the get script isn't set up — keep whatever
      // localStorage/the entity gave us.
    }
    finally {
      this._fetching = false;
      if (this._refetchQueued) {
        this._refetchQueued = false;
        this.refetchThrottled();
      }
    }

  }


  // Entities whose HA state changes should make this card re-read the
  // live device state: the whole WLED device (group entity + every
  // segment entity), so a change surfaced on any of them triggers a
  // re-fetch. NOTE: this only catches CCT/brightness — because the
  // light sits in color_temp mode (we always send cct), HA never
  // surfaces rgb changes on any of these entities, so pure colour
  // changes are caught by the poll fallback, not this trigger.
  watchedEntities() {

    const e = this.config.entity;
    const base = e.includes("_segment_") ? e.split("_segment_")[0] : e;

    const states = this._hass?.states || {};
    const ids = Object.keys(states).filter(
      (k) => k === base || k.startsWith(base + "_segment_")
    );

    return ids.length ? ids : [e];

  }


  // HA pushes entity updates to every connected frontend, so when the
  // device changes anywhere (a sibling card, the WLED app, another
  // dashboard, even another device) the watched entity's last_updated
  // moves. Use that as a trigger to re-read the true /json/state — the
  // entity attributes themselves are too lossy to adopt directly.
  syncOnEntityChange() {

    // The initial load is handled by fetchStateOnce().
    if (!this._fetched) return;

    this._lastSeen = this._lastSeen || {};

    let changed = false;

    for (const id of this.watchedEntities()) {
      const lu = this._hass?.states?.[id]?.last_updated;
      if (!lu) continue;

      // Only a move from a previously-seen value counts (skip the first
      // sighting so we don't re-fetch immediately after the initial one).
      if (this._lastSeen[id] !== undefined && lu !== this._lastSeen[id]) {
        changed = true;
      }
      this._lastSeen[id] = lu;
    }

    if (!changed) return;

    // Don't fight the user: skip while dragging or inside the post-edit
    // hold window (the client making the change already has the state;
    // idle clients re-fetch and reflect it).
    if (this._wheelActive || Date.now() < (this._holdUntil || 0)) return;

    this.refetchThrottled();

  }


  // Coalesce bursts of entity updates into at most one /json/state read
  // per REFETCH_MIN_MS, re-checking the interaction guards at fire time.
  refetchThrottled() {

    const MIN = 1500;
    const wait = MIN - (Date.now() - (this._lastFetchAt || 0));

    if (wait <= 0) {
      this.fetchWledState();
      return;
    }

    if (this._refetchTimer) return;

    this._refetchTimer = setTimeout(() => {
      this._refetchTimer = null;
      if (!this._wheelActive && Date.now() >= (this._holdUntil || 0)) {
        this.fetchWledState();
      }
    }, wait);

  }


  // localStorage key for this entity's remembered state.
  storeKey() {
    return `rgbcct-light-card:${this.config.entity}`;
  }


  // Restore the last state this card sent (survives page refreshes).
  restoreState() {

    try {
      const raw = localStorage.getItem(this.storeKey());
      if (!raw) return;

      const s = JSON.parse(raw);
      const num = (v) => typeof v === "number" && isFinite(v);

      if (num(s.h)) this.h = s.h;
      if (num(s.s)) this.s = s.s;
      if (num(s.v)) this.v = s.v;
      if (num(s.satR)) this.satR = s.satR;
      if (num(s.bri)) this.bri = s.bri;
      if (num(s.w)) this.w = s.w;
      if (num(s.cct)) this.cct = s.cct;

      // We have our own state now; the entity read-back must not stomp it.
      this._stateIsOwned = true;
    }
    catch (e) {
      // localStorage unavailable (private mode etc.) — just skip.
    }

  }


  // Remember the current state so a refresh can restore it.
  persistState() {

    try {
      localStorage.setItem(this.storeKey(), JSON.stringify({
        h: this.h,
        s: this.s,
        v: this.v,
        satR: this.satR,
        bri: this.bri,
        w: this.w,
        cct: this.cct
      }));
    }
    catch (e) {
      // Ignore write failures.
    }

  }


  // Pull current values from the light entity's attributes.
  syncFromState() {

    const state =
      this._hass?.states?.[this.config.entity];

    if (!state) return;

    // Once the card has its own remembered/edited state it's the source
    // of truth (the entity read-back is lossy for our raw WLED writes).
    // Also skip while the user is interacting (or just did), so a
    // background HA push doesn't snap controls back (e.g. brightness 255).
    if (this._stateIsOwned || this._wheelActive || Date.now() < (this._holdUntil || 0)) return;

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

    if (v > 0) {
      this.s = s;

      // Keep the handle radius consistent. In the fully-saturated
      // outer band any radius >= SAT_FULL_RADIUS is valid, so keep the
      // handle where it is if it's already out there; otherwise derive
      // it from the saturation curve.
      if (s >= 1) {
        if (!(this.satR >= SAT_FULL_RADIUS)) this.satR = 1;
      } else {
        this.satR = satToRadius(s);
      }
    }

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
    const frac = (typeof this.satR === "number") ? this.satR : satToRadius(this.s);
    const radius = frac * maxR;
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

      this.syncToggle();

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

    // Keep the native colour picker seeded with the current colour so
    // it opens on it. Skip while it's focused/open so we don't fight it.
    if (this.colorInput && this.colorInput !== document.activeElement) {
      const hex = (v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0");
      this.colorInput.value = `#${hex(this.r)}${hex(this.g)}${hex(this.b)}`;
    }

  }


  // Debounced so dragging a slider doesn't spam the service.
  send() {

    // The card now owns its state; remember it so a refresh restores it,
    // and hold off entity->UI sync briefly so a background HA update
    // doesn't overwrite what the user is setting.
    this._stateIsOwned = true;
    this._holdUntil = Date.now() + 2000;
    this.persistState();

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


  // Turn the light on/off via the standard HA light service (the WLED
  // integration handles it). On/off is a reliable entity state, so
  // unlike colour it doesn't go through the send-wled script.
  setPower(on) {

    if (!this._hass) return;

    this._hass.callService(
      "light",
      on ? "turn_on" : "turn_off",
      { entity_id: this.config.entity }
    );

  }


  // Reflect the entity's live on/off state on the compact toggle.
  // Read straight from the entity (not gated by _stateIsOwned) because
  // on/off is accurate there, unlike the lossy colour read-back.
  syncToggle() {

    const toggle = this.toggle;

    if (!toggle || toggle === document.activeElement) return;

    const state = this._hass?.states?.[this.config.entity];

    toggle.checked = state?.state === "on";

  }


  getCardSize() {
    return this.compact ? 1 : 4;
  }

}


customElements.define(
  "rgbcct-light-card",
  RGBCTLightCard
);
