// Reading the entity's attributes into card state.
//
// Two properties matter here and they pull in opposite directions: a push must
// never overwrite what the user is currently setting, and it must never stop the
// card redrawing. The first was the original requirement; the second is what
// broke when the guard was written to cover both.

import { describe, expect, it, vi } from 'vitest';

import { syncMixin } from '../../../src/mixins/sync.js';

const ENTITY = 'light.strip';

// Colour-carrying attributes for a card holding (w, cct) — i.e. exactly what the
// device reports back when it agrees with the card.
const RGBWW = (r, g, b, cold, warm) => ({
  state: 'on',
  attributes: { rgbww_color: [r, g, b, cold, warm], brightness: 200 },
});

function fakeCard(overrides = {}) {
  return Object.assign(Object.create(syncMixin), {
    config: { entity: ENTITY },
    r: 0,
    g: 0,
    b: 0,
    w: 3,
    cct: 127,
    bri: 10,
    setRgb: vi.fn(function (r, g, b) {
      Object.assign(this, { r, g, b });
    }),
    updateUI: vi.fn(),
    _hass: { states: { [ENTITY]: RGBWW(10, 20, 30, 1, 2) } },
    ...overrides,
  });
}

describe('syncFromState', () => {
  it('adopts brightness and colour from the entity', () => {
    const card = fakeCard();

    card.syncFromState();

    expect(card.setRgb).toHaveBeenCalledWith(10, 20, 30);
    expect(card.bri).toBe(200);
    expect(card.updateUI).toHaveBeenCalled();
  });

  it('does not adopt while the wheel is being dragged', () => {
    const card = fakeCard({ _wheelActive: true });

    card.syncFromState();

    expect(card.setRgb).not.toHaveBeenCalled();
    expect(card.bri).toBe(10);
  });

  it('does not adopt inside the post-edit hold window', () => {
    const card = fakeCard({ _holdUntil: Date.now() + 5000 });

    card.syncFromState();

    expect(card.setRgb).not.toHaveBeenCalled();
    expect(card.bri).toBe(10);
  });

  it('still redraws while the guards are holding', () => {
    // The guard covers ADOPTION only. Rendering paints from the card's own
    // state — which during a drag is what the user is setting, so it cannot
    // snap anything back — and it is what keeps the power toggle and the
    // master's children list live mid-drag.
    for (const guard of [{ _wheelActive: true }, { _holdUntil: Date.now() + 5000 }]) {
      const card = fakeCard(guard);

      card.syncFromState();

      expect(card.updateUI).toHaveBeenCalledTimes(1);
    }
  });

  it('redraws even when the entity is missing', () => {
    // A mistyped or not-yet-loaded entity used to return before the redraw, so
    // the card rendered once from defaults and then never updated again.
    const card = fakeCard({ _hass: { states: {} } });

    expect(() => card.syncFromState()).not.toThrow();
    expect(card.updateUI).toHaveBeenCalledTimes(1);
  });

  it('keeps its own cct when the device reports the same whites', () => {
    // The regression this exists for: decoding the cold/warm ratio back to
    // (w, cct) is lossy at low white, and the drifted value is what the next
    // edit writes to the device. The card holds w=3, cct=127, which encodes to
    // (1, 2) — the exact pair the entity is reporting, so there is nothing to
    // learn from decoding it. Adopting anyway yields cct=85 and drags the
    // slider a sixth of its travel during a *white* drag.
    const card = fakeCard();

    card.syncFromState();

    expect(card.w).toBe(3);
    expect(card.cct).toBe(127);
  });

  it('adopts the whites when the device genuinely differs', () => {
    // The other half: a change made elsewhere must still reach the card. Only
    // an exact match is treated as "no news".
    const card = fakeCard({ _hass: { states: { [ENTITY]: RGBWW(10, 20, 30, 200, 0) } } });

    card.syncFromState();

    expect(card.w).toBe(200);
    expect(card.cct).toBe(255);
  });

  it('keeps the current colour when the light is off', () => {
    // Home Assistant drops colour attributes for an off light. Treating that as
    // "black" would blank the swatch and lose what the light will come back to.
    const card = fakeCard({ _hass: { states: { [ENTITY]: { state: 'off', attributes: {} } } } });

    card.syncFromState();

    expect(card.setRgb).not.toHaveBeenCalled();
    expect(card.w).toBe(3);
    expect(card.cct).toBe(127);
    expect(card.updateUI).toHaveBeenCalled();
  });
});
