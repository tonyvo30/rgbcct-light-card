import { defineConfig } from "vite";


export default defineConfig({

  build: {

    lib: {

      entry:
        "./src/rgbcct-light-card.js",

      name:
        "RgbcctLightCard",

      formats:
        ["iife"],

      fileName:
        () => "rgbcct-light-card.js"

    }

  }

});