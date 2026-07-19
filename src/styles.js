import { wheelWhiteGradient } from "./color.js";


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

    /* WLED-style gradient tracks. The per-slider gradient is set
       from JS (updateReadouts) so brightness/value reflect the live
       colour; this is just the shape + thumb. */
    rgbcct-light-card .row input[type="range"] {
      -webkit-appearance: none;
      appearance: none;
      width: 100%;
      height: 14px;
      border-radius: 7px;
      background: var(--divider-color, #444);
      outline: none;
      margin: 0;
      cursor: pointer;
    }

    rgbcct-light-card .row input[type="range"]::-webkit-slider-runnable-track {
      height: 14px;
      border-radius: 7px;
      background: transparent;
    }

    rgbcct-light-card .row input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      margin-top: -3px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid rgba(0, 0, 0, 0.25);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      cursor: pointer;
    }

    rgbcct-light-card .row input[type="range"]::-moz-range-track {
      height: 14px;
      border-radius: 7px;
      background: transparent;
    }

    rgbcct-light-card .row input[type="range"]::-moz-range-thumb {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid rgba(0, 0, 0, 0.25);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
      cursor: pointer;
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
      width: 100%;
      max-width: 280px;
      aspect-ratio: 1 / 1;
      border-radius: 50%;
      cursor: crosshair;
      touch-action: none;
      box-shadow: 0 0 0 1px var(--divider-color, #ccc);
      background:
        ${wheelWhiteGradient()},
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
