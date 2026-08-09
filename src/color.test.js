// The white/cct <-> cold/warm boundary. Mirrors tests/test_color.py: the same
// property is asserted on both sides, because both sides implement the encoding
// and a card that disagrees with the integration is silently wrong.
//
// The interesting case is that this round trip is DELIBERATELY lossy, so these
// assert a *bound* rather than equality. A test demanding exact recovery would
// fail on real hardware; one demanding nothing would have let the regression in
// `sync.js` through. See the drift table in color.js.

import { describe, expect, it } from 'vitest';

import { coldWarmToWhiteCct, whiteCctToColdWarm } from './color.js';

describe('whiteCctToColdWarm', () => {
  it('puts all the white in the warm channel at cct 0 and the cold one at 255', () => {
    // The polarity, verified on device: WLED cct=0 is WARM, 255 is COLD. Getting
    // this backwards round-trips perfectly and is invisible in the payload, so
    // it is pinned here as a literal rather than derived.
    expect(whiteCctToColdWarm(200, 0)).toEqual([0, 200]);
    expect(whiteCctToColdWarm(200, 255)).toEqual([200, 0]);
  });

  it('splits evenly at the midpoint', () => {
    const [cold, warm] = whiteCctToColdWarm(200, 127);
    expect(cold + warm).toBeCloseTo(200, 0);
    expect(Math.abs(cold - warm)).toBeLessThanOrEqual(2);
  });

  it('emits nothing when there is no white to divide', () => {
    expect(whiteCctToColdWarm(0, 200)).toEqual([0, 0]);
  });
});

describe('coldWarmToWhiteCct', () => {
  it('keeps the previous cct when both whites are zero', () => {
    // Temperature is indeterminate with no white lit, so the card's current
    // value must survive rather than snapping to an arbitrary one.
    expect(coldWarmToWhiteCct(0, 0, 42)).toEqual({ w: 0, cct: 42 });
  });

  it('scales an oversized pair down proportionally instead of clipping', () => {
    // Home Assistant may legitimately ask for cw + ww > 255, which WLED's single
    // white channel cannot hold. The total caps but the ratio must not.
    expect(coldWarmToWhiteCct(255, 255, 0)).toEqual({ w: 255, cct: 128 });
    expect(coldWarmToWhiteCct(200, 100, 0)).toEqual({ w: 255, cct: 170 });
  });
});

describe('the round trip', () => {
  it('preserves the white level to within 1 across the whole range', () => {
    // The channel values are what actually drive the LEDs, so this is the half
    // that must hold tightly. The +/-1 is integer rounding of the two halves.
    for (let white = 0; white <= 255; white += 1) {
      for (let cct = 0; cct <= 255; cct += 1) {
        const [cold, warm] = whiteCctToColdWarm(white, cct);
        const recovered = coldWarmToWhiteCct(cold, warm, cct);

        expect(Math.abs(recovered.w - white)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('recovers cct within the resolution the white level allows', () => {
    // cct is encoded as the cold/warm *ratio*, so its resolution IS the white
    // level: at white=1 there are two representable temperatures, at white=255
    // there are 255. The bound is ~128/white.
    for (let white = 1; white <= 255; white += 1) {
      for (let cct = 0; cct <= 255; cct += 1) {
        const [cold, warm] = whiteCctToColdWarm(white, cct);
        const recovered = coldWarmToWhiteCct(cold, warm, cct);

        expect(Math.abs(recovered.cct - cct)).toBeLessThanOrEqual(Math.ceil(128 / white));
      }
    }
  });

  it('is exact once there is enough white to encode the ratio', () => {
    for (let cct = 0; cct <= 255; cct += 1) {
      const [cold, warm] = whiteCctToColdWarm(255, cct);
      expect(coldWarmToWhiteCct(cold, warm, cct).cct).toBe(cct);
    }
  });

  it('loses cct badly at low white — the drift sync.js must not adopt', () => {
    // These exact values are the regression: raising white from 0 while at
    // neutral used to drag the CCT slider with it, and write the drifted value
    // back to the device. They are literals so a change in the encoding shows
    // up here as a diff rather than as a surprise on hardware.
    const recoveredAt = (white) => {
      const [cold, warm] = whiteCctToColdWarm(white, 127);
      return coldWarmToWhiteCct(cold, warm, 127).cct;
    };

    expect(recoveredAt(1)).toBe(0); // fully warm, from neutral
    expect(recoveredAt(3)).toBe(85);
    expect(recoveredAt(128)).toBe(128); // off by one, and that is the floor
  });
});
