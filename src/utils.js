export function getWledInfo(card, entity_id) {

 let base = entity_id;
 let segment = -1;


 if(entity_id.includes("_segment_")) {

   const parts =
    entity_id.split("_segment_");


   base = parts[0];

   segment =
    Number(parts[1]);

 }


 return {

   ip:
    card.wled_devices[base],

   segment

 };

}