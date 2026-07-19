export function addStyles(card) {

  const style = document.createElement("style");

  style.textContent = `

    rgbcct-light-card .card {
      padding: 16px;
    }

    rgbcct-light-card .header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    rgbcct-light-card .swatch {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 1px solid var(--divider-color, #ccc);
    }

    rgbcct-light-card .title {
      flex: 1;
      font-weight: 500;
      color: var(--primary-text-color);
    }

    rgbcct-light-card .collapse {
      cursor: pointer;
      color: var(--secondary-text-color);
    }

    rgbcct-light-card .controls {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    rgbcct-light-card .row {
      display: grid;
      grid-template-columns: 80px 1fr 40px;
      align-items: center;
      gap: 8px;
    }

    rgbcct-light-card .row label {
      font-size: 0.9em;
      color: var(--secondary-text-color);
    }

    rgbcct-light-card .row input[type="range"] {
      width: 100%;
    }

    rgbcct-light-card .row .val {
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--primary-text-color);
    }

    rgbcct-light-card .compact-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      cursor: pointer;
    }

  `;

  card.appendChild(style);

}
