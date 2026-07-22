import js from "@eslint/js";
import globals from "globals";


export default [

  // Never lint build output or dependencies.
  {
    ignores: ["dist/**", "node_modules/**"]
  },

  // Baseline: ESLint's recommended static-analysis rules for every file.
  js.configs.recommended,

  // The card source runs in the browser as a custom element.
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Replaced at build time by Vite's `define` (see vite.config.js).
        __CARD_VERSION__: "readonly"
      }
    },
    rules: {
      // A caught error we intentionally swallow (with an explanatory
      // comment) shouldn't be flagged as unused; real unused vars still are.
      "no-unused-vars": ["error", { caughtErrors: "none" }],
      // Catch a few things recommended leaves off but that matter here.
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-console": ["warn", { allow: ["info"] }],
      "no-else-return": "error"
    }
  },

  // Build / tooling config files run under Node.
  {
    files: ["*.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    }
  }

];
