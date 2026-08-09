// The card's state read path, mixed into the card's prototype.
//
// One job: adopt the light entity's attributes into the card's working state.
// Home Assistant pushes those attributes over its own authenticated WebSocket,
// so `set hass` fires whenever the device changes anywhere — a sibling card, the
// WLED app, an automation — and this is the whole sync mechanism.
//
// It used to be far more than this. Because the old entity sat in `color_temp`
// mode it could not report the raw multi-channel writes the card made, so the
// card bypassed it: an HA script read /json/state, a second ws:// socket direct
// to the ESP delivered change notifications, a device-registry lookup found the
// host for that socket, and a tiered poll caught what the socket missed (it
// could not exist on an HTTPS dashboard). All of that was compensation for a
// lossy read. The rgbcct_wled integration's RGBWW entity reports colour,
// white and temperature faithfully, so none of it is needed — see
// .claude/integration-plan.md, Phase 2.

import { coldWarmToWhiteCct, whiteCctToColdWarm } from '../color.js';

export const syncMixin = {
  // Pull current values from the light entity's attributes.
  syncFromState() {
    const state = this._hass?.states?.[this.config.entity];

    if (!state) return;

    // Don't fight the user: a push that lands mid-drag, or inside the short
    // hold window after an edit, would snap the controls back to the value the
    // device had a moment ago. The next push after the window closes carries
    // the settled state, so nothing is lost by skipping the adoption.
    //
    // The guard covers only the *adoption*, not the redraw below. Rendering
    // always paints from the card's own state — which during a drag is exactly
    // what the user is setting — so it cannot snap anything back, and it keeps
    // the power toggle and the master's children list live throughout.
    const interacting = this._wheelActive || Date.now() < (this._holdUntil || 0);

    if (!interacting) {
      const attributes = state.attributes ?? {};

      if (typeof attributes.brightness === 'number') {
        this.bri = attributes.brightness;
      }

      // Absent while the light is off — HA drops colour attributes then.
      // Keeping the card's current values in that case means turning the light
      // back on shows what it had, rather than a black swatch.
      if (Array.isArray(attributes.rgbww_color)) {
        const [r, g, b, coldWhite, warmWhite] = attributes.rgbww_color;
        this.setRgb(r, g, b);

        // Adopt the whites only if the device is showing something the card is
        // NOT already holding. The cold/warm pair carries temperature as a
        // ratio, so decoding it back to (w, cct) loses precision at low white —
        // enough to move the slider a sixth of its travel at white=3, and that
        // drifted value is what the next edit writes back (see color.js).
        //
        // Re-encoding what the card holds and comparing is exact: an identical
        // pair means the device agrees with the card and there is nothing to
        // learn from decoding it. Only a genuine difference — someone changed
        // the light elsewhere — is worth the lossy conversion.
        const [heldCold, heldWarm] = whiteCctToColdWarm(this.w, this.cct);
        if (heldCold !== coldWhite || heldWarm !== warmWhite) {
          // Pass the current cct so an all-zero white pair leaves the slider
          // alone instead of snapping it (see coldWarmToWhiteCct).
          ({ w: this.w, cct: this.cct } = coldWarmToWhiteCct(coldWhite, warmWhite, this.cct));
        }
      }
    }

    this.updateUI();
  },
};
