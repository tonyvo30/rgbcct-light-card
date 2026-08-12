// Text going into one of the innerHTML templates below. The entity id and the
// card name come from the user's own YAML, so this is self-inflicted rather than
// hostile — but these are template literals, not text nodes, and there is no
// reason to hand user input to the HTML parser.
const escapeText = (value) =>
  String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);

// Every element reference renderCard publishes, as card property -> selector.
//
// One list, and one function reading it, called on **every** path out of
// renderCard including the error layout that builds none of these. That total-ness
// is the point: a `querySelector` that finds nothing yields null, which is what
// every UI helper already checks for, so a layout missing a control needs no
// special handling and no branch has to know which subset applies to it.
//
// This replaced a pair of hand-maintained lists — one nulling the references,
// one assigning them — which is the same trap as a listener whose add and remove
// run at different rates. Adding a control meant editing both ends, and missing
// the null-out left the UI helpers writing to a detached node from the previous
// layout, silently, because they only check for null.
const ELEMENT_SELECTORS = {
  brightness: '#bri',
  wheel: '#wheel',
  wheelHandle: '#wheel-handle',
  wheelShade: '#wheel-shade',
  value: '#v',
  white: '#w',
  cctInput: '#cct',
  colorInput: '#color-input',
  toggle: '#toggle',
  childrenList: '#children-list',
};

function publishElementReferences(card) {
  for (const [property, selector] of Object.entries(ELEMENT_SELECTORS)) {
    card[property] = card.querySelector(selector);
  }
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

    // Builds none of the controls, so this drops the previous layout's
    // references rather than publishing new ones.
    publishElementReferences(card);

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

    // No colour controls in compact mode; only the power toggle resolves.
    publishElementReferences(card);

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

  publishElementReferences(card);
}
