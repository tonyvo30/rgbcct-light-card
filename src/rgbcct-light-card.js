import { renderCard } from './render.js';
import { setupEvents } from './events.js';
import { updateWLED } from './wled.js';
import { addStyles } from './styles.js';
import { hsvToRgb, rgbToHsv, satToRadius, SAT_FULL_RADIUS } from './color.js';
import { syncMixin } from './sync.js';
import { segmentsMixin } from './segments.js';
import { uiMixin } from './ui.js';

// The custom element itself: lifecycle (setConfig / hass / connect), the
// working colour state (HSV <-> r/g/b), and sending to WLED. The bulkier
// concerns live in mixins merged onto the prototype at the bottom:
//   - sync.js      device-state fetch, entity-change triggers, persistence
//   - segments.js  master/segment detection, children list, on/off power
//   - ui.js        the DOM update methods
class RGBCTLightCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) {
      throw new Error('You must define an entity');
    }

    this.config = config;

    this.compact = config.compact ?? false;

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
      // On/off lives on the (reliable) entities, so refresh the children's
      // lit/off state on every push — syncFromState early-returns once the
      // card owns its colour state and wouldn't otherwise re-render them.
      this.updateChildren();
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

    this.applyChildrenOpen();
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

  // Debounced so dragging a slider doesn't spam the service.
  send() {
    // The card now owns its state; remember it so a refresh restores it,
    // and hold off entity->UI sync briefly so a background HA update
    // doesn't overwrite what the user is setting.
    this._stateIsOwned = true;
    this._holdUntil = Date.now() + 2000;
    this.persistState();

    clearTimeout(this._sendTimer);

    this._sendTimer = setTimeout(() => this.updateWLED(), 100);
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

// Merge the concern-specific method groups onto the prototype. They're
// plain method objects, so `this` inside them is the card instance — the
// same as if they were declared in the class body.
Object.assign(
  RGBCTLightCard.prototype,
  syncMixin,
  segmentsMixin,
  uiMixin
);


customElements.define(
  "rgbcct-light-card",
  RGBCTLightCard
);
