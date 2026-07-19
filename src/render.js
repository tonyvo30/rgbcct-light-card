function sliderRow(label, id, value) {

  return `
    <div class="row">
      <label for="${id}">${label}</label>
      <input type="range" id="${id}" min="0" max="255" value="${value}" />
      <span class="val" id="${id}-val">${value}</span>
    </div>
  `;

}


export function renderCard(card) {

  if (card.compact) {

    card.innerHTML = `
      <ha-card>
        <div class="compact-card">
          <ha-icon id="icon"></ha-icon>
          <span id="name"></span>
          <span id="summary"></span>
        </div>
      </ha-card>
    `;

    // No sliders in compact mode.
    card.brightness = null;
    card.red = null;
    card.green = null;
    card.blue = null;
    card.white = null;
    card.cctInput = null;

    return;

  }

  const title =
    card.config.name ?? card.config.entity;

  card.innerHTML = `
    <ha-card>
      <div class="card">
        <div class="header">
          <div id="swatch" class="swatch"></div>
          <span class="title">${title}</span>
          <ha-icon id="collapse" class="collapse" icon="mdi:unfold-less-horizontal"></ha-icon>
        </div>
        <div class="controls">
          ${sliderRow("Brightness", "bri", card.bri)}
          ${sliderRow("Red", "r", card.r)}
          ${sliderRow("Green", "g", card.g)}
          ${sliderRow("Blue", "b", card.b)}
          ${sliderRow("White", "w", card.w)}
          ${sliderRow("CCT", "cct", card.cct)}
        </div>
      </div>
    </ha-card>
  `;

  card.brightness = card.querySelector("#bri");
  card.red = card.querySelector("#r");
  card.green = card.querySelector("#g");
  card.blue = card.querySelector("#b");
  card.white = card.querySelector("#w");
  card.cctInput = card.querySelector("#cct");

}
