// Everything about the multi-segment / master-card behaviour, mixed into
// the card's prototype: master detection, the read-only children list, and
// the "mixed segments" check.
//
// HOW A CARD FINDS ITS DEVICE'S SEGMENTS
// By device identity, via HA's entity registry (`hass.entities`), and by the
// `segment_id` attribute the integration puts on each segment light.
//
// It used to match entity-id strings — siblings were "ids sharing my prefix and
// containing _segment_". That looks reasonable and is silently wrong: HA derives
// an entity id from the device's name *once*, at creation, and never revises it.
// Assign the device to an area or rename it and the next segment created gets an
// id on the new pattern while its siblings keep the old one, so the master stops
// seeing part of its own device with no error anywhere. Found on hardware; see
// `light.py`'s extra_state_attributes for the full account.
//
// On/off propagation used to live here too — the master flipped the group entity
// *and* every segment entity, because WLED keeps per-segment power flags that a
// group-level write would not clear. The integration does that fan-out
// server-side now (`payload.build_turn_off_payload`), in one POST instead of
// N service calls, so setPower just commands this card's own entity.

export const segmentsMixin = {
  // A card is a master (whole-device) card when its own entity carries no
  // `segment_id` — the group entity omits it. Optional `master:` config overrides.
  //
  // **Decided by a positive marker, resolved once, then cached.**
  //
  // Both answers are assertions the integration makes: a segment entity carries
  // `segment_id`, the group carries `is_group` (`light.py`). Neither is inferred
  // from the other being missing, which matters because a missing attribute has
  // three causes — segment, group, or "not loaded" — and an absence test cannot
  // tell them apart. Reading "no segment_id" as *master* handed unloaded cards a
  // device-wide blast radius; reading it as *segment* left a real master with no
  // children list whenever it was created while the device was unreachable.
  // Both attributes are capability attributes, so they survive a dropout.
  //
  // Cached because master-ness follows from which entity the user configured: it
  // is fixed for the life of that config and must not track live state. If
  // neither marker is present the question stays open, and the fallback is
  // *segment* — the narrower capability — until an answer arrives.
  isMaster() {
    if (this.config.master !== undefined) return this.config.master;

    if (this._isMaster === undefined) {
      const attributes = this._hass?.states?.[this.config.entity]?.attributes;
      if (typeof attributes?.segment_id === 'number') this._isMaster = false;
      else if (attributes?.is_group === true) this._isMaster = true;
    }

    return this._isMaster ?? false;
  },

  // Entity ids belonging to this card's device. Scanning the registry means
  // touching every entity in the instance, and `set hass` fires on every state
  // change ANYWHERE — so this is cached against the registry object itself.
  // Home Assistant replaces `hass.entities` only when the registry changes
  // (entities added, removed, renamed), not on state changes, so an identity
  // check invalidates exactly when the answer could have moved.
  deviceEntityIds() {
    // Everything here depends on the frontend's entity registry. If a future
    // Home Assistant changes its shape, or an older one lacks it, the honest
    // outcome is "no segments" — say so once rather than presenting an empty
    // children list as though the device had none.
    if (this._hass && !this._hass.entities && !this._warnedAboutRegistry) {
      this._warnedAboutRegistry = true;
      console.warn(
        "rgbcct-light-card: hass.entities is unavailable, so this device's segments " +
          'cannot be discovered. The master card will show an empty Segments list.',
      );
    }

    const registry = this._hass?.entities || {};

    if (this._deviceEntityIdsFrom === registry) return this._deviceEntityIds;

    const deviceId = registry[this.config.entity]?.device_id;
    const entityIds = deviceId
      ? Object.keys(registry).filter((entityId) => registry[entityId].device_id === deviceId)
      : [];

    this._deviceEntityIdsFrom = registry;
    this._deviceEntityIds = entityIds;

    return entityIds;
  },

  // This device's segments, in segment-number order. Each entry is what the
  // children list and the mixed check need: { number, available, on, r, g, b,
  // brightness }.
  //
  // Membership is the device this card's entity belongs to, so it survives every
  // rename; `segment_id` marks which of that device's entities are segments (the
  // group has none) and supplies the real ordering, since entity ids sort as text
  // and would put "_segment_10" before "_segment_2".
  //
  // Colour comes from `rgbww_color`, whose cold/warm whites are deliberately
  // ignored — the swatch shows the RGB the segment is displaying, and folding
  // white into it would wash every swatch toward grey. `on` already accounts for
  // device power: the integration reports a segment as on only when the device
  // and the segment are both on (`light.py`), so there is nothing to combine here.
  deviceSegments() {
    // Cached per `hass` object: one refresh asks for this twice (the mixed check
    // and the children list), and both want the same answer.
    if (this._deviceSegmentsFrom === this._hass) return this._deviceSegments;

    const states = this._hass?.states || {};

    const segments = this.deviceEntityIds()
      .map((entityId) => states[entityId])
      .filter((state) => typeof state?.attributes?.segment_id === 'number')
      .map((state) => {
        const [r, g, b] = state.attributes.rgbww_color ?? [];
        // Coerced, not trusted. These land in an `innerHTML` string in
        // updateChildren, inside a `style` attribute — a value carrying a quote
        // would break out of it and could add an event-handler attribute.
        //
        // The rgbcct_wled integration cannot produce one (`models._coerce_int`),
        // but the filter above is not "entities from my integration": it is any
        // entity on this device exposing a numeric `segment_id`. Another
        // integration, a template light or a python_script could attach that to
        // an entity on the same device, and its attributes would render here.
        // Reachability is a property of other people's code; the coercion is
        // free, so it does not get to depend on that.
        const toChannel = (value) => Number(value) || 0;
        return {
          number: state.attributes.segment_id,
          // Distinct from `on`: a segment whose device dropped off the network
          // is not the same as one the user switched off, and the list must not
          // report the first as the second — nor omit it, which would make a
          // partly-offline device read as a smaller device.
          available: state.state !== 'unavailable' && state.state !== 'unknown',
          on: state.state === 'on',
          r: toChannel(r),
          g: toChannel(g),
          b: toChannel(b),
          brightness: toChannel(state.attributes.brightness),
        };
      })
      .sort((left, right) => left.number - right.number);

    this._deviceSegmentsFrom = this._hass;
    this._deviceSegments = segments;

    return segments;
  },

  // Are the segments non-homogeneous? True if any lit segment's colour or
  // brightness differs from the first lit one beyond a small tolerance (absorbs
  // WLED/rounding jitter).
  //
  // Only lit segments are compared. An off segment reports no colour attributes
  // at all, so including it would read as black and flag every partly-off device
  // as "Mixed" — which says nothing about whether the lit segments look alike.
  segmentsAreMixed() {
    const lit = this.deviceSegments().filter((segment) => segment.on);
    if (lit.length < 2) return false;

    const TOL = 4;
    const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= TOL;

    const first = lit[0];

    return lit.some(
      (segment) =>
        !near(segment.r, first.r) ||
        !near(segment.g, first.g) ||
        !near(segment.b, first.b) ||
        !near(segment.brightness, first.brightness),
    );
  },

  // Render the master's read-only children list (one row per segment: colour
  // swatch + brightness %). An off segment reads as a hollow swatch and "Off";
  // an unreachable one says so rather than impersonating an off segment.
  updateChildren() {
    const list = this.childrenList;
    if (!list) return;

    const segments = this.deviceSegments();

    const markup = segments
      .map((segment) => {
        const percent = Math.round((segment.brightness / 255) * 100);
        const readout = segment.available ? (segment.on ? percent + '%' : 'Off') : 'Unavailable';
        const swatch = segment.on ? `rgb(${segment.r}, ${segment.g}, ${segment.b})` : 'transparent';
        return `
        <div class="child${segment.on ? '' : ' off'}">
          <span class="child-swatch" style="background: ${swatch}"></span>
          <span class="child-name">Segment ${segment.number}</span>
          <span class="child-bri">${readout}</span>
        </div>
      `;
      })
      .join('');

    // Only touch the DOM when the markup actually moved. This runs on every
    // `set hass` — i.e. on every state change anywhere in Home Assistant — and
    // almost none of those concern this device, so an unconditional write would
    // tear down and rebuild identical rows thousands of times over.
    if (markup !== this._renderedChildrenMarkup) {
      list.innerHTML = markup;
      this._renderedChildrenMarkup = markup;
    }

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

  // Turn this card's light on/off via the standard HA light service.
  //
  // One entity, whichever card this is: the integration expands a group command
  // to the device plus every segment, and powers the device on when a single
  // segment is turned on (so it actually lights) while leaving the device alone
  // when one is turned off (its siblings may still be lit). See payload.py.
  setPower(on) {
    if (!this._hass) return;

    this._hass.callService('light', on ? 'turn_on' : 'turn_off', {
      entity_id: this.config.entity,
    });

    // No optimistic state to stash: the imminent state_changed push (handled in
    // `set hass`) refreshes the toggle + children with the device's true power.
  },

  // Reflect the live on/off state on the toggle. The group entity is on when the
  // device is on and any segment is lit, so master and segment cards read the
  // same way — that "any segment lit" rule now lives in the integration
  // (`light.py`) instead of being recomputed here from N entity states.
  syncToggle() {
    const toggle = this.toggle;

    if (!toggle || toggle === document.activeElement) return;

    toggle.checked = this._hass?.states?.[this.config.entity]?.state === 'on';
  },
};
