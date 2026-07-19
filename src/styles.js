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

    rgbcct-light-card .wheel-block {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
    }

    rgbcct-light-card .wheel {
      position: relative;
      width: 180px;
      height: 180px;
      border-radius: 50%;
      cursor: crosshair;
      touch-action: none;
      /* Outline via box-shadow, not border: a border sits outside
         the .wheel-shade (inset: 0) so value dimming wouldn't cover
         it, and the conic gradient bleeds through a translucent
         border colour as a mismatched rainbow ring. */
      box-shadow: 0 0 0 1px var(--divider-color, #ccc);
      background:
        radial-gradient(circle at center,
          #fff 0%, rgba(255, 255, 255, 0) 100%),
        conic-gradient(
          hsl(0, 100%, 50%),
          hsl(60, 100%, 50%),
          hsl(120, 100%, 50%),
          hsl(180, 100%, 50%),
          hsl(240, 100%, 50%),
          hsl(300, 100%, 50%),
          hsl(360, 100%, 50%)
        );
    }

    rgbcct-light-card .wheel-shade {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: #000;
      opacity: 0;
      pointer-events: none;
    }

    rgbcct-light-card .wheel-handle {
      position: absolute;
      left: 50%;
      top: 50%;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 2px solid #fff;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    rgbcct-light-card .wheel-readout {
      color: var(--secondary-text-color);
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
