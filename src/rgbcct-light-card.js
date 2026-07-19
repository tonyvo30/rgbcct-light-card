import { renderCard } from "./render.js";
import { setupEvents } from "./events.js";
import { updateWLED } from "./wled.js";
import { addStyles } from "./styles.js";


class RGBCTLightCard extends HTMLElement {

  setConfig(config) {

    this.config = config;

    this.compact =
      config.compact ?? false;


    this.render();

  }


  render() {

    renderCard(this);

    addStyles(this);

    setupEvents(this);

  }


  async updateWLED() {

    updateWLED(this);

  }

}


customElements.define(
  "rgbcct-light-card",
  RGBCTLightCard
);