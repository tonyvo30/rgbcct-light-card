import { wheelWhiteGradient, hueConicGradient } from "./color.js";


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

    /* "Mixed" chip: shown next to the title on a master card whose
       segments aren't homogeneous (paired with the rainbow swatch). */
    rgbcct-light-card .mixed-badge {
      display: none;
      font-size: 0.7em;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      padding: 2px 6px;
      border-radius: 10px;
      color: var(--secondary-text-color);
      border: 1px solid var(--divider-color, #ccc);
      white-space: nowrap;
    }

    rgbcct-light-card .mixed-badge.show {
      display: inline-block;
    }

    rgbcct-light-card .collapse {
      cursor: pointer;
      color: var(--secondary-text-color);
    }

    /* Eyedropper button: floats at the wheel's top-right corner. It's an
       MDI icon with a native <input type="color"> stretched invisibly
       over it, so a click opens the browser's own colour picker
       (RGB / HEX / HSL) anchored right at the icon. */
    rgbcct-light-card .pick {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--card-background-color, #1c1c1c);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      cursor: pointer;
      color: var(--primary-text-color);
    }

    rgbcct-light-card .pick-icon {
      pointer-events: none;
      --mdc-icon-size: 18px;
    }

    rgbcct-light-card .color-input {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      border: none;
      opacity: 0;
      cursor: pointer;
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
        ${hueConicGradient()};
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

    rgbcct-light-card .children {
      margin-top: 12px;
      border-top: 1px solid var(--divider-color, #ccc);
    }

    rgbcct-light-card .children-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 2px 4px;
      cursor: pointer;
      color: var(--secondary-text-color);
      font-size: 0.85em;
    }

    rgbcct-light-card .children-title {
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    rgbcct-light-card .children-list {
      display: none;
      flex-direction: column;
      gap: 6px;
      padding: 4px 2px 2px;
    }

    rgbcct-light-card .children.open .children-list {
      display: flex;
    }

    rgbcct-light-card .child {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    rgbcct-light-card .child-swatch {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 1px solid var(--divider-color, #ccc);
      flex-shrink: 0;
    }

    rgbcct-light-card .child-name {
      flex: 1;
      font-size: 0.9em;
      color: var(--primary-text-color);
    }

    rgbcct-light-card .child-bri {
      font-size: 0.9em;
      font-variant-numeric: tabular-nums;
      color: var(--secondary-text-color);
    }

    rgbcct-light-card .compact-card {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px;
      cursor: pointer;
    }

    rgbcct-light-card .compact-card #name {
      flex: 1;
      color: var(--primary-text-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    rgbcct-light-card .compact-card #summary {
      color: var(--secondary-text-color);
      font-variant-numeric: tabular-nums;
    }

    rgbcct-light-card .compact-card #toggle {
      cursor: default;
    }

  `;

  card.appendChild(style);

}
