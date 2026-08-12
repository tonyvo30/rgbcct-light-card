/**
 * @vitest-environment happy-dom
 */
// The only suite that needs a DOM — the rest run on plain `node`, which is why
// the environment is opted into here rather than set globally (see vite.config.js).
//
// The custom element's lifecycle and write batching.
//
// This is the only suite that needs a DOM, and it earns it: both regressions
// introduced while fixing the last review lived here, and neither was visible by
// reading. They share a shape — state or a listener registered on one schedule
// and released on another — so the tests deliberately attach, detach and
// re-attach rather than exercising a single clean pass.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../src/rgbcct-light-card.js';

const GROUP = 'light.strip';

function fakeHass() {
  return {
    entities: { [GROUP]: { device_id: 'device-1' } },
    states: { [GROUP]: { state: 'on', attributes: { is_group: true, brightness: 200 } } },
    callService: vi.fn(),
  };
}

function mountCard(config = { entity: GROUP }) {
  const card = document.createElement('rgbcct-light-card');
  document.body.append(card);
  card.setConfig(config);
  card.hass = fakeHass();
  return card;
}

// The write is debounced by 100ms and then awaits the service call.
async function flushWrite() {
  await vi.advanceTimersByTimeAsync(150);
}

function writtenData(card) {
  expect(card.hass.callService).toHaveBeenCalledTimes(1);
  return card.hass.callService.mock.calls[0][2];
}

describe('send batching', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  it('writes only the channel that was edited', async () => {
    const card = mountCard();

    card.send('brightness');
    await flushWrite();

    expect(writtenData(card)).not.toHaveProperty('rgbww_color');
  });

  it('accumulates channels the debounce swallows', async () => {
    // Two edits inside 100ms produce one write, and it must carry both. Keeping
    // only the newest would silently drop the first — the same reason the
    // coordinator merges payloads rather than replacing them.
    const card = mountCard();

    card.send('brightness');
    card.send('color');
    await flushWrite();

    const data = writtenData(card);
    expect(data).toHaveProperty('brightness');
    expect(data).toHaveProperty('rgbww_color');
  });

  it('starts each write from an empty set', async () => {
    const card = mountCard();

    card.send('color');
    await flushWrite();
    card.hass.callService.mockClear();

    card.send('brightness');
    await flushWrite();

    expect(writtenData(card)).not.toHaveProperty('rgbww_color');
  });

  it('does not carry a cancelled write into the next one', async () => {
    // Detaching cancels the debounced write. If the channels it accumulated are
    // left claimed, the next unrelated edit inherits them — so editing colour,
    // switching dashboard views inside the debounce, then nudging brightness
    // would repaint every segment of a master.
    const card = mountCard();

    card.send('color');
    card.remove();
    await flushWrite();
    expect(card.hass.callService).not.toHaveBeenCalled();

    document.body.append(card);
    card.send('brightness');
    await flushWrite();

    expect(writtenData(card)).not.toHaveProperty('rgbww_color');
  });

  it('does not write when nothing was edited', async () => {
    const card = mountCard();

    await card.updateWLED();

    expect(card.hass.callService).not.toHaveBeenCalled();
  });
});

describe('wheel-drag lifecycle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('ends a drag when the pointer is released anywhere', () => {
    // The release handler is on the document, not the wheel: a re-render
    // replaces the wheel element, and a listener bound to it would die with the
    // element, leaving the flag stuck on.
    const card = mountCard();
    card._wheelActive = true;

    document.dispatchEvent(new Event('pointerup'));

    expect(card._wheelActive).toBe(false);
  });

  it('survives a re-render mid-drag', () => {
    const card = mountCard();
    card._wheelActive = true;

    card.render();
    document.dispatchEvent(new Event('pointerup'));

    expect(card._wheelActive).toBe(false);
  });

  it('still ends a drag after the card is detached and re-attached', () => {
    // Home Assistant re-attaches cards without re-rendering them (switching
    // views, editing the dashboard). Registering the listener per render while
    // removing it per detach left a permanent gap, and the stuck flag made the
    // replacement wheel write to the device on plain hover.
    const card = mountCard();

    card.remove();
    document.body.append(card);

    card._wheelActive = true;
    document.dispatchEvent(new Event('pointerup'));

    expect(card._wheelActive).toBe(false);
  });

  it('does not leave a stale drag across a re-attach', () => {
    const card = mountCard();
    card._wheelActive = true;

    card.remove();
    document.body.append(card);

    expect(card._wheelActive).toBe(false);
  });

  it('stops listening once detached', () => {
    const card = mountCard();
    card.remove();

    card._wheelActive = true;
    document.dispatchEvent(new Event('pointerup'));

    expect(card._wheelActive).toBe(true);
  });
});

describe('misconfigured entity', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('replaces the card with a notice when the entity is missing', () => {
    const card = mountCard({ entity: 'light.typo' });

    expect(card.querySelector('ha-alert')?.textContent).toContain('Entity not found');
    expect(card.querySelector('#wheel')).toBeNull();
  });

  it('names an entity that is not one of ours', () => {
    const card = document.createElement('rgbcct-light-card');
    document.body.append(card);
    card.setConfig({ entity: 'light.foreign' });
    const hass = fakeHass();
    hass.entities['light.foreign'] = { device_id: 'device-9' };
    hass.states['light.foreign'] = { state: 'on', attributes: { brightness: 1 } };
    card.hass = hass;

    expect(card.querySelector('ha-alert')?.textContent).toContain('Not an rgbcct_wled light');
  });

  it('recovers without a reload when the entity appears', () => {
    const card = mountCard({ entity: 'light.late' });
    expect(card.querySelector('ha-alert')).not.toBeNull();

    const hass = fakeHass();
    hass.entities['light.late'] = { device_id: 'device-1' };
    hass.states['light.late'] = { state: 'on', attributes: { is_group: true } };
    card.hass = hass;

    expect(card.querySelector('ha-alert')).toBeNull();
    expect(card.querySelector('#wheel')).not.toBeNull();
  });

  it('escapes text going into the notice', () => {
    const card = mountCard({ entity: 'light.<img src=x onerror=alert(1)>' });

    expect(card.querySelector('img')).toBeNull();
  });

  it('does not report an offline device as misconfigured', () => {
    const card = document.createElement('rgbcct-light-card');
    document.body.append(card);
    card.setConfig({ entity: GROUP });
    const hass = fakeHass();
    hass.states[GROUP] = { state: 'unavailable', attributes: { is_group: true } };
    card.hass = hass;

    expect(card.querySelector('ha-alert')).toBeNull();
    expect(card.querySelector('#children-list')).not.toBeNull();
  });
});

// renderCard publishes element references onto the card; every UI helper reads
// them and null-checks. Asserting the DOM alone cannot see these — the markup
// can be perfect while every reference is null, and the card would then render
// once and never update again. So these check the properties, not the nodes.
describe('published element references', () => {
  const COLOUR_CONTROLS = ['brightness', 'wheel', 'wheelHandle', 'value', 'white', 'cctInput'];

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('publishes every control the full layout builds', () => {
    const card = mountCard();

    for (const property of [...COLOUR_CONTROLS, 'colorInput', 'toggle', 'childrenList']) {
      expect(card[property], property).not.toBeNull();
    }
  });

  it('drops references to controls the next layout does not build', () => {
    // The stale-reference case the clear exists for: compact mode replaces
    // innerHTML with a layout that has no colour controls, so holding the
    // previous ones would leave the UI helpers writing to detached nodes —
    // silently, since they only check for null.
    const card = mountCard();
    expect(card.wheel).not.toBeNull();

    card.toggleCompact();

    for (const property of COLOUR_CONTROLS) {
      expect(card[property], property).toBeNull();
    }
    expect(card.toggle).not.toBeNull();
  });

  it('leaves a segment card without a children list', () => {
    const card = document.createElement('rgbcct-light-card');
    document.body.append(card);
    card.setConfig({ entity: GROUP });
    const hass = fakeHass();
    hass.states[GROUP] = { state: 'on', attributes: { segment_id: 0, brightness: 200 } };
    card.hass = hass;

    expect(card.childrenList).toBeNull();
    expect(card.wheel).not.toBeNull();
  });

  it('publishes nothing when the entity is misconfigured', () => {
    const card = mountCard({ entity: 'light.typo' });

    for (const property of [...COLOUR_CONTROLS, 'colorInput', 'toggle', 'childrenList']) {
      expect(card[property], property).toBeNull();
    }
  });
});
