export async function updateWLED(card) {

 // The entity->ip (and its segments) mapping lives in the
 // Home Assistant script "send wled with cct". We just hand
 // it the entity and colour values; HA resolves the device.

 await card.hass.callService(
   "script",
   "send_wled_with_cct",
   {
     entity_id: card.config.entity,
     bri: card.bri,
     r: card.r,
     g: card.g,
     b: card.b,
     w: card.w,
     cct: card.cct
   }
 );

}
