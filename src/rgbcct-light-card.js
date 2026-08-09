import { renderCard } from './render.js';
import { setupEvents } from './events.js';
import { updateWLED } from './wled.js';
import { addStyles } from './styles.js';
import { hsvToRgb, rgbToHsv, satToRadius, SAT_FULL_RADIUS } from './color.js';
import { syncMixin } from './mixins/sync.js';
import { segmentsMixin } from './mixins/segments.js';
import { uiMixin } from './mixins/ui.js';

// The custom element itself: lifecycle (setConfig / hass), the working colour
// state (HSV <-> r/g/b), and sending to WLED. The bulkier concerns live in
// mixins merged onto the prototype at the bottom:
//   - mixins/sync.js      reading the entity's attributes into card state
//   - mixins/segments.js  master/segment detection, children list, on/off power
//   - mixins/ui.js        the DOM update methods
class RGBCCTLightCard extends HTMLElement {
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

    // No localStorage restore: the entity now reports the device's true state
    // and `hass.states` is already populated when the card is configured, so
    // there is no gap for a remembered value to cover. Restoring one would be
    // worse than useless — the old code marked such state as card-owned, which
    // suppressed the entity read entirely.

    this.applyHsv();

    this.render();

    if (this._hass) this.syncFromState();
  }

  set hass(hass) {
    this._hass = hass;

    // Every device change arrives here: HA pushes the updated entity to all
    // connected frontends, so this is the card's only sync path. syncFromState
    // ends in updateUI(), which refreshes the toggle and the master's children
    // list too — including while the interaction guards are holding, so those
    // stay live during a drag.
    if (!this.config) return;

    // Master-ness comes from an entity attribute (see isMaster), which does not
    // exist yet at setConfig time — HA sets `hass` after it. Re-render once if
    // the first pass got it wrong; the layouts differ by the children section.
    if (this._renderedAsMaster !== this.isMaster()) this.render();

    this.syncFromState();
  }

  get hass() {
    return this._hass;
  }

  // No connectedCallback: there is nothing to start. State arrives via
  // `set hass`, which HA calls on attach and on every subsequent change — the
  // poll timer, the direct WLED socket and the visibilitychange handler that
  // released it all went with the doorbell.
  disconnectedCallback() {
    // Cancel a pending send-debounce, so a card removed within the 100ms window
    // after an edit doesn't fire updateWLED() from a detached element
    // (updateWLED only checks _hass, which is still set).
    clearTimeout(this._sendTimer);
    this._sendTimer = null;
  }

  render() {
    // Remember which layout was built, so `set hass` can tell when the answer
    // has changed and this needs redoing.
    this._renderedAsMaster = this.isMaster();

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
    // Hold off entity->UI sync briefly: the write has to reach WLED and come
    // back through the coordinator, and an intervening push still carries the
    // pre-edit state, which would snap the control the user just moved.
    this._holdUntil = Date.now() + 2000;

    clearTimeout(this._sendTimer);

    this._sendTimer = setTimeout(() => this.updateWLED(), 100);
  }

  async updateWLED() {
    if (!this._hass) return;

    // Re-derive r/g/b from the wheel's HSV state right before sending, so the
    // service call always carries the current colour — never a stale r/g/b
    // from a code path that forgot to call applyHsv().
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
Object.assign(RGBCCTLightCard.prototype, syncMixin, segmentsMixin, uiMixin);

customElements.define('rgbcct-light-card', RGBCCTLightCard);

// Announce the loaded build in the console — the standard HA custom-card
// convention, so users can report which version they're running.
// `__CARD_VERSION__` is replaced with package.json's version at build time
// by Vite's `define` (see vite.config.js).
console.info(
  `%c RGBCCT-LIGHT-CARD %c v${__CARD_VERSION__} `,
  'color: #fff; background: #3b82f6; font-weight: 700; padding: 2px 4px; border-radius: 3px 0 0 3px;',
  'color: #3b82f6; background: #1f2937; padding: 2px 4px; border-radius: 0 3px 3px 0;',
);
