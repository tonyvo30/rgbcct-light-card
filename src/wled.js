// The HA script this card calls to push colour/brightness/cct to WLED.
const SEND_SCRIPT = 'script.send_wled_with_cct';

export async function updateWLED(card) {
  // The entity->ip (and its segments) mapping lives in the
  // Home Assistant script "send wled with cct". We hand it the
  // entity and colour values; HA resolves the device.
  //
  // Called via script.turn_on + variables (rather than the
  // dedicated script.send_wled_with_cct service) so the script's
  // `entity_id` field is passed as a variable and not swallowed
  // by Home Assistant's reserved entity_id target key.

  await card.hass.callService('script', 'turn_on', {
    entity_id: SEND_SCRIPT,
    variables: {
      entity_id: card.config.entity,
      bri: card.bri,
      r: card.r,
      g: card.g,
      b: card.b,
      w: card.w,
      cct: card.cct,
    },
  });
}
