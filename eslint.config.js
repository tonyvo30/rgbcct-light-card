import js from '@eslint/js';
import globals from 'globals';

export default [
  // Never lint build output or dependencies.
  {
    ignores: ['dist/**', 'node_modules/**'],
  },

  // Baseline: ESLint's recommended static-analysis rules for every file.
  js.configs.recommended,

  // The card source runs in the browser as a custom element. Its tests run in a
  // DOM environment against the same globals, so they share this block.
  {
    files: ['src/**/*.js', 'tests/card/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Replaced at build time by Vite's `define` (see vite.config.js).
        __CARD_VERSION__: 'readonly',
      },
    },
    rules: {
      // A caught error we intentionally swallow (with an explanatory
      // comment) shouldn't be flagged as unused; real unused vars still are.
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
      // Catch a few things recommended leaves off but that matter here.
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      // `info` is the version banner; `warn` is for telling the user something
      // is genuinely degraded (e.g. the entity registry being unavailable, which
      // would otherwise look like a device with no segments). Everything else —
      // log/debug/error left over from debugging — still gets flagged.
      'no-console': ['warn', { allow: ['info', 'warn'] }],
      'no-else-return': 'error',
    },
  },

  // Build / tooling config files and the dev scripts run under Node, not the
  // browser — they need Node's globals (console, process, ...).
  {
    files: ['*.config.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },
];
