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

    // Re-pointing the card at a different entity (the card editor does this on
    // every keystroke) invalidates the cached master-ness — it is a property of
    // the configured entity, so a new config must resolve it again.
    this._isMaster = undefined;

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

    // Both of these are read from entity attributes, which do not exist yet at
    // setConfig time — HA sets `hass` afterwards. Re-render when either answer
    // changes: they select between three different layouts (error, segment,
    // master), and an entity that appears late must replace the error card.
    if (
      this._renderedAsMaster !== this.isMaster() ||
      this._renderedProblem !== this.entityProblem()
    ) {
      this.render();
    }

    this.syncFromState();
  }

  get hass() {
    return this._hass;
  }

  // Ends a colour-wheel drag. Bound to the DOCUMENT rather than to the wheel,
  // because `set hass` can re-render mid-drag and renderCard() replaces
  // innerHTML — a listener on the wheel would die with the element it watches,
  // taking the only thing that clears `_wheelActive` with it. That flag stuck
  // on is bad: syncFromState stops adopting entity state, and the replacement
  // wheel's pointermove (which checks only the flag) picks colours and writes
  // to the device on mere hover.
  //
  // It lives in the lifecycle callbacks, not in setupEvents, because it is a
  // card-lifetime concern rather than a per-render one. Home Assistant detaches
  // and re-attaches cards without re-rendering them — switching views, editing
  // the dashboard, adding a card — so registering it from setupEvents left it
  // removed by disconnectedCallback with nothing to restore it, and the very
  // stuck-wheel bug it exists to prevent came back on the next re-attach.
  connectedCallback() {
    this._releaseWheel ??= () => {
      this._wheelActive = false;
    };

    // Re-attach can't inherit a drag: the pointerdown happened to an element
    // that is no longer in the document.
    this._wheelActive = false;

    // Same function reference, so a redundant add is a no-op.
    document.addEventListener('pointerup', this._releaseWheel);
    document.addEventListener('pointercancel', this._releaseWheel);
  }

  disconnectedCallback() {
    // Cancel a pending send-debounce, so a card removed within the 100ms window
    // after an edit doesn't fire updateWLED() from a detached element
    // (updateWLED only checks _hass, which is still set).
    clearTimeout(this._sendTimer);
    this._sendTimer = null;

    // Drop the channels that write had accumulated, or they outlive it. HA
    // detaches cards on a view switch, so: edit colour, get detached inside the
    // debounce, come back, nudge brightness — and the brightness write would
    // inherit `color` and repaint every segment of a master. Exactly the
    // behaviour send()-by-channel exists to prevent, through a narrower door.
    this._pendingChannels = null;

    if (this._releaseWheel) {
      document.removeEventListener('pointerup', this._releaseWheel);
      document.removeEventListener('pointercancel', this._releaseWheel);
    }
  }

  render() {
    // Remember which layout was built, so `set hass` can tell when either
    // answer has changed and this needs redoing.
    this._renderedAsMaster = this.isMaster();
    this._renderedProblem = this.entityProblem();

    // The element the user had grabbed is about to be destroyed, so end any
    // drag in progress. Belt-and-braces with the document-bound release in
    // connectedCallback: a live `_wheelActive` against a fresh wheel makes
    // hovering write to the device.
    //
    // `_holdUntil` deliberately survives. It is a timestamp that expires on its
    // own, nothing needs to clear it, and clearing it here would let the next
    // push snap back the control the user just moved.
    this._wheelActive = false;

    // renderCard replaces innerHTML, so the children list is about to become an
    // empty element again. Forget what was rendered into the old one, or
    // updateChildren's skip-if-unchanged check would match and leave it empty.
    this._renderedChildrenMarkup = null;

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
  //
  // `channel` is what the user actually edited (see wled.js). Channels
  // ACCUMULATE until a write goes out rather than resetting per call: the
  // debounce below deliberately swallows the intervening calls, so grabbing the
  // wheel within 100ms of nudging brightness must send both, not just the last.
  // Same hazard the coordinator's merge-don't-replace coalescing exists for.
  send(channel) {
    this._pendingChannels ??= new Set();
    this._pendingChannels.add(channel);

    // Hold off entity->UI sync briefly: the write has to reach WLED and come
    // back through the coordinator, and an intervening push still carries the
    // pre-edit state, which would snap the control the user just moved.
    this._holdUntil = Date.now() + 2000;

    clearTimeout(this._sendTimer);

    this._sendTimer = setTimeout(() => this.updateWLED(), 100);
  }

  async updateWLED() {
    if (!this._hass) return;

    // Claim the pending set before awaiting, so an edit made during the service
    // call is recorded for the next write instead of being cleared with this one.
    const channels = this._pendingChannels ?? new Set();
    this._pendingChannels = new Set();

    if (channels.size === 0) return;

    // Re-derive r/g/b from the wheel's HSV state right before sending, so the
    // service call always carries the current colour — never a stale r/g/b
    // from a code path that forgot to call applyHsv().
    this.applyHsv();

    await updateWLED(this, channels);
  }

  toggleCompact() {
    this.compact = !this.compact;

    this.render();
  }

  getCardSize() {
    if (this._renderedProblem) return 1;

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
