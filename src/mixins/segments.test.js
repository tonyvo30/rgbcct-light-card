// Master detection, entity validation, and segment discovery.
//
// Three hardware-found bugs lived in these three functions, all of the same
// shape: a question the data could not answer, answered anyway. The suite is
// built around the states that produce no answer — no `hass`, no state,
// `unavailable`, an entity from somewhere else — because those are the inputs
// that broke, not the happy path.

import { beforeEach, describe, expect, it } from 'vitest';

import { segmentsMixin } from './segments.js';

const GROUP = 'light.strip';
const SEGMENT_ZERO = 'light.strip_segment_0';
// Deliberately NOT following the sibling naming pattern: assigning the device to
// an area made Home Assistant name a later-created entity like this, which is
// what broke id-based discovery.
const SEGMENT_ONE = 'light.bedroom_strip_segment_1';

function litSegment(segmentId, [r, g, b], brightness = 255) {
  return {
    state: 'on',
    attributes: { segment_id: segmentId, rgbww_color: [r, g, b, 0, 0], brightness },
  };
}

// A card object with the mixin on it. Not the custom element — these methods
// only read `config` and `_hass`, so a plain object exercises them exactly.
function fakeCard(overrides = {}) {
  return Object.assign(Object.create(segmentsMixin), {
    config: { entity: GROUP },
    _hass: {
      entities: {
        [GROUP]: { device_id: 'device-1' },
        [SEGMENT_ZERO]: { device_id: 'device-1' },
        [SEGMENT_ONE]: { device_id: 'device-1' },
        'light.unrelated': { device_id: 'device-2' },
      },
      states: {
        [GROUP]: { state: 'on', attributes: { is_group: true } },
        [SEGMENT_ZERO]: litSegment(0, [255, 0, 0]),
        [SEGMENT_ONE]: litSegment(1, [0, 0, 255]),
        'light.unrelated': litSegment(0, [1, 2, 3]),
      },
    },
    ...overrides,
  });
}

describe('isMaster', () => {
  it('reads the markers rather than the entity id', () => {
    expect(fakeCard().isMaster()).toBe(true);
    expect(fakeCard({ config: { entity: SEGMENT_ONE } }).isMaster()).toBe(false);
  });

  it('does not claim master when the entity says nothing', () => {
    // The original defect: every failure mode of the old absence test — no hass,
    // no state, unavailable — evaluated to "whole-device master", handing a
    // segment card a device-wide blast radius on a routine ESP reboot.
    expect(fakeCard({ _hass: undefined }).isMaster()).toBe(false);
    expect(fakeCard({ config: { entity: 'light.missing' } }).isMaster()).toBe(false);
  });

  it('still knows a master whose device is unreachable', () => {
    // And the mirror image, which the first fix caused: refusing to answer left
    // a real master rendering as a segment with no children list. Both markers
    // are capability attributes, so they outlive availability.
    const card = fakeCard();
    card._hass.states[GROUP] = { state: 'unavailable', attributes: { is_group: true } };

    expect(card.isMaster()).toBe(true);
  });

  it('resolves once and then stops asking', () => {
    // Master-ness follows from the configured entity, so it is fixed for the life
    // of that config. Re-deriving it from live state is what let a dropout change
    // the card's layout underneath the user.
    const card = fakeCard();
    expect(card.isMaster()).toBe(true);

    delete card._hass.states[GROUP];

    expect(card.isMaster()).toBe(true);
  });

  it('lets an explicit config override win outright', () => {
    expect(fakeCard({ config: { entity: GROUP, master: false } }).isMaster()).toBe(false);
    expect(fakeCard({ config: { entity: SEGMENT_ONE, master: true } }).isMaster()).toBe(true);
  });
});

describe('entityProblem', () => {
  it('is silent for a healthy entity', () => {
    expect(fakeCard().entityProblem()).toBeNull();
    expect(fakeCard({ config: { entity: SEGMENT_ONE } }).entityProblem()).toBeNull();
  });

  it('reports an entity that does not exist', () => {
    const card = fakeCard({ config: { entity: 'light.typo' } });

    expect(card.entityProblem()).toBe('Entity not found: light.typo');
  });

  it('reports a real entity that is not one of ours', () => {
    // The case worth having: pointing the card at the *native* WLED
    // integration's entity for the same strip used to render controls that
    // silently did nothing.
    const card = fakeCard({ config: { entity: 'light.foreign' } });
    card._hass.states['light.foreign'] = { state: 'on', attributes: { brightness: 5 } };

    expect(card.entityProblem()).toBe('Not an rgbcct_wled light: light.foreign');
  });

  it('says nothing before hass arrives', () => {
    // setConfig runs before HA sets `hass`, so the entity is not knowable at
    // first paint; reporting then would flash an error on every page load.
    expect(fakeCard({ _hass: undefined }).entityProblem()).toBeNull();
  });

  it('does not treat an offline device as a misconfiguration', () => {
    // The config is correct and the device is merely unreachable. Blanking the
    // card here would hide the segment list exactly when someone is trying to
    // work out what is wrong.
    const card = fakeCard();
    card._hass.states[GROUP] = { state: 'unavailable', attributes: { is_group: true } };

    expect(card.entityProblem()).toBeNull();
  });
});

describe('deviceSegments', () => {
  let card;

  beforeEach(() => {
    card = fakeCard();
  });

  it('finds siblings by device, not by entity-id shape', () => {
    // SEGMENT_ONE deliberately does not share the group's id prefix.
    expect(card.deviceSegments().map((segment) => segment.number)).toEqual([0, 1]);
  });

  it('excludes entities on other devices', () => {
    expect(card.deviceSegments().some((segment) => segment.r === 1)).toBe(false);
  });

  it('excludes the group itself', () => {
    expect(card.deviceSegments()).toHaveLength(2);
  });

  it('orders by segment number, not by id text', () => {
    card._hass.entities['light.strip_segment_10'] = { device_id: 'device-1' };
    card._hass.states['light.strip_segment_10'] = litSegment(10, [0, 255, 0]);

    expect(card.deviceSegments().map((segment) => segment.number)).toEqual([0, 1, 10]);
  });

  it('distinguishes unavailable from off', () => {
    // A segment whose device dropped off the network is not one the user
    // switched off, and must not vanish either — that would make a partly
    // offline device read as a smaller device.
    card._hass.states[SEGMENT_ZERO] = {
      state: 'unavailable',
      attributes: { segment_id: 0 },
    };

    const [first] = card.deviceSegments();
    expect(first).toMatchObject({ number: 0, available: false, on: false });
    expect(card.deviceSegments()).toHaveLength(2);
  });

  it('coerces attribute values that reach the markup', () => {
    // These are interpolated into an innerHTML string inside a style attribute.
    // The filter is "any entity on this device with a numeric segment_id", not
    // "entities from my integration", so the values are not ours to trust.
    card._hass.states[SEGMENT_ZERO] = {
      state: 'on',
      attributes: {
        segment_id: 0,
        rgbww_color: ['" onerror="alert(1)', null, undefined, 0, 0],
        brightness: 'nonsense',
      },
    };

    expect(card.deviceSegments()[0]).toMatchObject({ r: 0, g: 0, b: 0, brightness: 0 });
  });

  it('returns nothing rather than throwing when the registry is unavailable', () => {
    expect(fakeCard({ _hass: { states: {} } }).deviceSegments()).toEqual([]);
  });
});

describe('segmentsAreMixed', () => {
  it('is true when lit segments differ', () => {
    expect(fakeCard().segmentsAreMixed()).toBe(true);
  });

  it('is false when lit segments match within tolerance', () => {
    const card = fakeCard();
    card._hass.states[SEGMENT_ONE] = litSegment(1, [253, 2, 2]);

    expect(card.segmentsAreMixed()).toBe(false);
  });

  it('ignores segments that are off', () => {
    // An off entity reports no colour at all, so counting it would read as black
    // and flag every partly-off device as Mixed.
    const card = fakeCard();
    card._hass.states[SEGMENT_ONE] = { state: 'off', attributes: { segment_id: 1 } };

    expect(card.segmentsAreMixed()).toBe(false);
  });
});
