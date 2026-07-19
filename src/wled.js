export async function updateWLED(card) {

 const wled =
   card.getWledInfo(
     card.config.entity
   );


 const response =
   await fetch(
    `http://${wled.ip}/json/state`
   );


 const state =
   await response.json();
}