export function setupEvents(card) {

  if (card.compact) {

    const el = card.querySelector(".compact-card");

    if (el) {
      el.onclick = () => card.toggleCompact();
    }

    return;

  }


  const bind = (input, prop) => {

    if (!input) return;

    input.oninput = () => {
      card[prop] = Number(input.value);
      card.updateReadouts();
      card.send();
    };

  };


  bind(card.brightness, "bri");
  bind(card.red, "r");
  bind(card.green, "g");
  bind(card.blue, "b");
  bind(card.white, "w");
  bind(card.cctInput, "cct");


  const collapse = card.querySelector("#collapse");

  if (collapse) {
    collapse.onclick = () => card.toggleCompact();
  }

}
