import { defineConfig } from 'vite';
import { createRequire } from 'node:module';

// createRequire (rather than a JSON import attribute) reads package.json
// robustly across Node versions.
const pkg = createRequire(import.meta.url)('./package.json');

// `vite build`                    → production: minified, no sourcemap.
// `vite build --mode development`  → dev build (build:dev / watch): same
//   minified bundle plus a sourcemap, so the card can be debugged live in
//   HA's browser devtools against the original src/.
export default defineConfig(({ mode }) => {
  const dev = mode === 'development';

  return {
    // Replaced in the bundle at build time; drives the console version
    // banner in src/rgbcct-light-card.js.
    define: {
      __CARD_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      sourcemap: dev,
      lib: {
        entry: './src/rgbcct-light-card.js',
        name: 'RgbcctLightCard',
        formats: ['iife'],
        fileName: () => 'rgbcct-light-card.js',
      },
    },
    // Vitest reads this file, so the tests get the same `define` as the build —
    // which is what lets them import the element module (its version banner
    // references __CARD_VERSION__ at load time).
    test: {
      // Tests sit beside the code they cover. `dist/` is excluded because the
      // built bundle is a copy of everything here.
      include: ['src/**/*.test.js'],
      // Default `node`: only the element's lifecycle suite needs a DOM, and it
      // opts in with a `@vitest-environment happy-dom` docblock. Setting it
      // globally instead costs a browser environment per suite — measured at
      // ~250s across five files on this checkout, against ~1s of actual tests.
      //
      // happy-dom rather than jsdom because jsdom >= 27 needs `require(esm)`,
      // i.e. Node >= 20.19, and this project only asks for Node 20. happy-dom is
      // pure ESM and lighter; if it ever falls short of what a test needs, jsdom
      // is the swap — but raise the Node floor in the README at the same time.
    },
  };
});
