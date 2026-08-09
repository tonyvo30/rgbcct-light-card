// Text going into one of the innerHTML templates below. The entity id and the
// card name come from the user's own YAML, so this is self-inflicted rather than
// hostile — but these are template literals, not text nodes, and there is no
// reason to hand user input to the HTML parser.
const escapeText = (value) =>
  String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

// Every element reference renderCard can publish. Cleared before each layout so
// a branch that does not build a control cannot leave the previous layout's
// (now detached) element behind — the UI helpers all null-check, so a stale
// reference would silently update a node that is no longer on the page.
function clearElementReferences(card) {
  card.brightness = null;
  card.wheel = null;
  card.wheelHandle = null;
  card.wheelShade = null;
  card.value = null;
  card.white = null;
  card.cctInput = null;
  card.colorInput = null;
  card.toggle = null;
  card.childrenList = null;
}

function sliderRow(label, id, value, min = 0) {
  return `
    <div class="row">
      <label for="${id}">${label}</label>
      <input type="range" id="${id}" min="${min}" max="255" value="${value}" />
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
  clearElementReferences(card);

  // A misconfigured entity replaces the whole card, the way native cards do.
  // `ha-alert` is Home Assistant's own element, so this matches the rest of the
  // dashboard; styles.js has a fallback for the case where it is not defined.
  const problem = card.entityProblem();

  if (problem) {
    card.innerHTML = `
      <ha-card>
        <ha-alert alert-type="error">${escapeText(problem)}</ha-alert>
      </ha-card>
    `;

    return;
  }

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
    card.toggle = card.querySelector('#toggle');

    return;
  }

  const title = card.config.name ?? card.config.entity;

  card.innerHTML = `
    <ha-card>
      <div class="card">
        <div class="header">
          <div id="swatch" class="swatch"></div>
          <span class="title">${escapeText(title)}</span>
          <span id="mixed-badge" class="mixed-badge" title="Segments differ in colour or brightness">Mixed</span>
          <ha-switch id="toggle"></ha-switch>
          <ha-icon id="collapse" class="collapse" icon="mdi:unfold-less-horizontal"></ha-icon>
        </div>
        <div class="controls">
          ${sliderRow('Brightness', 'bri', card.bri, 1)}
          ${colorWheel()}
          ${sliderRow('Value', 'v', Math.round(card.v * 255))}
          ${sliderRow('White', 'w', card.w)}
          ${sliderRow('CCT', 'cct', card.cct)}
        </div>
        ${card.isMaster() ? childrenSection() : ''}
      </div>
    </ha-card>
  `;

  card.brightness = card.querySelector('#bri');
  card.wheel = card.querySelector('#wheel');
  card.wheelHandle = card.querySelector('#wheel-handle');
  card.wheelShade = card.querySelector('#wheel-shade');
  card.value = card.querySelector('#v');
  card.white = card.querySelector('#w');
  card.cctInput = card.querySelector('#cct');
  card.colorInput = card.querySelector('#color-input');
  card.toggle = card.querySelector('#toggle');
  card.childrenList = card.querySelector('#children-list');
}
