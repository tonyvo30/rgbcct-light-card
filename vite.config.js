import { defineConfig } from "vite";


export default defineConfig({

  build: {

    lib: {

      entry:
        "./src/rgbcct-light-card.js",

      formats:
        ["iife"],

      fileName:
        () => "rgbcct-light-card.js"

    }

  }

});