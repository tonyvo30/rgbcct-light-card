import { renderCard } from './render.js';
import { setupEvents } from './events.js';
import { updateWLED } from './wled.js';
import { addStyles } from './styles.js';
import { hsvToRgb, rgbToHsv, satToRadius, SAT_FULL_RADIUS } from './color.js';
import { syncMixin } from './mixins/sync.js';
import { segmentsMixin } from './mixins/segments.js';
import { uiMixin } from './mixins/ui.js';
import { wledPushIsLive } from './wled-socket.js';

// While the doorbell socket is live it delivers external changes instantly,
// so the poll only re-reads once the last fetch is this stale — a safety
// net, not a sync path. With the socket down, every 3s tick refetches.
const SOCKET_LIVE_POLL_MS = 60000;

// The custom element itself: lifecycle (setConfig / hass / connect), the
// working colour state (HSV <-> r/g/b), and sending to WLED. The bulkier
// concerns live in mixins merged onto the prototype at the bottom:
//   - mixins/sync.js      device-state fetch, entity-change triggers, persistence
//   - mixins/segments.js  master/segment detection, children list, on/off power
//   - mixins/ui.js        the DOM update methods
class RGBCCTLightCard extends HTMLElement {
  setConfig(config) {
    if (!config.entity) {
      throw new Error('You must define an entity');
    }

    // A re-point to a different entity (card-editor preview) must shed the
    // old device's socket and sync state first, or the card keeps listening
    // to the wrong strip.
    if (this.config && this.config.entity !== config.entity) {
      this.resetDeviceSync();
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
    // Tiered poll of the true /json/state. Colour never surfaces on the
    // (color_temp-mode) entity, so whenever the doorbell socket is
    // unavailable (HTTPS page, WLED rebooting, host unresolved) this tick
    // is the only thing that catches an external colour change. It's a
    // standing check, not a mode switch: no live socket -> the original 3s
    // cadence resumes on its own. Guarded and throttled like the triggers.
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (!this._hass || !this.config) return;
      if (this._wheelActive || Date.now() < (this._holdUntil || 0)) return;
      // A suppressed doorbell/trigger (guards were active when it fired)
      // overrides the live-socket tier: the frame already came and won't
      // repeat, so this tick is its retry.
      if (
        !this._refetchSuppressed &&
        this._wledHost &&
        wledPushIsLive(this._wledHost) &&
        Date.now() - (this._lastFetchAt || 0) < SOCKET_LIVE_POLL_MS
      ) {
        return;
      }
      this.refetchThrottled();
    }, 3000);

    // Covers DOM re-attach (dashboard switches): the host is cached, so
    // rejoining the shared socket is instant. The very first subscription
    // happens in fetchStateOnce(), once _hass exists.
    this.ensureWledPushSubscription();

    // A hidden tab doesn't need instant push, but its socket still holds
    // one of WLED's few WS client slots (and ESP heap) — release it, and
    // rejoin + catch up when the tab becomes visible again.
    this._onVisibilityChange = () => {
      if (document.hidden) {
        this._unsubscribeWledPush?.();
        this._unsubscribeWledPush = null;
      } else {
        this.ensureWledPushSubscription();
        this.refetchThrottled();
      }
    };
    document.addEventListener('visibilitychange', this._onVisibilityChange);
  }

  disconnectedCallback() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    if (this._onVisibilityChange) {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      this._onVisibilityChange = null;
    }
    // Leave the shared doorbell socket; the last card out closes it.
    this._unsubscribeWledPush?.();
    this._unsubscribeWledPush = null;
    clearTimeout(this._doorbellJitterTimer);
    this._doorbellJitterTimer = null;
    clearTimeout(this._refetchTimer);
    this._refetchTimer = null;
    // Also cancel a pending send-debounce, so a card removed within the
    // 100ms window after an edit doesn't fire updateWLED() from a
    // detached element (updateWLED only checks _hass, which is still set).
    clearTimeout(this._sendTimer);
    this._sendTimer = null;
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
