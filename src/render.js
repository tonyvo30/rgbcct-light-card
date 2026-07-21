function sliderRow(label, id, value) {

  return `
    <div class="row">
      <label for="${id}">${label}</label>
      <input type="range" id="${id}" min="0" max="255" value="${value}" />
      <span class="val" id="${id}-val">${value}</span>
    </div>
  `;

}


function childrenSection() {

  return `
    <div class="children">
      <div class="children-header" id="children-toggle">
        <span class="children-title">Segments <span id="children-count"></span></span>
        <ha-icon id="children-chevron" icon="mdi:chevron-down"></ha-icon>
      </div>
      <div class="children-list" id="children-list"></div>
    </div>
  `;

}


function colorWheel() {

  return `
    <div class="wheel-block">
      <div class="wheel" id="wheel">
        <div class="wheel-shade" id="wheel-shade"></div>
        <div class="wheel-handle" id="wheel-handle"></div>
        <span class="pick" title="Pick colour (RGB / HEX / HSL)">
          <ha-icon class="pick-icon" icon="mdi:eyedropper-variant"></ha-icon>
          <input type="color" id="color-input" class="color-input" />
        </span>
      </div>
      <span class="val wheel-readout" id="rgb-val"></span>
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
          <ha-switch id="toggle"></ha-switch>
        </div>
      </ha-card>
    `;

    // No colour controls in compact mode; just the power toggle.
    card.brightness = null;
    card.wheel = null;
    card.wheelHandle = null;
    card.wheelShade = null;
    card.value = null;
    card.white = null;
    card.cctInput = null;
    card.colorInput = null;
    card.toggle = card.querySelector("#toggle");
    card.childrenList = null;

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
          ${colorWheel()}
          ${sliderRow("Value", "v", Math.round(card.v * 255))}
          ${sliderRow("White", "w", card.w)}
          ${sliderRow("CCT", "cct", card.cct)}
        </div>
        ${card.isMaster() ? childrenSection() : ""}
      </div>
    </ha-card>
  `;

  card.brightness = card.querySelector("#bri");
  card.wheel = card.querySelector("#wheel");
  card.wheelHandle = card.querySelector("#wheel-handle");
  card.wheelShade = card.querySelector("#wheel-shade");
  card.value = card.querySelector("#v");
  card.white = card.querySelector("#w");
  card.cctInput = card.querySelector("#cct");
  card.colorInput = card.querySelector("#color-input");
  card.toggle = null;
  card.childrenList = card.querySelector("#children-list");

}
