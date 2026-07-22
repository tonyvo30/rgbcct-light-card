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
  };
});
