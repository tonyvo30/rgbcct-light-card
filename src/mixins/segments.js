// Everything about the multi-segment / master-card behaviour, mixed into
// the card's prototype: master detection, the read-only children list,
// the "mixed segments" check, and on/off power (which the master
// propagates across every segment). On/off is driven by the live HA
// entity states — reliable and instant, unlike the lossy colour read-back.

import { isSegmentEntity, baseEntity, segmentEntity } from '../entities.js';

export const segmentsMixin = {
  // A card is a master (whole-device) card when its entity is the group
  // entity (no "_segment_" suffix). Optional `master:` config overrides.
  isMaster() {
    return this.config.master ?? !isSegmentEntity(this.config.entity);
  },

  // Are the fetched segments non-homogeneous? True if any segment's
  // colour or brightness differs from segment 0 beyond a small tolerance
  // (absorbs WLED/rounding jitter). Needs at least two segments to differ.
  segmentsAreMixed() {
    const segments = this._segments;
    if (!Array.isArray(segments) || segments.length < 2) return false;

    const TOL = 4;
    const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= TOL;

    const first = segments[0];

    return segments.some(
      (segment) =>
        !near(segment.r, first.r) ||
        !near(segment.g, first.g) ||
        !near(segment.b, first.b) ||
        !near(segment.bri, first.bri),
    );
  },

  // The device's base (group) entity id — this card's entity with any
  // "_segment_n" suffix stripped.
  deviceBase() {
    return baseEntity(this.config.entity);
  },

  // The HA entity ids for this device's segments (light.<base>_segment_n) —
  // the segment entities that share this device's base.
  segmentEntityIds() {
    const base = this.deviceBase();
    const states = this._hass?.states || {};
    return Object.keys(states).filter(
      (entityId) => isSegmentEntity(entityId) && baseEntity(entityId) === base,
    );
  },

  // Is the device's master power on? Read from the group entity's state,
  // which is reliable for on/off (only colour is lossy on the entity).
  deviceOn() {
    return this._hass?.states?.[this.deviceBase()]?.state === 'on';
  },

  // Is a given fetched segment lit? On/off is driven by the live HA
  // entity states (reliable + instant), not the lossy colour read-back:
  // a segment is lit only if the device master is on AND its own segment
  // entity is on. Falls back to the get script's `on` flag, then to on,
  // if that segment has no matching entity.
  segmentIsOn(segment) {
    if (segment == null) return false;
    if (!this.deviceOn()) return false;

    const entityState = this._hass?.states?.[segmentEntity(this.deviceBase(), segment.id)];
    if (entityState) return entityState.state === 'on';

    if (segment.on === undefined || segment.on === null) return true;
    return Number(segment.on) > 0;
  },

  // Render the master's read-only children list (one row per segment:
  // colour swatch + brightness %) from the last fetched seg[] data. An
  // off segment reads as a hollow swatch and "Off" instead of a %.
  updateChildren() {
    const list = this.childrenList;
    if (!list) return;

    const segments = this._segments || [];

    list.innerHTML = segments
      .map((segment) => {
        const on = this.segmentIsOn(segment);
        const r = Number(segment.r) || 0;
        const g = Number(segment.g) || 0;
        const b = Number(segment.b) || 0;
        const percent = Math.round(((Number(segment.bri) || 0) / 255) * 100);
        return `
        <div class="child${on ? '' : ' off'}">
          <span class="child-swatch" style="background: ${on ? `rgb(${r}, ${g}, ${b})` : 'transparent'}"></span>
          <span class="child-name">Segment ${segment.id}</span>
          <span class="child-bri">${on ? percent + '%' : 'Off'}</span>
        </div>
      `;
      })
      .join('');

    const count = this.querySelector('#children-count');
    if (count) count.textContent = segments.length ? `(${segments.length})` : '';
  },

  toggleChildren() {
    this._childrenOpen = !this._childrenOpen;
    this.applyChildrenOpen();
  },

  applyChildrenOpen() {
    const wrapper = this.querySelector('.children');
    if (!wrapper) return;

    wrapper.classList.toggle('open', !!this._childrenOpen);

    const chevron = this.querySelector('#children-chevron');
    if (chevron) {
      chevron.setAttribute('icon', this._childrenOpen ? 'mdi:chevron-up' : 'mdi:chevron-down');
    }
  },

  // Turn the light on/off via the standard HA light service (the WLED
  // integration handles it). On/off is a reliable entity state, so
  // unlike colour it doesn't go through the send-wled script.
  //
  // The master takes precedence over each child: it flips the group entity
  // AND every segment entity, so an individually-off child comes on with
  // the master (and vice-versa). Turning only the group's top-level power
  // wouldn't relight a segment whose own on-flag is off — WLED keeps those
  // per-segment flags — which is why the children didn't follow before.
  setPower(on) {
    if (!this._hass) return;

    let targets;

    if (this.isMaster()) {
      // Master drives the whole group + every segment.
      targets = [this.config.entity, ...this.segmentEntityIds()];
    } else if (on) {
      // Turning a single segment ON also turns the device (group) on, so
      // the segment actually lights (WLED won't light a segment while the
      // master power is off) and the master reflects "any segment on".
      // Turning a segment OFF leaves the group alone — other segments may
      // still be on, so the device must stay powered.
      targets = [this.config.entity, this.deviceBase()];
    } else {
      targets = [this.config.entity];
    }

    this._hass.callService('light', on ? 'turn_on' : 'turn_off', { entity_id: targets });

    // No optimistic state to stash: on/off is reliable on the HA entities,
    // so the imminent state_changed push (handled in `set hass`) refreshes
    // the toggle + children with the device's true power within a moment.
  },

  // Reflect the live on/off state on the toggle. For a master card the
  // rule is "on if ANY segment is lit": off whenever the device master is
  // off (so turning the master off always sticks), otherwise on if any
  // segment entity is on. All read from HA entity states, which are
  // reliable for on/off — unlike colour, on/off isn't lossy, so this
  // isn't gated by _stateIsOwned and never fights the get-script fetch.
  // Segment/child cards just use their own entity state.
  syncToggle() {
    const toggle = this.toggle;

    if (!toggle || toggle === document.activeElement) return;

    if (this.isMaster()) {
      if (!this.deviceOn()) {
        toggle.checked = false;
        return;
      }
      const segmentIds = this.segmentEntityIds();
      toggle.checked = segmentIds.length
        ? segmentIds.some((id) => this._hass.states[id]?.state === 'on')
        : true;
      return;
    }

    const state = this._hass?.states?.[this.config.entity];

    toggle.checked = state?.state === 'on';
  },
};
