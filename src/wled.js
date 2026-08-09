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

// The two things a write can carry. `w` and `cct` both belong to COLOUR, not to
// a channel of their own: they encode jointly into the cold/warm whites, so
// changing either one requires sending the whole `rgbww_color` tuple.
export const COLOR_CHANNEL = 'color';
export const BRIGHTNESS_CHANNEL = 'brightness';

// Send only the channels the user actually edited.
//
// **A key the user did not touch is destructive, not merely redundant.** A write
// to a group entity fans out across every segment (`payload.py`), so a colour
// bundled into a brightness nudge stamps one segment's colour over all the
// others — per-segment state is gone on the device, not just mis-displayed. The
// server refuses to write unrequested channels for exactly this reason; sending
// them anyway makes that guard intact and unreachable.
//
// There is no efficiency cost to narrow writes: the coordinator coalesces a
// burst into one POST and merges partial payloads per segment
// (`payload.merge_payloads`), which is precisely what lets two channels edited
// together still cost a single request.
export async function updateWLED(card, channels) {
  const serviceData = { entity_id: card.config.entity };

  if (channels.has(COLOR_CHANNEL)) {
    serviceData.rgbww_color = [card.r, card.g, card.b, ...whiteCctToColdWarm(card.w, card.cct)];
  }

  if (channels.has(BRIGHTNESS_CHANNEL)) {
    serviceData.brightness = card.bri;
  }

  await card.hass.callService('light', 'turn_on', serviceData);
}
