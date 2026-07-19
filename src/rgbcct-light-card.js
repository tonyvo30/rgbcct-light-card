import { renderCard } from "./render.js";
import { setupEvents } from "./events.js";
import { updateWLED } from "./wled.js";
import { addStyles } from "./styles.js";
import { getWledInfo } from "./utils.js";
import { WLED_DEVICES } from "./config.js";


class RGBCTLightCard extends HTMLElement {

  setConfig(config) {

    this.config = config;

    this.compact =
      config.compact ?? false;


    this.wled_devices = WLED_DEVICES;


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


  getWledInfo(entity) {

    return getWledInfo(
      this,
      entity
    );

  }

}


customElements.define(
  "rgbcct-light-card",
  RGBCTLightCard
);