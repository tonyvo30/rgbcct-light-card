export function setupEvents(card) {

 if(card.compact) {

   card.querySelector(
     ".compact-card"
   ).onclick =
     () => card.toggleCompact();

   return;

 }


 card.brightness.oninput =
 () => {

   card.bri =
    Number(
      card.brightness.value
    );

   card.send();

 };

}