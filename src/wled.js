// The card's write path: a standard `light.turn_on` against the rgbcct_wled
// integration's entity.
//
// This used to call the "send wled with cct" HA script, which resolved the
// entity to an IP and POSTed to WLED itself — a workaround for the fact that no
// single HA light entity could carry colour and temperature together. The
// integration's RGBWW entity can, so the card writes through the normal light
// service like any other client, and the entity->device mapping, rate limiting
// and per-segment fan-out all live server-side.

import { whiteCctToColdWarm } from './color.js';

export async function updateWLED(card) {
  // Colour and brightness go in one call so the integration can coalesce them
  // into a single POST to the device (see payload.py: a colour write and a
  // brightness write carry different keys and are merged per segment).
  await card.hass.callService('light', 'turn_on', {
    entity_id: card.config.entity,
    rgbww_color: [card.r, card.g, card.b, ...whiteCctToColdWarm(card.w, card.cct)],
    brightness: card.bri,
  });
}
