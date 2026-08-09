// The write payload. This is the highest-value suite in the repo: the bug it
// pins was a one-pixel brightness drag on a master permanently flattening every
// segment's colour on the device, and it survived a full hardware pass because
// a single-segment rig cannot show it.
//
// The rule is that a key the user did not touch is destructive, not redundant —
// a group write fans out across every segment (payload.py). So these assert on
// the ABSENCE of keys, which is the part that is easy to regress and impossible
// to notice by reading the service call.

import { describe, expect, it, vi } from 'vitest';

import { BRIGHTNESS_CHANNEL, COLOR_CHANNEL, updateWLED } from '../../src/wled.js';

function fakeCard() {
  return {
    config: { entity: 'light.strip' },
    hass: { callService: vi.fn() },
    r: 10,
    g: 20,
    b: 30,
    w: 200,
    cct: 0,
    bri: 128,
  };
}

function serviceDataFrom(card) {
  const [domain, service, data] = card.hass.callService.mock.calls[0];
  expect([domain, service]).toEqual(['light', 'turn_on']);
  return data;
}

describe('updateWLED', () => {
  it('sends brightness alone without any colour', async () => {
    const card = fakeCard();

    await updateWLED(card, new Set([BRIGHTNESS_CHANNEL]));

    const data = serviceDataFrom(card);
    expect(data).toEqual({ entity_id: 'light.strip', brightness: 128 });
    expect(data).not.toHaveProperty('rgbww_color');
  });

  it('sends colour alone without brightness', async () => {
    const card = fakeCard();

    await updateWLED(card, new Set([COLOR_CHANNEL]));

    const data = serviceDataFrom(card);
    expect(data).toEqual({ entity_id: 'light.strip', rgbww_color: [10, 20, 30, 0, 200] });
    expect(data).not.toHaveProperty('brightness');
  });

  it('sends both when both were edited', async () => {
    const card = fakeCard();

    await updateWLED(card, new Set([COLOR_CHANNEL, BRIGHTNESS_CHANNEL]));

    expect(serviceDataFrom(card)).toEqual({
      entity_id: 'light.strip',
      rgbww_color: [10, 20, 30, 0, 200],
      brightness: 128,
    });
  });

  it('encodes white and cct into the cold/warm pair', async () => {
    const card = { ...fakeCard(), w: 200, cct: 255 };

    await updateWLED(card, new Set([COLOR_CHANNEL]));

    // cct 255 is cold, so the white belongs in the cold slot.
    expect(serviceDataFrom(card).rgbww_color).toEqual([10, 20, 30, 200, 0]);
  });

  it('targets only the entity the card is configured with', async () => {
    const card = { ...fakeCard(), config: { entity: 'light.strip_segment_2' } };

    await updateWLED(card, new Set([COLOR_CHANNEL]));

    expect(serviceDataFrom(card).entity_id).toBe('light.strip_segment_2');
  });
});
