// The card's state I/O, mixed into the card's prototype.
//
// Two jobs: (1) read the device's *true* state via the "get wled with cct"
// HA script and keep it in sync as things change anywhere (sibling cards,
// the WLED app, other dashboards), and (2) persist the last state the card
// sent to localStorage so a refresh restores it. The HA entity read-back
// is lossy for the raw multi-channel writes we make, so it's only a
// fallback — the /json/state fetch is the source of truth.

import { baseEntity } from '../entities.js';

// The HA script this card calls to read WLED's true live state.
const GET_SCRIPT = 'get_wled_with_cct';

export const syncMixin = {
  fetchStateOnce() {
    if (this._fetched || !this._hass || !this.config) return;

    this._fetched = true;
    this.fetchWledState();
  },

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
        type: 'call_service',
        domain: 'script',
        service: GET_SCRIPT,
        service_data: { light_entity: this.config.entity },
        return_response: true,
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

      // Per-segment list for the master's children view. The script
      // sends it JSON-encoded; HA may hand it back already parsed.
      let segs = d.segments;
      if (typeof segs === 'string') {
        try {
          segs = JSON.parse(segs);
        } catch (e) {
          segs = null;
        }
      }
      if (Array.isArray(segs)) this._segments = segs;

      // Live device state wins over the lossy entity read-back.
      this._stateIsOwned = true;
      this.persistState();
      this.updateUI();
    } catch (e) {
      // WLED offline or the get script isn't set up — keep whatever
      // localStorage/the entity gave us.
    } finally {
      this._fetching = false;
      if (this._refetchQueued) {
        this._refetchQueued = false;
        this.refetchThrottled();
      }
    }
  },

  // Entities whose HA state changes should make this card re-read the
  // live device state: the whole WLED device (group entity + every
  // segment entity), so a change surfaced on any of them triggers a
  // re-fetch. NOTE: this only catches CCT/brightness — because the
  // light sits in color_temp mode (we always send cct), HA never
  // surfaces rgb changes on any of these entities, so pure colour
  // changes are caught by the poll fallback, not this trigger.
  watchedEntities() {
    const e = this.config.entity;
    const base = baseEntity(e);

    // The group entity and every one of its segments all share this base,
    // so a single baseEntity() comparison catches the whole device.
    const states = this._hass?.states || {};
    const ids = Object.keys(states).filter((k) => baseEntity(k) === base);

    return ids.length ? ids : [e];
  },

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
  },

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
  },

  // Pull current values from the light entity's attributes.
  syncFromState() {
    const state = this._hass?.states?.[this.config.entity];

    if (!state) return;

    // Once the card has its own remembered/edited state it's the source
    // of truth (the entity read-back is lossy for our raw WLED writes).
    // Also skip while the user is interacting (or just did), so a
    // background HA push doesn't snap controls back (e.g. brightness 255).
    if (this._stateIsOwned || this._wheelActive || Date.now() < (this._holdUntil || 0)) return;

    const attr = state.attributes ?? {};

    if (typeof attr.brightness === 'number') {
      this.bri = attr.brightness;
    }

    if (Array.isArray(attr.rgbw_color)) {
      const [r, g, b, w] = attr.rgbw_color;
      this.setRgb(r, g, b);
      this.w = w;
    } else if (Array.isArray(attr.rgb_color)) {
      const [r, g, b] = attr.rgb_color;
      this.setRgb(r, g, b);
    }

    if (typeof attr.color_temp_kelvin === 'number') {
      const min = attr.min_color_temp_kelvin ?? 2000;
      const max = attr.max_color_temp_kelvin ?? 6535;
      // Guard the divisor: a light reporting equal min/max (fixed color
      // temp, or a misconfigured integration) would give 0/0 = NaN, which
      // survives the clamp and blanks the slider / poisons the next send.
      const span = max - min;
      if (span > 0) {
        const frac = (attr.color_temp_kelvin - min) / span;
        this.cct = Math.round(Math.min(1, Math.max(0, frac)) * 255);
      }
    }

    this.updateUI();
  },

  storeKey() {
    return `rgbcct-light-card:${this.config.entity}`;
  },

  // Restore the last state this card sent (survives page refreshes).
  restoreState() {
    try {
      const raw = localStorage.getItem(this.storeKey());
      if (!raw) return;

      const s = JSON.parse(raw);
      const num = (v) => typeof v === 'number' && isFinite(v);

      if (num(s.h)) this.h = s.h;
      if (num(s.s)) this.s = s.s;
      if (num(s.v)) this.v = s.v;
      if (num(s.satR)) this.satR = s.satR;
      if (num(s.bri)) this.bri = s.bri;
      if (num(s.w)) this.w = s.w;
      if (num(s.cct)) this.cct = s.cct;

      // We have our own state now; the entity read-back must not stomp it.
      this._stateIsOwned = true;
    } catch (e) {
      // localStorage unavailable (private mode etc.) — just skip.
    }
  },

  // Remember the current state so a refresh can restore it.
  persistState() {
    try {
      localStorage.setItem(
        this.storeKey(),
        JSON.stringify({
          h: this.h,
          s: this.s,
          v: this.v,
          satR: this.satR,
          bri: this.bri,
          w: this.w,
          cct: this.cct,
        }),
      );
    } catch (e) {
      // Ignore write failures.
    }
  },
};
