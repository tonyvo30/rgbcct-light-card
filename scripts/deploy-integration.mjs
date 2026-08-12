// Dev-only: copy the integration into Home Assistant so it can load it.
//
// HA loads integrations from <config>/custom_components/, but this repo lives at
// <config>/www/rgbcct-light-card (so the built card is served from /local/). HA
// can't load Python from there, and Z: is a Samba share, so a symlink/junction
// isn't viable — hence a copy.
//
// The HA config root is derived as ../../ from the repo root (repo is under
// <config>/www/); override with RGBCCT_HA_CONFIG if your layout differs.
//
//   npm run deploy:integration
//
// After copying you must RESTART Home Assistant. The config entry's "Reload"
// (⋮ menu) is not enough: HA imports an integration once and Python caches it in
// sys.modules, so reload re-runs setup against the OLD module and silently looks
// like it worked. Reload only picks up *data* changes (e.g. options).
// End users install via HACS, which handles placement itself.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const DOMAIN = 'rgbcct_wled';
const source = path.join(repoRoot, 'custom_components', DOMAIN);
const configRoot = process.env.RGBCCT_HA_CONFIG || path.resolve(repoRoot, '..', '..');
const destination = path.join(configRoot, 'custom_components', DOMAIN);

if (!fs.existsSync(source)) {
  console.error(`Integration source not found: ${source}`);
  process.exit(1);
}

// Don't ship Python caches or the test suite into HA.
const skip = (src) => {
  const base = path.basename(src);
  return base === '__pycache__' || base === 'tests' || src.endsWith('.pyc');
};

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, {
  recursive: true,
  filter: (src) => !skip(src),
});

console.log(`Deployed ${DOMAIN}:`);
console.log(`  from ${source}`);
console.log(`  to   ${destination}`);
console.log('Now RESTART Home Assistant — "Reload" on the entry will not pick up code changes.');
