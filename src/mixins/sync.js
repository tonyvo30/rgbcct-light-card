// The card's state I/O, mixed into the card's prototype.
//
// Two jobs: (1) read the device's *true* state via the "get wled with cct"
// HA script and keep it in sync as things change anywhere (sibling cards,
// the WLED app, other dashboards), and (2) persist the last state the card
// sent to localStorage so a refresh restores it. The HA entity read-back
// is lossy for the raw multi-channel writes we make, so it's only a
// fallback — the /json/state fetch is the source of truth.

import { baseEntity } from '../entities.js';
import { subscribeToWledPush } from '../wled-socket.js';

// The HA script this card calls to read WLED's true live state.
const GET_SCRIPT = 'get_wled_with_cct';

// One device-registry download shared by every card on the page — a master
// plus its segment cards would otherwise each pull the full list (which can
// be hundreds of entries). Cleared on failure so a transient error retries.
let deviceRegistryRequest = null;

function listDeviceRegistry(hass) {
  if (!deviceRegistryRequest) {
    deviceRegistryRequest = hass.callWS({ type: 'config/device_registry/list' }).catch((error) => {
      deviceRegistryRequest = null;
      throw error;
    });
  }
  return deviceRegistryRequest;
}

export const syncMixin = {
  fetchStateOnce() {
    if (this._fetched || !this._hass || !this.config) return;

    this._fetched = true;
    this.fetchWledState();
    this.ensureWledPushSubscription();
  },

  // Resolve the WLED device's host (ip[:port]) from HA's device registry —
  // the same configuration_url the HA scripts use, read here via the
  // registry WebSocket API so no script changes or config are needed.
  // Success is cached; failure isn't, so a transient registry hiccup can
  // recover on a later call. null -> the poll stays the only sync path.
  async resolveWledHost() {
    if (this._wledHost !== undefined) return this._wledHost;
    if (!this._hass) return null;

    const generation = this._deviceSyncGeneration;

    try {
      const registryEntry = await this._hass.callWS({
        type: 'config/entity_registry/get',
        entity_id: this.config.entity,
      });

      const devices = await listDeviceRegistry(this._hass);
      const device = devices.find((candidate) => candidate.id === registryEntry.device_id);

      const configurationUrl = device?.configuration_url || '';
      const host = configurationUrl.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');

      // Stale generation (see resetDeviceSync): this host is the old
      // entity's — don't cache it over the reset.
      if (generation !== this._deviceSyncGeneration) return null;

      if (host) this._wledHost = host;

      return host || null;
    } catch (e) {
      return null;
    }
  },

  // Open (or join) the shared doorbell socket to this card's device. Every
  // frame just triggers the throttled re-read, so the push path reuses all
  // the guards the poll path already has. Safe to call repeatedly — no-ops
  // once subscribed, and quietly does nothing when the host can't be
  // resolved or the page is HTTPS (the poll tier covers both).
  async ensureWledPushSubscription() {
    if (this._unsubscribeWledPush || !this._hass || !this.config) return;

    // Escape hatch: `push: false` in the card config disables the direct
    // WLED socket entirely (the 3s poll takes over) — useful to isolate
    // the socket when debugging, or to spare WLED's few WS client slots.
    if (this.config.push === false) return;

    // HTTPS pages can't open ws:// (mixed content) — bail before spending
    // registry round trips on a socket that can't exist.
    if (window.location.protocol === 'https:') return;

    const generation = this._deviceSyncGeneration;
    const host = await this.resolveWledHost();
    // Bail if the await outran us: no host, a parallel call already
    // subscribed, the card detached (subscribing would leak a socket slot),
    // or a reset re-pointed us at a different device (see resetDeviceSync).
    if (!host || this._unsubscribeWledPush || !this.isConnected) return;
    if (generation !== this._deviceSyncGeneration) return;

    this._unsubscribeWledPush = subscribeToWledPush(host, () => {
      // Don't fight the user: skip while dragging or in the post-edit hold
      // window. Record the miss — colour never surfaces on the entity, so a
      // swallowed frame gets no retry until the poll notices the flag.
      if (this._wheelActive || Date.now() < (this._holdUntil || 0)) {
        this._refetchSuppressed = true;
        return;
      }

      // Jitter: every card on this device hears the same frame at once, so
      // an immediate fetch would hit the ESP with N concurrent reads. Spread
      // them out; refetchThrottled re-checks the guards at fire time.
      if (this._doorbellJitterTimer) return;
      this._doorbellJitterTimer = setTimeout(() => {
        this._doorbellJitterTimer = null;
        this.refetchThrottled();
      }, Math.random() * 600);
    });
  },

  // Forget everything bound to the current device — called when setConfig
  // re-points this element at a different entity (the card-editor preview
  // does exactly that). A reset can't cancel a promise that's already
  // awaiting, only make its continuation a no-op: bumping the generation
  // does that. Host resolution, the push subscription, and the state fetch
  // each capture the generation before their awaits and bail if it moved,
  // so none of them can rebind the old device's doorbell or persist its
  // state under the new entity's storage key.
  resetDeviceSync() {
    this._deviceSyncGeneration = (this._deviceSyncGeneration || 0) + 1;
    this._unsubscribeWledPush?.();
    this._unsubscribeWledPush = null;
    clearTimeout(this._doorbellJitterTimer);
    this._doorbellJitterTimer = null;
    this._wledHost = undefined;
    this._fetched = false;
    this._lastSeen = {};
    this._segments = null;
    this._stateIsOwned = false;
    this._refetchSuppressed = false;
  },

  // Ask the "get wled with cct" HA script for the device's live state
  // and adopt it. This is the true source of truth (reflects changes
  // made outside the card); localStorage/entity are only fallbacks used
  // until this resolves, or if WLED/the script is unreachable.
  async fetchWledState() {
    if (!this._hass) return;

    // Never call the get script for an entity HA doesn't know: the card
    // editor's live preview reconfigures on every keystroke, and partial
    // ids would fire script runs that fail noisily (empty ip, bad segment).
    if (!this._hass.states?.[this.config.entity]) return;

    // Only one fetch in flight; if another is requested meanwhile, run
    // it once this one finishes (so a change during the request isn't
    // lost).
    if (this._fetching) {
      this._refetchQueued = true;
      return;
    }

    this._fetching = true;
    this._lastFetchAt = Date.now();
    // This read covers any doorbell/trigger the guards suppressed earlier.
    this._refetchSuppressed = false;

    const generation = this._deviceSyncGeneration;

    try {
      const result = await this._hass.callWS({
        type: 'call_service',
        domain: 'script',
        service: GET_SCRIPT,
        service_data: { light_entity: this.config.entity },
        return_response: true,
      });

      const wled = result?.response;
      if (!wled) return;

      // Stale generation (see resetDeviceSync): adopting this would persist
      // the old device's state under the new entity's key. The queued
      // follow-up fetch covers the new entity.
      if (generation !== this._deviceSyncGeneration) return;

      // The user may have started interacting while this was in flight;
      // if so, their input wins — drop the fetched result.
      if (this._wheelActive || Date.now() < (this._holdUntil || 0)) return;

      const toNumberOrDefault = (value, fallback) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
      };

      this.bri = toNumberOrDefault(wled.bri, this.bri);
      this.w = toNumberOrDefault(wled.w, this.w);
      this.cct = toNumberOrDefault(wled.cct, this.cct);
      this.setRgb(
        toNumberOrDefault(wled.r, this.r),
        toNumberOrDefault(wled.g, this.g),
        toNumberOrDefault(wled.b, this.b),
      );

      // Per-segment list for the master's children view. The script
      // sends it JSON-encoded; HA may hand it back already parsed.
      let segments = wled.segments;
      if (typeof segments === 'string') {
        try {
          segments = JSON.parse(segments);
        } catch (e) {
          segments = null;
        }
      }
      if (Array.isArray(segments)) this._segments = segments;

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
    const entity = this.config.entity;
    const base = baseEntity(entity);

    // The group entity and every one of its segments all share this base,
    // so a single baseEntity() comparison catches the whole device.
    const states = this._hass?.states || {};
    const ids = Object.keys(states).filter((entityId) => baseEntity(entityId) === base);

    return ids.length ? ids : [entity];
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
      const lastUpdated = this._hass?.states?.[id]?.last_updated;
      if (!lastUpdated) continue;

      // Only a move from a previously-seen value counts (skip the first
      // sighting so we don't re-fetch immediately after the initial one).
      if (this._lastSeen[id] !== undefined && lastUpdated !== this._lastSeen[id]) {
        changed = true;
      }
      this._lastSeen[id] = lastUpdated;
    }

    if (!changed) return;

    // Don't fight the user: skip while dragging or inside the post-edit
    // hold window (the client making the change already has the state;
    // idle clients re-fetch and reflect it). Remember the skip so the
    // poll tick picks it up once the guards clear.
    if (this._wheelActive || Date.now() < (this._holdUntil || 0)) {
      this._refetchSuppressed = true;
      return;
    }

    this.refetchThrottled();
  },

  // Coalesce bursts of entity updates into at most one /json/state read
  // per REFETCH_MIN_MS, re-checking the interaction guards at fire time.
  refetchThrottled() {
    const REFETCH_MIN_MS = 1500;
    const wait = REFETCH_MIN_MS - (Date.now() - (this._lastFetchAt || 0));

    if (wait <= 0) {
      this.fetchWledState();
      return;
    }

    if (this._refetchTimer) return;

    this._refetchTimer = setTimeout(() => {
      this._refetchTimer = null;
      if (!this._wheelActive && Date.now() >= (this._holdUntil || 0)) {
        this.fetchWledState();
      } else {
        // Guards ate the scheduled re-read; leave a marker so the poll
        // tick retries once they clear instead of dropping it entirely.
        this._refetchSuppressed = true;
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

    const attributes = state.attributes ?? {};

    if (typeof attributes.brightness === 'number') {
      this.bri = attributes.brightness;
    }

    if (Array.isArray(attributes.rgbw_color)) {
      const [r, g, b, w] = attributes.rgbw_color;
      this.setRgb(r, g, b);
      this.w = w;
    } else if (Array.isArray(attributes.rgb_color)) {
      const [r, g, b] = attributes.rgb_color;
      this.setRgb(r, g, b);
    }

    if (typeof attributes.color_temp_kelvin === 'number') {
      const minKelvin = attributes.min_color_temp_kelvin ?? 2000;
      const maxKelvin = attributes.max_color_temp_kelvin ?? 6535;
      // Guard the divisor: a light reporting equal min/max (fixed color
      // temp, or a misconfigured integration) would give 0/0 = NaN, which
      // survives the clamp and blanks the slider / poisons the next send.
      const span = maxKelvin - minKelvin;
      if (span > 0) {
        const frac = (attributes.color_temp_kelvin - minKelvin) / span;
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

      const saved = JSON.parse(raw);
      const isNumber = (value) => typeof value === 'number' && isFinite(value);

      if (isNumber(saved.h)) this.h = saved.h;
      if (isNumber(saved.s)) this.s = saved.s;
      if (isNumber(saved.v)) this.v = saved.v;
      if (isNumber(saved.satR)) this.satR = saved.satR;
      if (isNumber(saved.bri)) this.bri = saved.bri;
      if (isNumber(saved.w)) this.w = saved.w;
      if (isNumber(saved.cct)) this.cct = saved.cct;

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
